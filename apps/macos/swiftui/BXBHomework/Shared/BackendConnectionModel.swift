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
    private let client = NodeBackendClient()

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
            session = try await client.invoke("session.status", as: BackendSessionStatus.self)
            state = .connected
        } catch {
            state = .failed(error.localizedDescription)
        }
    }

    func refreshSession() async {
        if appInfo == nil {
            await connect()
            return
        }
        do {
            session = try await client.invoke("session.status", as: BackendSessionStatus.self)
            state = .connected
        } catch {
            state = .failed(error.localizedDescription)
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
            session = result
            state = .connected
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
        guard !requiresSession || session?.ready == true else {
            throw BackendBridgeError.remote("请先登录办学帮。")
        }
        return try await client.invoke(
            "tool.call",
            params: [
                "name": .string(name),
                "args": .object(arguments),
            ]
        )
    }

    func invoke(
        _ method: String,
        params: [String: JSONValue] = [:]
    ) async throws -> JSONValue {
        try await client.invoke(method, params: params)
    }
}
