import Observation
import SwiftUI

private enum SettingsModelRole: String, CaseIterable, Identifiable {
    case chat
    case imageCaption = "image_caption"

    var id: String { rawValue }
    var title: String { self == .chat ? "对话模型" : "图片转述模型" }
}

private struct SettingsProvider: Identifiable, Equatable {
    let id: String
    let name: String
    let type: String
    let baseURL: String
    let modelName: String
    let hasAPIKey: Bool
    let availableModels: [String]

    init(_ value: JSONValue) {
        id = value.firstString("id", "providerId")
        name = value.firstString("name", "providerName").fallback("默认提供商")
        type = value.firstString("type", "providerType").fallback("openai")
        baseURL = value.firstString("baseUrl", "apiBaseUrl")
        modelName = value.firstString("modelName", "model")
        hasAPIKey = value["hasApiKey"].boolValue ?? false
        availableModels = value["availableModels"].arrayValue.map(\.stringValue).filter { !$0.isEmpty }
    }
}

private struct SettingsProviderPreset: Identifiable {
    let id: String
    let name: String
    let baseURL: String
    let model: String
}

@MainActor
@Observable
private final class SettingsViewModel {
    private(set) var config: JSONValue = .object([:])
    private(set) var session: BackendSessionStatus?
    private(set) var appInfo: BackendAppInfo?
    private(set) var isWorking = false
    private(set) var keySaved = false
    private(set) var availableModels: [String] = []
    private(set) var statusMessage: String?
    private(set) var errorMessage: String?
    private(set) var isTesting = false
    private(set) var isListingModels = false
    private(set) var hasPassedModelTest = false
    private(set) var legacyKeyMigrationComplete = false
    var role: SettingsModelRole = .chat
    var selectedProviderID = ""
    var providerName = ""
    var providerType = "openai"
    var baseURL = ""
    var modelName = ""
    var apiKeyDraft = ""
    var contextLength = "200000"
    var chatTemperature = "0.2"
    var compactTemperature = "0.1"
    var maxToolRounds = "50"
    var longPasteThreshold = "4000"
    var customInstructions = ""
    var theme = "system"
    var imageCaptionEnabled = false

    private let keychain = ModelAPIKeychainStore()

