import Foundation

@main
struct PackagedBridgeSmoke {
    static func main() async throws {
        guard let temporaryHome = ProcessInfo.processInfo.environment["BXB_SMOKE_HOME"],
              FileManager.default.homeDirectoryForCurrentUser.resolvingSymlinksInPath().path
                == URL(filePath: temporaryHome).resolvingSymlinksInPath().path else {
            throw BackendBridgeError.protocolFailure("Smoke requires an isolated temporary home")
        }
        let client = NodeBackendClient()
        let info = try await client.invoke("app.info")
        let expectedRoot = Bundle.main.resourceURL!.appending(path: "BXBRuntime").resolvingSymlinksInPath().path
        guard info["isPackaged"].boolValue == true,
              URL(filePath: info["payloadRoot"].stringValue).resolvingSymlinksInPath().path == expectedRoot,
              info["browserDependency"]["ready"].boolValue == true else {
            throw BackendBridgeError.protocolFailure("App did not use its bundled runtime and browsers")
        }
        let session = try await client.invoke("session.status")
        guard session["ready"].boolValue != true else {
            throw BackendBridgeError.protocolFailure("Smoke must use an empty temporary user-data directory")
        }
        print("packaged-bridge=ok version=\(info["version"].stringValue)")
    }
}
