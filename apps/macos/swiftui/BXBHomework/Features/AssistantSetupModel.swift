import Foundation
import Observation

@MainActor
@Observable
final class AssistantSetupModel {
    private let service: ModelConfigurationService
    private let defaults: UserDefaults
    private let skipKey = "assistantSetup.skipped.v1"
    private var epoch = 0
    private var revision = 0
    private var testedRevision: Int?
    private(set) var config: JSONValue = .null
    private(set) var wantsPresentation = false
    private(set) var needsSetup = false
    private(set) var prepared = false
    private(set) var isPreparing = false
    private(set) var isListing = false
    private(set) var isTesting = false
    private(set) var isSaving = false
    private(set) var errorMessage: String?
    private(set) var statusMessage: String?
    private(set) var availableModels: [String] = []
    private(set) var keySaved = false
    private(set) var configurationRevision = 0
    private(set) var presentationOwner: UUID?
    var page = 0
    var providerID = "provider_" + UUID().uuidString.replacingOccurrences(of: "-", with: "").lowercased() { didSet { invalidate() } }
    var providerName = "" { didSet { invalidate() } }
    var providerType = "openai" { didSet { invalidate() } }
    var baseURL = "" { didSet { invalidate() } }
    var modelName = "" { didSet { invalidate() } }
    var apiKeyDraft = "" { didSet { invalidate() } }

    init(service: ModelConfigurationService, defaults: UserDefaults = .standard) {
        self.service = service; self.defaults = defaults
    }
    var providers: [ModelProvider] { ModelConfigurationService.providers(config) }
    var isWorking: Bool { isPreparing || isListing || isTesting || isSaving }
    var hasUnconfirmedSave: Bool { service.hasUnconfirmedSave }
    var canContinue: Bool {
        !providerName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && ModelSetupCandidate.validEndpoint(baseURL.trimmingCharacters(in: .whitespacesAndNewlines))
            && (!apiKeyDraft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || keySaved)
    }
    var canFinish: Bool { testedRevision == revision && canContinue && !isWorking && !hasUnconfirmedSave }
    var testPassed: Bool { testedRevision == revision }
    private var candidate: ModelSetupCandidate {
        ModelSetupCandidate(providerID: providerID, name: providerName.trimmingCharacters(in: .whitespacesAndNewlines),
                            type: providerType, baseURL: baseURL.trimmingCharacters(in: .whitespacesAndNewlines),
                            modelName: modelName.trimmingCharacters(in: .whitespacesAndNewlines))
    }
    private func invalidate() { revision += 1; testedRevision = nil; statusMessage = nil }
    func claimPresentation(_ owner: UUID) {
        if wantsPresentation && presentationOwner == nil { presentationOwner = owner }
    }
    func releasePresentation(_ owner: UUID) {
        guard presentationOwner == owner else { return }
        if isSaving || hasUnconfirmedSave {
            // The transaction belongs to the shared model, not to a window.
            // Release only the presentation lease so another window can recover.
            presentationOwner = nil
        } else { skip() }
    }

    func prepare() async {
        guard !isPreparing, !wantsPresentation, !hasUnconfirmedSave else { return }
        epoch += 1; let token = epoch
        isPreparing = true; errorMessage = nil
        do {
            let loaded = try await service.load()
            let ready = try service.isChatReady(loaded)
            guard token == epoch else { return }
            config = loaded; needsSetup = !ready; prepared = true
            if !ready && !defaults.bool(forKey: skipKey) { beginEditing() }
        } catch {
            guard token == epoch else { return }
            errorMessage = error.localizedDescription
            prepared = false
        }
        if token == epoch { isPreparing = false }
    }

