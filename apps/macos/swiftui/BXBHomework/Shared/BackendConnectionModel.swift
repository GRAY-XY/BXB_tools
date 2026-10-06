import Foundation
import Observation

@MainActor
@Observable
final class BackendConnectionModel {
    enum State: Equatable {
        case disconnected
        case connecting
        case connected
        case failed(String)
    }

    private(set) var state: State = .disconnected
    private(set) var appInfo: BackendAppInfo?
    private(set) var session: BackendSessionStatus?
    private(set) var themePreference = "system"
    private let client: NodeBackendClient
    private(set) var contextRevision = 0
    private(set) var isLoadingTerms = false
    private(set) var isSwitchingTerm = false
    private(set) var termErrorMessage: String?
    private(set) var pendingHomeworkCount: Int?
    private(set) var isLoadingPendingCount = false
    private(set) var pendingCountError: String?
    private var needsContextRefresh = false
    private var sessionActivities: Set<UUID> = []

    init(client: NodeBackendClient = NodeBackendClient()) { self.client = client }

    var academicContextReady: Bool {
        session?.ready == true && !isSwitchingTerm && !needsContextRefresh
    }

    var contextKey: String {
        "\(session?.user?.id ?? "")|\(session?.currentClass?.id ?? "")|\(session?.currentTermId ?? "")|\(contextRevision)|\(academicContextReady)"
    }

    var availableTerms: [BackendSessionStatus.Term] {
        var seen = Set<String>()
        return (session?.availableTerms ?? []).filter {
            guard let id = $0.id, !($0.name ?? "").isEmpty else { return false }
            return seen.insert(id).inserted
        }
    }

    var canSwitchTerm: Bool {
        academicContextReady && !isLoadingTerms && sessionActivities.isEmpty
    }

    func beginSessionActivity(requiresSession: Bool = true) throws -> UUID {
        guard !isSwitchingTerm, !needsContextRefresh else {
            throw BackendBridgeError.remote("请等待学期切换完成，或先刷新学期状态。")
        }
        guard !requiresSession || session?.ready == true else {
            throw BackendBridgeError.remote("请先登录办学帮。")
        }
        let token = UUID()
        sessionActivities.insert(token)
        return token
    }

    func endSessionActivity(_ token: UUID) { sessionActivities.remove(token) }

    private func applySession(_ value: BackendSessionStatus) {
        let changed = session?.user?.id != value.user?.id
            || session?.currentClass?.id != value.currentClass?.id
            || session?.currentTermId != value.currentTermId
            || session?.ready != value.ready
        session = value
        if changed {
            contextRevision += 1
            pendingHomeworkCount = nil
            pendingCountError = nil
            isLoadingPendingCount = false
        }
    }

    func loadTerms() async {
        guard academicContextReady, !isLoadingTerms else { return }
        let key = contextKey
        isLoadingTerms = true
        defer { isLoadingTerms = false }
        do {
            let result = try await callTool("list_terms")
            guard key == contextKey else { return }
            applySession(try result["context"].decoded(BackendSessionStatus.self))
            termErrorMessage = nil
            if key != contextKey { await refreshPendingCount() }
        } catch {
            guard key == contextKey else { return }
            termErrorMessage = error.localizedDescription
        }
    }

    func refreshPendingCount() async {
        guard academicContextReady else { pendingHomeworkCount = nil; return }
        let key = contextKey
        isLoadingPendingCount = true
        pendingHomeworkCount = nil
        pendingCountError = nil
        do {
            let token = try beginSessionActivity()
            defer { endSessionActivity(token) }
            let result = try await client.invoke("home.pendingCount")
            guard key == contextKey else { return }
            guard result["currentTermId"].stringValue == session?.currentTermId,
                  let count = result["pendingTaskCount"].intValue, count >= 0 else {
                throw BackendBridgeError.protocolFailure("待完成数量与当前学期不一致。")
            }
            pendingHomeworkCount = count
        } catch {
            if key == contextKey { pendingCountError = error.localizedDescription }
        }
        if key == contextKey { isLoadingPendingCount = false }
    }

    func switchTerm(termID: String) async {
        guard termID != session?.currentTermId else { return }
        guard canSwitchTerm else {
            termErrorMessage = "有课程相关操作尚未结束，请等待完成后重试。"
            return
        }
        guard session?.availableTerms?.contains(where: { $0.id == termID }) == true else {
            termErrorMessage = "所选学期已不可用，请刷新学期列表。"
            return
        }
        isSwitchingTerm = true
        contextRevision += 1
        pendingHomeworkCount = nil
        isLoadingPendingCount = false
        termErrorMessage = nil
        do {
            let value = try await client.invoke("session.switchTerm", params: ["termId": .string(termID)], as: BackendSessionStatus.self)
            guard value.ready, value.currentTermId == termID else {
                throw BackendBridgeError.protocolFailure("学期切换返回了不同的上下文。")
            }
            applySession(value)
            needsContextRefresh = false
        } catch {
            termErrorMessage = error.localizedDescription
            do {
                let actual = try await client.invoke("session.status", as: BackendSessionStatus.self)
                applySession(actual)
                needsContextRefresh = false
            } catch {
                needsContextRefresh = true
                termErrorMessage = "无法确认当前学期，请刷新后再操作。"
            }
        }
        isSwitchingTerm = false
        contextRevision += 1
        await refreshPendingCount()
    }

    var statusText: String {
        switch state {
        case .disconnected: "后端未连接"
        case .connecting: "正在连接本地后端"
        case .connected: session?.ready == true ? "已连接并登录" : "已连接，尚未登录"
        case .failed: "本地后端连接失败"
        }
    }

