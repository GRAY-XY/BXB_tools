import Foundation

@MainActor
private final class UpdateFixture {
    var calls: [String] = []
    var opens = 0
    var quits = 0
    var allowOpen = true
    var failVerification = false

    func invoke(_ method: String, _ params: [String: JSONValue]) async throws -> JSONValue {
        calls.append(method)
        if method == "macosUpdate.check" {
            precondition(params["currentVersion"] == .string("1.0.0"))
            precondition(params["architecture"] == .string("arm64"))
            return .object(["status": .string("available"), "canDownload": .bool(true), "latestVersion": .string("1.2.0")])
        }
        if method == "macosUpdate.prepareInstall" {
            precondition(params["confirmed"] == .bool(true))
            if failVerification { return .object(["status": .string("failed"), "message": .string("校验失败")]) }
        }
        return .object(["status": .string("ready"), "verified": .bool(true), "canInstall": .bool(true),
                        "percent": .number(100), "filePath": .string("/tmp/BXB-update.dmg")])
    }
    func open(_ url: URL) -> Bool { precondition(url.isFileURL && url.pathExtension == "dmg"); opens += 1; return allowOpen }
    func quit() { quits += 1 }
    func model() -> MacOSUpdateModel {
        MacOSUpdateModel(currentVersion: "1.0.0", architecture: "arm64", invoke: invoke, openInstaller: open, quit: quit)
    }
}

@MainActor
private final class DelayedProgressFixture {
    func invoke(_ method: String, _ params: [String: JSONValue]) async throws -> JSONValue {
        if method == "macosUpdate.check" { return .object(["status": .string("available"), "canDownload": .bool(true)]) }
        if method == "macosUpdate.download" {
            try await Task.sleep(for: .milliseconds(500))
            return .object(["status": .string("ready"), "verified": .bool(true), "canInstall": .bool(true)])
        }
        // Simulate an already captured progress reply delivered after download completion.
        try? await Task.sleep(for: .milliseconds(400))
        return .object(["status": .string("downloading"), "percent": .number(50)])
    }
}

@MainActor
private final class DelayedStatusErrorFixture {
    let update = UpdateFixture()
    var started = false
    func invoke(_ method: String, _ params: [String: JSONValue]) async throws -> JSONValue {
        if method != "macosUpdate.status" { return try await update.invoke(method, params) }
        started = true
        try await Task.sleep(for: .milliseconds(100))
        throw NSError(domain: "UpdateFixture", code: 1)
    }
}

@main
@MainActor
struct UpdateFlowSmoke {
    static func main() async throws {
        let fixture = UpdateFixture()
        let model = fixture.model()
        await model.install(confirmed: true)
        precondition(fixture.calls.isEmpty && fixture.opens == 0 && fixture.quits == 0)
        await model.check()
        precondition(model.state.phase == .available && model.state.canDownload)
        await model.download()
        precondition(model.state.canInstall && model.state.percent == 100)
        precondition(fixture.opens == 0 && fixture.quits == 0)
        await model.install(confirmed: false)
        precondition(!fixture.calls.contains("macosUpdate.prepareInstall") && fixture.opens == 0 && fixture.quits == 0)
        await model.install(confirmed: true)
        precondition(fixture.calls.last == "macosUpdate.prepareInstall" && fixture.opens == 1 && fixture.quits == 1)

        let denied = UpdateFixture(); denied.allowOpen = false
        let deniedModel = denied.model()
        await deniedModel.check(); await deniedModel.download(); await deniedModel.install(confirmed: true)
        precondition(denied.opens == 1 && denied.quits == 0 && deniedModel.errorMessage != nil)

        let tampered = UpdateFixture(); tampered.failVerification = true
        let tamperedModel = tampered.model()
        await tamperedModel.check(); await tamperedModel.download(); await tamperedModel.install(confirmed: true)
        precondition(tampered.opens == 0 && tampered.quits == 0 && !tamperedModel.state.canInstall)

        let invalid = MacOSUpdateSnapshot(.object(["status": .string("unknown"), "canInstall": .bool(true), "verified": .bool(true)]))
        precondition(!invalid.canInstall)
        let progress = DelayedProgressFixture()
        let progressModel = MacOSUpdateModel(invoke: progress.invoke, openInstaller: { _ in false }, quit: {})
        await progressModel.check(); await progressModel.download()
        try await Task.sleep(for: .milliseconds(400))
        precondition(progressModel.state.phase == .ready, "Late progress must not overwrite the verified ready state")
        let stale = DelayedStatusErrorFixture()
        let staleModel = MacOSUpdateModel(currentVersion: "1.0.0", architecture: "arm64", invoke: stale.invoke, openInstaller: { _ in false }, quit: {})
        let refresh = Task { await staleModel.refreshStatus() }
        while !stale.started { await Task.yield() }
        await staleModel.check(); await staleModel.download(); await refresh.value
        precondition(staleModel.state.phase == .ready, "A stale status error must not invalidate a newer download")
        print("update-flow=ok: check/download/cancel-confirmation never install; confirmed handoff revalidates before open and quit")
    }
}