    func open() async {
        guard !wantsPresentation, !isSaving, !isPreparing, !hasUnconfirmedSave else { return }
        epoch += 1; let token = epoch; isPreparing = true; errorMessage = nil
        do {
            let loaded = try await service.load()
            let ready = try service.isChatReady(loaded)
            guard token == epoch else { return }
            config = loaded; needsSetup = !ready; prepared = true; beginEditing()
        } catch { if token == epoch { errorMessage = error.localizedDescription } }
        if token == epoch { isPreparing = false }
    }
    private func beginEditing() {
        page = 0; apiKeyDraft = ""; availableModels = []; errorMessage = nil
        if let active = providers.first(where: { $0.id == ModelConfigurationService.activeID(config) }),
           !active.baseURL.isEmpty { selectProvider(active.id) }
        else { selectPreset(ModelProviderPreset.all[0]) }
        wantsPresentation = true
    }
    func selectProvider(_ id: String) {
        guard !hasUnconfirmedSave, !isSaving, let p = providers.first(where: { $0.id == id }) else { return }
        providerID = p.id; providerName = p.name; providerType = p.type
        baseURL = p.baseURL; modelName = p.modelName; apiKeyDraft = ""
        availableModels = p.availableModels
        do { keySaved = try service.keys.load(role: "chat", providerID: id)?.isEmpty == false; errorMessage = nil }
        catch { keySaved = false; errorMessage = error.localizedDescription }
    }
    func selectPreset(_ preset: ModelProviderPreset) {
        guard !hasUnconfirmedSave, !isSaving else { return }
        providerID = "provider_" + UUID().uuidString.replacingOccurrences(of: "-", with: "").lowercased()
        providerName = preset.id == "custom" ? "自定义提供商" : preset.name
        providerType = "openai"; baseURL = preset.baseURL; modelName = preset.model
        apiKeyDraft = ""; keySaved = false; availableModels = []; errorMessage = nil
    }
    func skip() {
        guard !isSaving, !hasUnconfirmedSave else { return }
        epoch += 1; defaults.set(true, forKey: skipKey)
        apiKeyDraft = ""; invalidate(); availableModels = []
        isTesting = false; isListing = false; wantsPresentation = false; presentationOwner = nil
        errorMessage = nil; statusMessage = nil
    }
    func fetchModels() async {
        guard canContinue, !isWorking, !hasUnconfirmedSave else { return }
        let token = epoch, edit = revision; let c = candidate
        isListing = true; errorMessage = nil; availableModels = []
        defer { if token == epoch { isListing = false } }
        do {
            let result = try await service.request("modelConfig.list", candidate: c, draft: apiKeyDraft)
            guard token == epoch, edit == revision else { return }
            availableModels = result["modelIds"].arrayValue.map(\.stringValue).filter { !$0.isEmpty }
            statusMessage = availableModels.isEmpty ? "没有读取到模型。可以直接填写模型 ID 并测试回复。" : "模型列表已读取，请主动测试回复。"
        } catch { if token == epoch && edit == revision { errorMessage = safeMessage(error) } }
        if token == epoch { isListing = false }
    }
    func testConnection() async {
        guard canContinue, !candidate.modelName.isEmpty, !isWorking, !hasUnconfirmedSave else { return }
        let token = epoch, edit = revision; let c = candidate
        isTesting = true; testedRevision = nil; errorMessage = nil; statusMessage = nil
        defer { if token == epoch { isTesting = false } }
        do {
            let result = try await service.request("modelConfig.probe", candidate: c, draft: apiKeyDraft)
            guard token == epoch, edit == revision else { return }
            guard result["ok"].boolValue == true else { throw SetupConfigurationError.message("模型回复测试未通过。") }
            testedRevision = edit; statusMessage = "已收到模型文本回复，可以完成配置。"
        } catch { if token == epoch && edit == revision { errorMessage = safeMessage(error) } }
        if token == epoch { isTesting = false }
    }
    func finish() async {
        guard canFinish || (hasUnconfirmedSave && !isSaving) else { return }
        isSaving = true; errorMessage = nil
        do {
            let saved = try await service.save(candidate, draft: apiKeyDraft, expectedChat: config["modelRoles"]["chat"])
            config = saved; needsSetup = false; prepared = true
            defaults.removeObject(forKey: skipKey)
            apiKeyDraft = ""; keySaved = true; wantsPresentation = false; presentationOwner = nil
            configurationRevision += 1
        } catch { errorMessage = safeMessage(error) }
        isSaving = false
    }
    private func safeMessage(_ error: Error) -> String {
        let key = apiKeyDraft.trimmingCharacters(in: .whitespacesAndNewlines)
        return key.isEmpty ? error.localizedDescription : error.localizedDescription.replacingOccurrences(of: key, with: "[凭据已隐藏]")
    }
}
