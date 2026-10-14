import SwiftUI

struct AssistantSetupView: View {
    @Bindable var model: AssistantSetupModel

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack {
                Image(systemName: "sparkles").font(.title).foregroundStyle(.tint)
                VStack(alignment: .leading) {
                    Text("设置智能助理").font(.title2.bold())
                    Text(model.page == 0 ? "第 1 步，共 2 步 · 连接模型服务" : "第 2 步，共 2 步 · 选择并测试模型")
                        .foregroundStyle(.secondary)
                }
            }
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    if model.page == 0 { connectionForm } else { modelForm }
                    if let error = model.errorMessage {
                        Label(error, systemImage: "exclamationmark.triangle")
                            .foregroundStyle(.red).fixedSize(horizontal: false, vertical: true)
                            .textSelection(.enabled).accessibilityLabel("错误：" + error)
                    }
                    if let status = model.statusMessage {
                        Label(status, systemImage: model.testPassed ? "checkmark.circle" : "info.circle")
                            .foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                    }
                    if model.isWorking { ProgressView(model.isSaving ? "正在确认保存…" : "正在连接…") }
                }
                .padding(2)
            }
            Divider()
            HStack {
                Button("稍后设置") { model.skip() }
                    .keyboardShortcut(.cancelAction)
                    .disabled(model.isSaving || model.hasUnconfirmedSave)
                Spacer()
                if model.page == 1 {
                    Button("上一步") { model.page = 0 }
                        .disabled(model.isWorking || model.hasUnconfirmedSave)
                    Button(model.hasUnconfirmedSave ? "确认保存结果" : "完成配置") {
                        Task { await model.finish() }
                    }
                    .keyboardShortcut(.defaultAction)
                    .disabled((!model.canFinish && !model.hasUnconfirmedSave) || model.isSaving)
                } else {
                    Button("下一步") { model.page = 1 }
                        .keyboardShortcut(.defaultAction)
                        .disabled(!model.canContinue || model.isWorking)
                }
            }
        }
        .padding(24)
        .frame(minWidth: 500, idealWidth: 560, maxWidth: 660, minHeight: 440, idealHeight: 540, maxHeight: 650)
        .interactiveDismissDisabled(model.isSaving || model.hasUnconfirmedSave)
    }

    private var connectionForm: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("选择提供商，或填写 OpenAI 兼容服务。API Key 仅在完成配置后保存到这台 Mac 的钥匙串。")
                .foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            HStack {
                Menu("使用服务预设") {
                    ForEach(ModelProviderPreset.all) { preset in
                        Button(preset.name) { model.selectPreset(preset) }
                    }
                }
                if !model.providers.isEmpty {
                    Menu("使用已有提供商") {
                        ForEach(model.providers) { provider in
                            Button(provider.name) { model.selectProvider(provider.id) }
                        }
                    }
                }
            }
            field("提供商名称", text: $model.providerName)
            field("Base URL", text: $model.baseURL)
            VStack(alignment: .leading, spacing: 6) {
                Text("API Key").font(.headline)
                SecureField(model.keySaved ? "已保存；留空以继续使用，或输入新 Key" : "输入 API Key", text: $model.apiKeyDraft)
                    .textFieldStyle(.roundedBorder).accessibilityLabel("API Key")
                if model.keySaved { Text("已保存").font(.caption).foregroundStyle(.secondary) }
            }
            Link("查看 API Key 获取教程", destination: URL(string: "https://www.bilibili.com/opus/1248657725804511251")!)
        }
        .disabled(model.isWorking || model.hasUnconfirmedSave)
    }
    private var modelForm: some View {
        VStack(alignment: .leading, spacing: 14) {
            LabeledContent("服务", value: model.providerName)
            Text(model.baseURL).font(.caption).foregroundStyle(.secondary).textSelection(.enabled)
            Button("读取模型列表") { Task { await model.fetchModels() } }
                .disabled(model.isWorking || model.hasUnconfirmedSave)
            if !model.availableModels.isEmpty {
                Picker("可用模型", selection: $model.modelName) {
                    if !model.availableModels.contains(model.modelName) { Text(model.modelName.isEmpty ? "请选择" : model.modelName).tag(model.modelName) }
                    ForEach(model.availableModels, id: \.self) { Text($0).tag($0) }
                }
                .disabled(model.isWorking || model.hasUnconfirmedSave)
            }
            field("模型 ID（可直接填写）", text: $model.modelName)
                .disabled(model.isWorking || model.hasUnconfirmedSave)
            Text("测试会向所选服务发送一条固定短文本，可能产生少量模型调用费用。收到有效文本回复后才能完成配置。")
                .font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            Button("测试模型回复") { Task { await model.testConnection() } }
                .disabled(!model.canContinue || model.modelName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || model.isWorking || model.hasUnconfirmedSave)
        }
    }
    private func field(_ title: String, text: Binding<String>) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title).font(.headline)
            TextField(title, text: text).textFieldStyle(.roundedBorder).accessibilityLabel(title)
        }
    }
}

/// One owner across all WindowGroup and Settings windows. Each actual window
/// installs this modifier once; all windows share the same model instance.
struct AssistantSetupPresenter: ViewModifier {
    @Environment(AssistantSetupModel.self) private var model
    @State private var owner = UUID()
    @State private var isVisible = false
    func body(content: Content) -> some View {
        content
            .onAppear {
                isVisible = true
                model.claimPresentation(owner)
            }
            .onChange(of: model.wantsPresentation) { _, wants in
                if isVisible && wants { model.claimPresentation(owner) }
            }
            .onChange(of: model.presentationOwner) { _, currentOwner in
                if isVisible && currentOwner == nil { model.claimPresentation(owner) }
            }
            .sheet(isPresented: Binding(
                get: { model.wantsPresentation && model.presentationOwner == owner },
                set: { if !$0 { model.skip() } }
            )) { AssistantSetupView(model: model) }
            .onDisappear {
                isVisible = false
                model.releasePresentation(owner)
            }
    }
}
