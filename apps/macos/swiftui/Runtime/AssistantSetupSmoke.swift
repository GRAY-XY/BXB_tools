import Foundation

@MainActor
private final class FixtureKeys: ModelAPIKeyStore {
    var values: [String: String] = [:]
    var failRead = false
    var failWrite = false
    func load(role: String, providerID: String) throws -> String? {
        if failRead { throw SetupConfigurationError.message("钥匙串访问被拒绝") }
        return values[role + ":" + providerID]
    }
    func save(_ key: String, role: String, providerID: String) throws {
        if failWrite { throw SetupConfigurationError.message("钥匙串写入失败") }
        values[role + ":" + providerID] = key
    }
    func delete(role: String, providerID: String) throws { values.removeValue(forKey: role + ":" + providerID) }
}

@MainActor
private final class FixtureBackend {
    var config: JSONValue = .object(["modelRoles": .object(["chat": .object(["activeProviderId": .string("old"), "providers": .array([])])])])
    var failLoad = false
    var failSave = false
    var loseSaveReply = false
    var holdProbe: CheckedContinuation<JSONValue, Error>?
    var delayProbe = false
    var saves = 0
    var secrets: [JSONValue] = []
    func invoke(_ method: String, _ params: [String: JSONValue]) async throws -> JSONValue {
        switch method {
        case "modelConfig.load":
            if failLoad { throw SetupConfigurationError.message("配置读取失败") }
            return config
        case "modelConfig.migrateLegacyKeys": return .object(["secrets": .array(secrets)])
        case "modelConfig.scrubLegacyKeys": secrets = []; return config
        case "modelConfig.probe":
            if delayProbe { return try await withCheckedThrowingContinuation { holdProbe = $0 } }
            return .object(["ok": .bool(true)])
        case "modelConfig.list": return .object(["modelIds": .array([])])
        case "modelConfig.setupSave":
            saves += 1
            if failSave { throw SetupConfigurationError.message("配置保存失败") }
            let p = params["config"]?["provider"] ?? .null
            config = .object(["modelRoles": .object(["chat": .object(["activeProviderId": p["id"], "providers": .array([p])])])])
            if loseSaveReply { throw SetupConfigurationError.message("响应丢失") }
            return config
        default: throw SetupConfigurationError.message("unexpected fixture method")
        }
    }
}

@main
struct AssistantSetupSmoke {
    @MainActor static func main() async throws {
        let keys = FixtureKeys(); let fixture = FixtureBackend()
        let suite = "bxb-setup-fixture-" + UUID().uuidString
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        let service = ModelConfigurationService(keys: keys, invoke: fixture.invoke)
        let model = AssistantSetupModel(service: service, defaults: defaults)
        await model.prepare()
        precondition(model.needsSetup && model.wantsPresentation, "new installation opens setup")
        model.skip()
        precondition(!model.wantsPresentation && model.apiKeyDraft.isEmpty)
        let restarted = AssistantSetupModel(service: service, defaults: defaults)
        await restarted.prepare()
        precondition(!restarted.wantsPresentation, "skip survives restart")
        await restarted.open()
        precondition(restarted.wantsPresentation, "manual entry overrides skip")
        restarted.baseURL = "http://localhost/v1"; restarted.modelName = "model"; restarted.apiKeyDraft = "new-secret"
        await restarted.testConnection()
        precondition(restarted.canFinish)
        restarted.modelName = "different"
        precondition(!restarted.canFinish, "edit invalidates passing probe")
        fixture.delayProbe = true
        let probe = Task { await restarted.testConnection() }
        while fixture.holdProbe == nil { await Task.yield() }
        restarted.skip()
        fixture.holdProbe?.resume(returning: .object(["ok": .bool(true)])); fixture.holdProbe = nil
        await probe.value
        precondition(!restarted.canFinish && restarted.apiKeyDraft.isEmpty && fixture.saves == 0, "late reply after exit cannot save")
        fixture.delayProbe = false
        await restarted.open()
        restarted.baseURL = "http://localhost/v1"; restarted.modelName = "model"; restarted.apiKeyDraft = "new-secret"
        let candidateID = restarted.providerID
        await restarted.testConnection()
        keys.failWrite = true
        await restarted.finish()
        precondition(restarted.wantsPresentation && fixture.saves == 0)
        keys.failWrite = false; fixture.failSave = true
        await restarted.finish()
        precondition(restarted.wantsPresentation && keys.values["chat:" + candidateID] == nil, "failed metadata save restores key")
        fixture.failSave = false; fixture.loseSaveReply = true
        await restarted.finish()
        precondition(!restarted.wantsPresentation && restarted.apiKeyDraft.isEmpty && !restarted.needsSetup, "lost reply is confirmed by readback")
        precondition(keys.values["chat:" + candidateID] == "new-secret")
        // Uncertain persistence blocks edits/exit, and retry confirms without a second write.
        fixture.loseSaveReply = false
        await restarted.open()
        restarted.apiKeyDraft = "replacement-secret"
        await restarted.testConnection()
        fixture.failLoad = true
        let beforeSaves = fixture.saves
        await restarted.finish()
        precondition(restarted.hasUnconfirmedSave && restarted.wantsPresentation)
        restarted.skip()
        precondition(restarted.wantsPresentation, "uncertain save cannot discard recovery")
        fixture.failLoad = false
        await restarted.finish()
        precondition(!restarted.wantsPresentation && fixture.saves == beforeSaves + 1)
        precondition(keys.values["chat:" + candidateID] == "replacement-secret")
        let configured = AssistantSetupModel(service: service, defaults: defaults)
        await configured.prepare()
        precondition(!configured.wantsPresentation && !configured.needsSetup, "Keychain config bypasses first run")
        await configured.open()
        precondition(configured.apiKeyDraft.isEmpty && configured.keySaved, "saved key is never filled into input")
        let firstOwner = UUID(), secondOwner = UUID()
        configured.claimPresentation(firstOwner); configured.claimPresentation(secondOwner)
        precondition(configured.presentationOwner == firstOwner, "only one window presents")
        configured.releasePresentation(secondOwner)
        precondition(configured.wantsPresentation)
        configured.skip()
        fixture.failLoad = true
        let broken = AssistantSetupModel(service: service, defaults: defaults)
        await broken.prepare()
        precondition(broken.errorMessage != nil && !broken.needsSetup, "read failure is not a new installation")
        fixture.failLoad = false; keys.failRead = true
        await broken.prepare()
        precondition(broken.errorMessage != nil, "Keychain denial is visible")
        keys.failRead = false
        fixture.secrets = [.object(["role": .string("chat"), "providerId": .string("legacy"), "apiKey": .string("legacy-key")])]
        keys.failWrite = true
        let migrationService = ModelConfigurationService(keys: keys, invoke: fixture.invoke)
        do { _ = try await migrationService.load(); preconditionFailure("migration must fail") } catch {}
        precondition(!fixture.secrets.isEmpty, "failed migration retains plaintext")
        keys.failWrite = false
        _ = try await migrationService.load()
        precondition(fixture.secrets.isEmpty && keys.values["chat:legacy"] == "legacy-key")
        print("assistant-setup=ok startup skip reopen errors keychain migration probe revision cancellation recovery")
    }
}
