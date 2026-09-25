import Foundation

@main
struct BridgeStreamSmoke {
    static func main() async throws {
        let fixture = URL(filePath: #filePath).deletingLastPathComponent()
            .appending(path: "BridgeStreamFixture.js")
        let client = NodeBackendClient(bridgeScriptOverride: fixture)
        let stream = try await client.stream("probe.stream")
        var observed: [String] = []
        for try await event in stream {
            switch event {
            case .progress(let value):
                observed.append(value.firstString("type") == "agent-text" ? value["text"].stringValue : "step")
            case .result(let value):
                observed.append(value["message"].stringValue)
            }
        }
        precondition(observed == ["step", "Hello", "Hello world", "Hello world"], "Observed: \(observed)")

        let waiting = try await client.stream("probe.wait")
        let cancellation = try await client.invoke("agent.cancel")
        precondition(cancellation["cancellationRequested"].boolValue == true)
        var canceled = false
        for try await event in waiting {
            if case .result(let value) = event {
                canceled = value["canceled"].boolValue == true
            }
        }
        precondition(canceled)

        let failed = try await client.stream("probe.error")
        var failureCode: String?
        do {
            for try await _ in failed {}
        } catch let error as BackendBridgeError {
            failureCode = error.remoteCode
        }
        precondition(failureCode == "FIXTURE_ERROR")

        let interrupted = try await client.stream("probe.exit")
        var sawPartial = false
        var sawFailure = false
        do {
            for try await event in interrupted {
                if case .progress(let value) = event {
                    sawPartial = value["text"].stringValue == "Partial"
                }
            }
        } catch {
            sawFailure = true
        }
        precondition(sawPartial && sawFailure)

        let recovered = try await client.stream("probe.stream")
        var recoveredResult = false
        for try await event in recovered {
            if case .result(let value) = event {
                recoveredResult = value["message"].stringValue == "Hello world"
            }
        }
        precondition(recoveredResult)
        print("bridge-stream=ok events=\(observed.count) canceled=\(canceled) interrupted=\(sawFailure) restarted=\(recoveredResult)")
    }
}
