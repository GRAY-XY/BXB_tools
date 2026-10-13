import Foundation

/// Shared migration, Keychain access and candidate requests. The transport and
/// credential store are injected; smoke tests never touch the user's Keychain.
@MainActor
final class ModelConfigurationService {
    typealias Invoke = @MainActor (String, [String: JSONValue]) async throws -> JSONValue
    let keys: any ModelAPIKeyStore
    private let invoke: Invoke
    private var migration: Task<Void, Error>?
    private var pendingSave: PendingSave?

    private struct PendingSave {
        let candidate: ModelSetupCandidate
        let oldKey: String?
        let newKey: String
        let expectedChat: JSONValue
    }
    var hasUnconfirmedSave: Bool { pendingSave != nil }

    init(keys: any ModelAPIKeyStore = ModelAPIKeychainStore(), invoke: @escaping Invoke) {
        self.keys = keys
        self.invoke = invoke
    }

    func migrateLegacyKeys() async throws {
        if let migration { return try await migration.value }
        let task = Task { @MainActor in
            let result = try await self.invoke("modelConfig.migrateLegacyKeys", [:])
            let secrets = result["secrets"].arrayValue
            for secret in secrets {
                let role = secret.firstString("role"), id = secret.firstString("providerId"), key = secret.firstString("apiKey")
                guard !role.isEmpty, !id.isEmpty, !key.isEmpty else {
                    throw SetupConfigurationError.message("旧模型凭据格式无效，未清除原配置。")
                }
                // A newer Keychain entry wins over stale plaintext from an interrupted migration.
                if try self.keys.load(role: role, providerID: id) == nil {
                    try self.keys.save(key, role: role, providerID: id)
                }
            }
            if !secrets.isEmpty { _ = try await self.invoke("modelConfig.scrubLegacyKeys", [:]) }
        }
        migration = task
        do { try await task.value } catch { migration = nil; throw error }
    }

    func load() async throws -> JSONValue {
        try await migrateLegacyKeys()
        return try await invoke("modelConfig.load", [:])
    }

    static func providers(_ config: JSONValue, role: String = "chat") -> [ModelProvider] {
        let values = config["modelRoles"][role]["providers"].arrayValue
        return (values.isEmpty && role == "chat" ? config["providers"].arrayValue : values).map(ModelProvider.init)
    }
    static func activeID(_ config: JSONValue) -> String {
        let id = config["modelRoles"]["chat"].firstString("activeProviderId", "providerId")
        return id.isEmpty ? config.firstString("activeProviderId") : id
    }
    func isChatReady(_ config: JSONValue) throws -> Bool {
        guard let provider = Self.providers(config).first(where: { $0.id == Self.activeID(config) }),
              !provider.modelName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              ModelSetupCandidate.validEndpoint(provider.baseURL) else { return false }
        return try keys.load(role: "chat", providerID: provider.id)?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false
    }
    func apiKey(role: String, providerID: String, draft: String) throws -> String {
        try Self.apiKeyFromStore(keys, role: role, providerID: providerID, draft: draft)
    }
    static func apiKeyFromStore(_ keys: any ModelAPIKeyStore, role: String, providerID: String, draft: String) throws -> String {
        let draft = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        if !draft.isEmpty { return draft }
        if let key = try keys.load(role: role, providerID: providerID), !key.isEmpty { return key }
        throw SetupConfigurationError.message("请先输入 API Key。")
    }
    func request(_ method: String, candidate: ModelSetupCandidate, draft: String) async throws -> JSONValue {
        let key = try apiKey(role: "chat", providerID: candidate.providerID, draft: draft)
        return try await request(method, role: "chat", provider: candidate.providerJSON, apiKey: key)
    }
    func request(_ method: String, role: String, provider: JSONValue, apiKey: String) async throws -> JSONValue {
        guard case .object(var value) = provider else { throw SetupConfigurationError.message("提供商配置无效。") }
        value["apiKey"] = .string(apiKey)
        return try await invoke(method, ["config": .object([
            "modelRole": .string(role), "provider": .object(value),
        ])])
    }

    /// Keep the old key until the atomic metadata commit is confirmed. If the
    /// bridge reply is lost, read back instead of issuing a duplicate save.
    func save(_ candidate: ModelSetupCandidate, draft: String, expectedChat: JSONValue) async throws -> JSONValue {
        guard pendingSave == nil else { return try await resolvePendingSave() }
        let key = try apiKey(role: "chat", providerID: candidate.providerID, draft: draft)
        let oldKey = try keys.load(role: "chat", providerID: candidate.providerID)
        try keys.save(key, role: "chat", providerID: candidate.providerID)
        pendingSave = PendingSave(candidate: candidate, oldKey: oldKey, newKey: key, expectedChat: expectedChat)
        do {
            _ = try await invoke("modelConfig.setupSave", ["config": .object(["provider": candidate.providerJSON]), "expectedChat": expectedChat])
        } catch {
            // Confirmation below distinguishes failed write from missing reply.
        }
        return try await resolvePendingSave()
    }

    func resolvePendingSave() async throws -> JSONValue {
        guard let pending = pendingSave else { throw SetupConfigurationError.message("没有待确认的保存。") }
        let actual: JSONValue
        do { actual = try await invoke("modelConfig.load", [:]) }
        catch { throw SetupConfigurationError.message("保存结果暂时无法确认，请点击“确认保存结果”。确认前不要修改设置或退出。") }
        let c = pending.candidate
        let stored = Self.providers(actual).first { $0.id == c.providerID }
        if Self.activeID(actual) == c.providerID, stored?.name == c.name, stored?.type == c.type,
           stored?.baseURL == c.baseURL, stored?.modelName == c.modelName {
            pendingSave = nil
            return actual
        }
        // If another editor changed this provider, do not roll its key back blindly.
        let old = Self.providers(.object(["modelRoles": .object(["chat": pending.expectedChat])])).first { $0.id == c.providerID }
        guard stored == old else {
            throw SetupConfigurationError.message("提供商在保存期间被其他窗口修改，无法安全恢复。请先恢复连接并确认保存结果。")
        }
        do {
            if let oldKey = pending.oldKey { try keys.save(oldKey, role: "chat", providerID: c.providerID) }
            else { try keys.delete(role: "chat", providerID: c.providerID) }
        } catch { throw SetupConfigurationError.message("配置未保存，旧钥匙串凭据恢复失败。请点击“确认保存结果”重试。") }
        pendingSave = nil
        throw SetupConfigurationError.message("配置保存未完成，旧配置和凭据已保留。请重新打开引导后重试。")
    }
}
