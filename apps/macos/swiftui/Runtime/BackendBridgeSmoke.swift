import Darwin
import Foundation

@main
struct BackendBridgeSmoke {
    static func main() async {
        let client = NodeBackendClient()
        do {
            let appInfo = try await client.invoke("app.info", as: BackendAppInfo.self)
            let session = try await client.invoke("session.status", as: BackendSessionStatus.self)
            print("bridge=ok platform=\(appInfo.platform) version=\(appInfo.version) sessionReady=\(session.ready)")
        } catch {
            fputs("bridge=failed error=\(error.localizedDescription)\n", stderr)
            exit(EXIT_FAILURE)
        }
    }
}
