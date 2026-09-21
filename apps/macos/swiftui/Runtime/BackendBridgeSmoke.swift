import Darwin
import Foundation

@main
struct BackendBridgeSmoke {
    static func main() async {
        let client = NodeBackendClient()
        do {
            let appInfo = try await client.invoke("app.info", as: BackendAppInfo.self)
            let session = try await client.invoke("session.status", as: BackendSessionStatus.self)
            let conversations = try await client.invoke("conversation.list")
            let modelConfig = try await client.invoke("modelConfig.load")
            let conversationCount = conversations["conversations"].arrayValue.count
            let modelConfigured = modelConfig["hasApiKey"].boolValue ?? false
            print(
                "bridge=ok platform=\(appInfo.platform) version=\(appInfo.version) "
                + "sessionReady=\(session.ready) conversations=\(conversationCount) "
                + "modelConfigured=\(modelConfigured)"
            )
        } catch {
            fputs("bridge=failed error=\(error.localizedDescription)\n", stderr)
            exit(EXIT_FAILURE)
        }
    }
}
