// Compile this appended to NodeBackendClient.swift so it can exercise the
// private locator without adding test-only interfaces to the production client.
@main
struct RuntimeLocatorSmoke {
    static func main() throws {
        let runtime: BackendRuntime
        do {
            runtime = try BackendRuntime.locate()
        } catch BackendBridgeError.packagedRuntimeIncomplete where CommandLine.arguments.contains("--expect-incomplete") {
            print("incomplete-bundle=rejected")
            return
        }
        guard !CommandLine.arguments.contains("--expect-incomplete") else {
            throw BackendBridgeError.protocolFailure("Incomplete bundle unexpectedly used development resources")
        }
        let app = Bundle.main.bundleURL
        guard runtime.repositoryRoot.path == app.appending(path: "Contents/Resources/BXBRuntime").path,
              runtime.nodeExecutable.path == app.appending(path: "Contents/Helpers/node").path else {
            throw BackendBridgeError.protocolFailure("Locator used development resources instead of the app payload")
        }
        print("runtime-locator=ok")
    }
}