    static let presets = [
        SettingsProviderPreset(id: "moonshot", name: "Moonshot", baseURL: "https://api.moonshot.cn/v1", model: "kimi-k2.5"),
        SettingsProviderPreset(id: "deepseek", name: "DeepSeek", baseURL: "https://api.deepseek.com/v1", model: "deepseek-chat"),
        SettingsProviderPreset(id: "openai", name: "OpenAI", baseURL: "https://api.openai.com/v1", model: "gpt-4o-mini"),
        SettingsProviderPreset(id: "qwen", name: "通义千问", baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1", model: "qwen-plus"),
        SettingsProviderPreset(id: "custom", name: "自定义 OpenAI 兼容", baseURL: "", model: ""),
    ]

    var providers: [SettingsProvider] {
        let roleValue = config["modelRoles"][role.rawValue]["providers"]
        let values = roleValue.arrayValue.isEmpty && role == .chat ? config["providers"].arrayValue : roleValue.arrayValue
        return values.map(SettingsProvider.init).filter { !$0.id.isEmpty }
    }

    var activeProviderID: String {
        let roleID = config["modelRoles"][role.rawValue].firstString("activeProviderId", "providerId")
        return roleID.isEmpty && role == .chat ? config.firstString("activeProviderId") : roleID
    }

    var selectedProvider: SettingsProvider? {
        providers.first { $0.id == selectedProviderID } ?? providers.first
    }

    var selectedProviderIsActive: Bool {
        guard let provider = selectedProvider else { return false }
        return provider.id == activeProviderID
    }

    var providerConfigurationIsSaved: Bool {
        guard let provider = selectedProvider else { return false }
        return provider.name == providerName.trimmingCharacters(in: .whitespacesAndNewlines)
            && provider.type == providerType
            && provider.baseURL == baseURL.trimmingCharacters(in: .whitespacesAndNewlines)
            && provider.modelName == modelName.trimmingCharacters(in: .whitespacesAndNewlines)
            && apiKeyDraft.isEmpty
    }

    var sessionSummary: String {
        guard let session, session.ready else { return "未登录" }
        return [session.user?.name, session.user?.loginName].compactMap { $0 }.first { !$0.isEmpty } ?? "已登录"
    }

    var sessionDetails: String {
        guard let session, session.ready else { return "登录后可在此刷新伴学邦课程上下文或安全退出。" }
        let className = session.currentClass?.name ?? "未选择班级"
        let termName = session.currentTermName ?? "未选择学期"
        let subjectName = session.currentSubject?.name ?? "未选择课程"
        return "\(className) · \(termName) · \(subjectName)"
    }

    var pathRows: [(key: String, title: String, path: String)] {
        guard let appInfo else { return [] }
        return [
            (key: "userDataRoot", title: "应用数据", path: appInfo.userDataRoot),
            (key: "dataRoot", title: "伴学邦数据", path: appInfo.dataRoot),
            (key: "workspaceDir", title: "工作区", path: appInfo.workspaceDir),
            (key: "draftDir", title: "草稿库", path: appInfo.draftDir),
            (key: "updateDir", title: "更新缓存", path: appInfo.updateDir),
            (key: "modelConfigPath", title: "模型配置", path: appInfo.modelConfigPath),
            (key: "conversationsPath", title: "助手对话", path: appInfo.conversationsPath),
            (key: "payloadRoot", title: "程序目录", path: appInfo.payloadRoot),
            (key: "browserRoot", title: "浏览器依赖", path: appInfo.browserDependency?.browserRoot),
        ].compactMap { row in
            guard let path = row.path, !path.isEmpty else { return nil }
            return (row.key, row.title, path)
        }
    }

    func load(using backend: BackendConnectionModel) async {
        guard !isWorking else { return }
        isWorking = true
        defer { isWorking = false }
        errorMessage = nil
        statusMessage = nil
        do {
            if backend.state != .connected { await backend.connect() }
            try await migrateLegacyKeys(using: backend)
            config = try await backend.invoke("modelConfig.load")
            session = backend.session
            appInfo = backend.appInfo
            contextLength = config["contextLength"].stringValue.isEmpty ? "200000" : config["contextLength"].stringValue
            chatTemperature = config["chatTemperature"].stringValue.isEmpty ? "0.2" : config["chatTemperature"].stringValue
            compactTemperature = config["compactTemperature"].stringValue.isEmpty ? "0.1" : config["compactTemperature"].stringValue
            maxToolRounds = config["maxToolRounds"].stringValue.isEmpty ? "50" : config["maxToolRounds"].stringValue
            longPasteThreshold = config["longPasteThreshold"].stringValue.isEmpty ? "4000" : config["longPasteThreshold"].stringValue
            customInstructions = config["customInstructions"].stringValue
            theme = config.firstString("theme").fallback("system")
            imageCaptionEnabled = config["modelRoles"][SettingsModelRole.imageCaption.rawValue]["enabled"].boolValue ?? false
            selectedProviderID = activeProviderID
            loadSelectedProvider()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func selectRole(_ newRole: SettingsModelRole) {
        role = newRole
        selectedProviderID = activeProviderID.isEmpty ? providers.first?.id ?? "" : activeProviderID
        availableModels = []
        hasPassedModelTest = false
        loadSelectedProvider()
    }

    func selectProvider(_ id: String) {
        selectedProviderID = id
        availableModels = []
        hasPassedModelTest = false
        loadSelectedProvider()
    }

    func invalidateModelTest() {
        guard !isTesting else { return }
        hasPassedModelTest = false
    }

    func addProvider(_ preset: SettingsProviderPreset, using backend: BackendConnectionModel) async {
        guard legacyKeyMigrationComplete else { return }
        isWorking = true
        defer { isWorking = false }
        let providerID = "provider_\(UUID().uuidString.replacingOccurrences(of: "-", with: "").lowercased())"
        do {
            config = try await backend.invoke("modelConfig.providerCreate", params: [
                "id": .string(providerID),
                "name": .string(preset.id == "custom" ? "自定义提供商" : preset.name),
                "type": .string("openai"),
                "baseUrl": .string(preset.baseURL),
                "modelName": .string(preset.model),
                "modelRole": .string(role.rawValue),
                "activate": .bool(false),
            ])
            selectProvider(providerID)
            statusMessage = "提供商已添加。保存并测试通过后，可将它设为当前模型。"
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func save(using backend: BackendConnectionModel) async {
        guard legacyKeyMigrationComplete else {
            errorMessage = "旧配置中的 API Key 尚未安全迁移，暂不能保存设置。"
            return
        }
        isWorking = true
        defer { isWorking = false }
        do {
            var request: [String: JSONValue] = [
                "modelRole": .string(role.rawValue),
                "contextLength": .number(Double(Int(contextLength) ?? 200000)),
                "chatTemperature": .number(Double(chatTemperature) ?? 0.2),
                "compactTemperature": .number(Double(compactTemperature) ?? 0.1),
                "maxToolRounds": .number(Double(Int(maxToolRounds) ?? 50)),
                "longPasteThreshold": .number(Double(Int(longPasteThreshold) ?? 4000)),
                "customInstructions": .string(customInstructions),
                "theme": .string(theme),
            ]
            if let provider = selectedProvider {
                let key = apiKeyDraft.trimmingCharacters(in: .whitespacesAndNewlines)
                if !key.isEmpty {
                    try keychain.save(key, role: role.rawValue, providerID: provider.id)
                }
                request["activate"] = .bool(false)
                request["provider"] = .object([
                    "id": .string(provider.id),
                    "type": .string(providerType),
                    "name": .string(providerName.trimmingCharacters(in: .whitespacesAndNewlines)),
                    "baseUrl": .string(baseURL.trimmingCharacters(in: .whitespacesAndNewlines)),
                    "modelName": .string(modelName.trimmingCharacters(in: .whitespacesAndNewlines)),
                ])
            }
            config = try await backend.invoke("modelConfig.save", params: ["config": .object(request)])
            apiKeyDraft = ""
            try await saveImageCaptionEnabled(using: backend)
            await backend.refreshThemePreference()
            refreshKeyStatus()
            statusMessage = "设置已保存；API Key 只保存在这台 Mac 的钥匙串中。"
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func activate(using backend: BackendConnectionModel) async {
        guard let provider = selectedProvider else { return }
        isWorking = true
        defer { isWorking = false }
        do {
            config = try await backend.invoke("modelConfig.providerSelect", params: [
                "providerId": .string(provider.id),
                "modelRole": .string(role.rawValue),
            ])
            statusMessage = "\(role.title)已切换为“\(provider.name)”。"
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func test(using backend: BackendConnectionModel) async {
        guard let provider = selectedProvider else { return }
        isTesting = true
        hasPassedModelTest = false
        defer { isTesting = false }
        do {
            let key = try currentAPIKey(for: provider)
            let keyWasEntered = !apiKeyDraft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            let result = try await backend.invoke("modelConfig.test", params: ["config": .object(candidate(provider: provider, apiKey: key))])
            let message = result.firstString("message").fallback("模型服务连接成功。")
            if result["ok"].boolValue == true {
                if keyWasEntered {
                    try keychain.save(key, role: role.rawValue, providerID: provider.id)
                    apiKeyDraft = ""
                    refreshKeyStatus()
                }
                statusMessage = message
                errorMessage = nil
                hasPassedModelTest = true
            } else {
                statusMessage = nil
                errorMessage = message
                hasPassedModelTest = false
            }
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func fetchModels(using backend: BackendConnectionModel) async {
        guard let provider = selectedProvider else { return }
        isListingModels = true
        defer { isListingModels = false }
        do {
            let key = try currentAPIKey(for: provider)
            let result = try await backend.invoke("modelConfig.list", params: ["config": .object(candidate(provider: provider, apiKey: key))])
            availableModels = result["modelIds"].arrayValue.map(\.stringValue).filter { !$0.isEmpty }
            statusMessage = result.firstString("message").fallback("模型列表已更新。")
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func clearAPIKey() {
        guard let provider = selectedProvider else { return }
        do {
            try keychain.delete(role: role.rawValue, providerID: provider.id)
            keySaved = false
            apiKeyDraft = ""
            hasPassedModelTest = false
            statusMessage = "钥匙串中的 API Key 已清除。"
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func deleteProvider(using backend: BackendConnectionModel) async {
        guard let provider = selectedProvider else { return }
        isWorking = true
        defer { isWorking = false }
        do {
            try keychain.delete(role: role.rawValue, providerID: provider.id)
            config = try await backend.invoke("modelConfig.providerDelete", params: [
                "providerId": .string(provider.id),
                "modelRole": .string(role.rawValue),
            ])
            selectedProviderID = activeProviderID.isEmpty ? providers.first?.id ?? "" : activeProviderID
            loadSelectedProvider()
            statusMessage = "提供商和对应的钥匙串凭据已删除。"
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func refreshSession(using backend: BackendConnectionModel) async {
        isWorking = true
        defer { isWorking = false }
        do {
            try await backend.refreshSessionContext()
            session = backend.session
            statusMessage = "伴学邦课程上下文已刷新。"
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func signOut(using backend: BackendConnectionModel) async {
        isWorking = true
        defer { isWorking = false }
        do {
            try await backend.signOut()
            session = backend.session
            statusMessage = "已退出伴学邦。草稿、对话和工作区文件没有受到影响。"
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func openPath(_ key: String, using backend: BackendConnectionModel) async {
        do {
            _ = try await backend.invoke("app.openPath", params: ["key": .string(key)])
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func refresh(using backend: BackendConnectionModel) async {
        await load(using: backend)
        await backend.refreshSession()
        session = backend.session
        try? await backend.refreshAppInfo()
        appInfo = backend.appInfo
    }

    private func loadSelectedProvider() {
        guard let provider = selectedProvider else {
            providerName = ""
            providerType = "openai"
            baseURL = ""
            modelName = ""
            keySaved = false
            apiKeyDraft = ""
            return
        }
        selectedProviderID = provider.id
        providerName = provider.name
        providerType = provider.type
        baseURL = provider.baseURL
        modelName = provider.modelName
        availableModels = provider.availableModels
        apiKeyDraft = ""
        refreshKeyStatus()
    }

    private func refreshKeyStatus() {
        guard let provider = selectedProvider else {
            keySaved = false
            return
        }
        keySaved = ((try? keychain.load(role: role.rawValue, providerID: provider.id)) ?? nil) != nil
            || provider.hasAPIKey
    }

    private func currentAPIKey(for provider: SettingsProvider) throws -> String {
        let draft = apiKeyDraft.trimmingCharacters(in: .whitespacesAndNewlines)
        if !draft.isEmpty { return draft }
        if let saved = try keychain.load(role: role.rawValue, providerID: provider.id), !saved.isEmpty { return saved }
        throw SettingsKeyError.missing
    }

    private func candidate(provider: SettingsProvider, apiKey: String) -> [String: JSONValue] {
        [
            "modelRole": .string(role.rawValue),
            "activeProviderId": .string(provider.id),
            "apiKey": .string(apiKey),
            "baseUrl": .string(baseURL.trimmingCharacters(in: .whitespacesAndNewlines)),
            "modelName": .string(modelName.trimmingCharacters(in: .whitespacesAndNewlines)),
            "provider": .object([
                "id": .string(provider.id),
                "type": .string(providerType),
                "name": .string(providerName),
                "apiKey": .string(apiKey),
                "baseUrl": .string(baseURL.trimmingCharacters(in: .whitespacesAndNewlines)),
                "modelName": .string(modelName.trimmingCharacters(in: .whitespacesAndNewlines)),
            ]),
        ]
    }

    private func saveImageCaptionEnabled(using backend: BackendConnectionModel) async throws {
        let imageProviderID = config["modelRoles"][SettingsModelRole.imageCaption.rawValue].firstString("activeProviderId")
        _ = try await backend.invoke("modelConfig.save", params: ["config": .object([
            "modelRole": .string(SettingsModelRole.imageCaption.rawValue),
            "enabled": .bool(imageCaptionEnabled),
            "activeProviderId": .string(imageProviderID),
        ])])
    }

    private func migrateLegacyKeys(using backend: BackendConnectionModel) async throws {
        guard !legacyKeyMigrationComplete else { return }
        let result = try await backend.invoke("modelConfig.migrateLegacyKeys")
        let secrets = result["secrets"].arrayValue
        for secret in secrets {
            let role = secret.firstString("role")
            let providerID = secret.firstString("providerId")
            let apiKey = secret.firstString("apiKey")
            guard !role.isEmpty, !providerID.isEmpty, !apiKey.isEmpty else { continue }
            try keychain.save(apiKey, role: role, providerID: providerID)
        }
        if !secrets.isEmpty { _ = try await backend.invoke("modelConfig.scrubLegacyKeys") }
        legacyKeyMigrationComplete = true
    }
}

private enum SettingsKeyError: LocalizedError {
    case missing

    var errorDescription: String? {
        switch self {
        case .missing: "请先输入 API Key，或将已保存的 Key 写入钥匙串。"
        }
    }
}

struct SettingsView: View {
    @Environment(BackendConnectionModel.self) private var backend
    @State private var model = SettingsViewModel()
    @State private var showingSignOutConfirmation = false
    @State private var showingDeleteProviderConfirmation = false

    var body: some View {
        @Bindable var model = model

        Form {
            Section {
                HStack(spacing: 12) {
                    Image(systemName: backend.statusSymbol)
                        .font(.title2)
                        .foregroundStyle(backend.state == .connected ? .green : .orange)
                    VStack(alignment: .leading, spacing: 3) {
                        Text("BXB Homework")
                            .font(.headline)
                        Text(backend.statusText)
                            .foregroundStyle(.secondary)
                    }
                    Spacer()
                    Button {
                        Task { await model.refresh(using: backend) }
                    } label: {
                        Label("刷新", systemImage: "arrow.clockwise")
                    }
                    .disabled(model.isWorking)
                }
                if let error = model.errorMessage {
                    Label(error, systemImage: "exclamationmark.triangle.fill")
                        .foregroundStyle(.red)
                        .textSelection(.enabled)
                } else if let status = model.statusMessage {
                    Label(status, systemImage: "checkmark.circle.fill")
                        .foregroundStyle(.secondary)
                        .textSelection(.enabled)
                }
            } header: {
                Text("运行状态")
            }

            sessionSection

            Section("模型提供商") {
                Picker("配置用途", selection: Binding(
                    get: { model.role },
                    set: { model.selectRole($0) }
                )) {
                    ForEach(SettingsModelRole.allCases) { role in
                        Text(role.title).tag(role)
                    }
                }
                .pickerStyle(.segmented)

                if model.role == .imageCaption {
                    Toggle("启用图片转述模型", isOn: $model.imageCaptionEnabled)
                        .disabled(!model.imageCaptionEnabled && (!model.selectedProviderIsActive || !model.keySaved || !model.hasPassedModelTest || !model.providerConfigurationIsSaved))
                }

                if model.providers.isEmpty {
                    VStack(spacing: 10) {
                        ContentUnavailableView("还没有提供商", systemImage: "server.rack", description: Text("添加一个模型服务后，即可为此用途配置模型。"))
                            .frame(minHeight: 110)
                        Menu {
                            ForEach(SettingsViewModel.presets) { preset in
                                Button(preset.name) {
                                    Task { await model.addProvider(preset, using: backend) }
                                }
                            }
                        } label: {
                            Label("新增提供商", systemImage: "plus")
                        }
                        .disabled(model.isWorking)
                    }
                } else {
                    Picker("提供商", selection: Binding(
                        get: { model.selectedProviderID },
                        set: { model.selectProvider($0) }
                    )) {
                        ForEach(model.providers) { provider in
                            Text(provider.name).tag(provider.id)
                        }
                    }
                    .disabled(model.isWorking)

                    if !model.selectedProviderIsActive, model.selectedProvider != nil {
                        Label("尚未设为当前模型", systemImage: "info.circle")
                            .foregroundStyle(.secondary)
                    }

                    TextField("名称", text: $model.providerName)
                        .onChange(of: model.providerName) { model.invalidateModelTest() }
                        .disabled(model.isWorking || model.isTesting)
                    TextField("API Base URL", text: $model.baseURL)
                        .textContentType(.URL)
                        .autocorrectionDisabled()
                        .onChange(of: model.baseURL) { model.invalidateModelTest() }
                        .disabled(model.isWorking || model.isTesting)
                    TextField("模型名称", text: $model.modelName)
                        .autocorrectionDisabled()
                        .onChange(of: model.modelName) { model.invalidateModelTest() }
                        .disabled(model.isWorking || model.isTesting)

                    SecureField("API Key", text: $model.apiKeyDraft, prompt: Text(model.keySaved ? "已保存在钥匙串；留空表示不修改" : "输入 API Key"))
                        .textContentType(.password)
                        .autocorrectionDisabled()
                        .onChange(of: model.apiKeyDraft) { model.invalidateModelTest() }
                        .disabled(model.isWorking || model.isTesting)
                    HStack {
                        Label(model.keySaved ? "API Key 已保存在本机钥匙串" : "尚未保存 API Key", systemImage: model.keySaved ? "key.fill" : "key")
                            .foregroundStyle(.secondary)
                        Spacer()
                        if model.keySaved {
                            Button("清除 Key", role: .destructive) { model.clearAPIKey() }
                                .disabled(model.isWorking)
                        }
                    }

                    HStack {
                        Button {
                            Task { await model.save(using: backend) }
                        } label: {
                            Label("保存配置", systemImage: "square.and.arrow.down")
                        }
                        .disabled(model.isWorking || !model.legacyKeyMigrationComplete)

                        Button {
                            Task { await model.test(using: backend) }
                        } label: {
                            if model.isTesting { ProgressView().controlSize(.small) }
                            else { Label("测试连接", systemImage: "bolt.horizontal") }
                        }
                        .disabled(model.isTesting || model.isWorking)

                        Button {
                            Task { await model.fetchModels(using: backend) }
                        } label: {
                            if model.isListingModels { ProgressView().controlSize(.small) }
                            else { Label("获取模型", systemImage: "list.bullet") }
                        }
                        .disabled(model.isListingModels || model.isWorking)
                    }

                    if !model.availableModels.isEmpty {
                        Picker("从列表选择模型", selection: $model.modelName) {
                            ForEach(model.availableModels, id: \.self) { name in Text(name).tag(name) }
                        }
                    }

                    HStack {
                        Menu {
                            ForEach(SettingsViewModel.presets) { preset in
                                Button(preset.name) {
                                    Task { await model.addProvider(preset, using: backend) }
                                }
                            }
                        } label: {
                            Label("新增提供商", systemImage: "plus")
                        }
                        .disabled(model.isWorking)

                        Button("设为当前模型") {
                            Task { await model.activate(using: backend) }
                        }
                        .disabled(model.isWorking || model.selectedProviderIsActive || !model.keySaved || !model.hasPassedModelTest || !model.providerConfigurationIsSaved)

                        Spacer()
                        Button("删除提供商", role: .destructive) {
                            showingDeleteProviderConfirmation = true
                        }
                        .disabled(model.isWorking || model.selectedProvider == nil)
                    }
                    .padding(.top, 4)
                }
            }

            Section("助理参数") {
                TextField("最大上下文长度", text: $model.contextLength)
                    .frame(maxWidth: 220)
                HStack {
                    TextField("对话 Temperature", text: $model.chatTemperature)
                    TextField("压缩 Temperature", text: $model.compactTemperature)
                }
                .frame(maxWidth: 440)
                HStack {
                    TextField("最大工具轮数", text: $model.maxToolRounds)
                    TextField("长文本拆分阈值", text: $model.longPasteThreshold)
                }
                .frame(maxWidth: 440)
                Picker("外观", selection: $model.theme) {
                    Text("跟随系统").tag("system")
                    Text("浅色").tag("light")
                    Text("深色").tag("dark")
                }
                .frame(maxWidth: 360)
                TextField("自定义指令", text: $model.customInstructions, axis: .vertical)
                    .lineLimit(4...9)
                HStack {
                    Spacer()
                    Button("保存助理参数") {
                        Task { await model.save(using: backend) }
                    }
                    .disabled(model.isWorking || !model.legacyKeyMigrationComplete)
                }
            }

            Section("本地数据与版本") {
                LabeledContent("应用版本", value: model.appInfo.map { "\($0.version) · \($0.platform)" } ?? "读取中")
                LabeledContent("运行环境", value: runtimeSummary)
                LabeledContent("Node.js", value: model.appInfo?.nodeVersion ?? "—")
                ForEach(model.pathRows, id: \.key) { row in
                    HStack(alignment: .top, spacing: 12) {
                        VStack(alignment: .leading, spacing: 3) {
                            Text(row.title)
                            Text(row.path)
                                .font(.caption.monospaced())
                                .foregroundStyle(.secondary)
                                .textSelection(.enabled)
                                .lineLimit(2)
                        }
                        Spacer(minLength: 8)
                        Button("在 Finder 中打开") {
                            Task { await model.openPath(row.key, using: backend) }
                        }
                        .buttonStyle(.borderless)
                    }
                }
            }
        }
        .formStyle(.grouped)
        .padding(.horizontal, 14)
        .frame(minWidth: 600, idealWidth: 760, minHeight: 500, idealHeight: 680)
        .preferredColorScheme(model.theme == "dark" ? .dark : model.theme == "light" ? .light : nil)
        .task { await model.load(using: backend) }
        .confirmationDialog("退出伴学邦？", isPresented: $showingSignOutConfirmation, titleVisibility: .visible) {
            Button("退出登录", role: .destructive) { Task { await model.signOut(using: backend) } }
            Button("取消", role: .cancel) {}
        } message: {
            Text("只会删除本机保存的伴学邦登录会话，不会删除模型配置、草稿、对话或工作区文件。")
        }
        .confirmationDialog("删除这个提供商？", isPresented: $showingDeleteProviderConfirmation, titleVisibility: .visible) {
            Button("删除提供商", role: .destructive) { Task { await model.deleteProvider(using: backend) } }
            Button("取消", role: .cancel) {}
        } message: {
            Text("提供商配置及对应的钥匙串 API Key 都会删除。")
        }
    }

    private var sessionSection: some View {
        Section("伴学邦账号") {
            LabeledContent("登录状态", value: model.sessionSummary)
            Text(model.sessionDetails)
                .foregroundStyle(.secondary)
            HStack {
                Button {
                    Task { await model.refreshSession(using: backend) }
                } label: {
                    Label("刷新课程上下文", systemImage: "arrow.clockwise")
                }
                .disabled(model.isWorking || model.session?.ready != true)

                Spacer()
                Button("退出登录", role: .destructive) {
                    showingSignOutConfirmation = true
                }
                .disabled(model.isWorking || model.session?.ready != true)
            }
        }
    }

    private var runtimeSummary: String {
        guard let info = model.appInfo else { return "读取中" }
        let packaged = info.isPackaged ? "已打包" : "开发版本"
        let browser: String
        if info.browserDependency?.ready == true { browser = "浏览器依赖就绪" }
        else if info.browserDependency?.ready == false { browser = "浏览器依赖未就绪" }
        else { browser = "本地后端正常" }
        return "\(packaged) · \(browser)"
    }
}

private extension String {
    func fallback(_ value: String) -> String { isEmpty ? value : self }
}