    var statusSymbol: String {
        switch state {
        case .disconnected: "circle.dotted"
        case .connecting: "arrow.triangle.2.circlepath"
        case .connected: session?.ready == true ? "checkmark.circle.fill" : "checkmark.circle"
        case .failed: "exclamationmark.triangle.fill"
        }
    }

    var errorMessage: String? {
        if case .failed(let message) = state { message } else { nil }
    }

    func connect() async {
        guard state != .connecting else { return }
        state = .connecting
        do {
            appInfo = try await client.invoke("app.info", as: BackendAppInfo.self)
            applySession(try await client.invoke("session.status", as: BackendSessionStatus.self))
            if let config = try? await client.invoke("modelConfig.load") {
                let preference = config["theme"].stringValue
                themePreference = preference.isEmpty ? "system" : preference
            }
            state = .connected
            needsContextRefresh = false
            await refreshPendingCount()
        } catch {
            state = .failed(error.localizedDescription)
        }
    }

    func refreshSession() async {
        if appInfo == nil {
            await connect()
            return
        }
        guard !isSwitchingTerm else { return }
        let revision = contextRevision
        do {
            let value = try await client.invoke("session.status", as: BackendSessionStatus.self)
            guard revision == contextRevision else { return }
            applySession(value)
            needsContextRefresh = false
            termErrorMessage = nil
            state = .connected
            await refreshPendingCount()
        } catch {
            guard revision == contextRevision else { return }
            termErrorMessage = error.localizedDescription
        }
    }

    func refreshSessionContext() async throws {
        let token = try beginSessionActivity()
        defer { endSessionActivity(token) }
        applySession(try await client.invoke("session.refresh", as: BackendSessionStatus.self))
        needsContextRefresh = false
        await refreshPendingCount()
        state = .connected
    }

    func signOut() async throws {
        guard !isSwitchingTerm, sessionActivities.isEmpty else {
            throw BackendBridgeError.remote("请等待课程相关操作完成后退出。")
        }
        applySession(try await client.invoke("session.logout", as: BackendSessionStatus.self))
        pendingHomeworkCount = nil
        state = .connected
    }

    func refreshAppInfo() async throws {
        appInfo = try await client.invoke("app.info", as: BackendAppInfo.self)
    }

    func refreshThemePreference() async {
        if let config = try? await client.invoke("modelConfig.load") {
            themePreference = config["theme"].stringValue
        }
    }

    func login(username: String, password: String, agreeTerms: Bool) async throws {
        guard agreeTerms else {
            throw BackendBridgeError.remote("登录前需要同意用户协议和隐私政策。")
        }

        state = .connecting
        do {
            let result = try await client.invoke(
                "session.loginWithCredentials",
                params: [
                    "username": .string(username),
                    "password": .string(password),
                    "agreeTerms": .bool(agreeTerms),
                    "timeoutMs": .number(60_000),
                ],
                as: BackendSessionStatus.self
            )
            guard result.ready else {
                throw BackendBridgeError.remote("登录未完成，请检查账号和密码后重试。")
            }
            applySession(result)
            needsContextRefresh = false
            state = .connected
            await refreshPendingCount()
        } catch let error as BackendBridgeError {
            switch error {
            case .remote, .remoteCoded:
                state = .connected
            default:
                state = .failed(error.localizedDescription)
            }
            throw error
        } catch {
            state = .failed(error.localizedDescription)
            throw error
        }
    }

    func callTool(
        _ name: String,
        arguments: [String: JSONValue] = [:],
        requiresSession: Bool = true
    ) async throws -> JSONValue {
        let token = requiresSession ? try beginSessionActivity() : nil
        defer { if let token { endSessionActivity(token) } }
        let context = contextKey
        let result = try await client.invoke(
            "tool.call",
            params: [
                "name": .string(name),
                "args": .object(arguments),
            ]
        )
        if requiresSession, context == contextKey, result["context"]["ready"].boolValue != nil {
            applySession(try result["context"].decoded(BackendSessionStatus.self))
            if context != contextKey { await refreshPendingCount() }
        }
        return result
    }

    func invoke(
        _ method: String,
        params: [String: JSONValue] = [:]
    ) async throws -> JSONValue {
        try await client.invoke(method, params: params)
    }

    func stream(
        _ method: String,
        params: [String: JSONValue] = [:]
    ) async throws -> AsyncThrowingStream<BackendStreamEvent, Error> {
        var streamParams = params
        if method == "agent.chat", streamParams["apiKeys"] == nil {
            if let config = try? await client.invoke("modelConfig.load") {
                streamParams["apiKeys"] = .object(try ephemeralAPIKeys(for: config))
            }
        }
        return try await client.stream(method, params: streamParams)
    }

    func hasModelAPIKey(role: String, providerID: String) -> Bool {
        (try? ModelAPIKeychainStore().load(role: role, providerID: providerID)) != nil
    }

    private func ephemeralAPIKeys(for config: JSONValue) throws -> [String: JSONValue] {
        var roles: [String: JSONValue] = [:]
        let keychain = ModelAPIKeychainStore()
        for role in ["chat", "image_caption"] {
            let providers = config["modelRoles"][role]["providers"].arrayValue
            var keys: [String: JSONValue] = [:]
            for provider in providers {
                let id = provider.firstString("id", "providerId")
                guard !id.isEmpty, let key = try keychain.load(role: role, providerID: id), !key.isEmpty else { continue }
                keys[id] = .string(key)
            }
            roles[role] = .object(keys)
        }
        return roles
    }
}
