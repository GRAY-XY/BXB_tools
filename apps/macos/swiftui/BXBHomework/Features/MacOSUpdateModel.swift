import Foundation
import Observation

enum MacOSUpdatePhase: String {
    case idle, checking, available, unavailable, downloading, verifying, ready, cancelled, failed
    case upToDate = "up_to_date"
}

struct MacOSUpdateSnapshot {
    let phase: MacOSUpdatePhase
    let latestVersion: String
    let message: String
    let latestNotes: String
    let percent: Double
    let downloadedBytes: Int
    let totalBytes: Int
    let canDownload: Bool
    let canInstall: Bool

    init(_ value: JSONValue) {
        phase = MacOSUpdatePhase(rawValue: value["status"].stringValue) ?? .failed
        latestVersion = value["latestVersion"].stringValue
        message = value["message"].stringValue
        latestNotes = value["latestNotes"].stringValue
        let progress = Double(value["percent"].stringValue) ?? 0
        percent = progress.isFinite ? min(100, max(0, progress)) : 0
        downloadedBytes = max(0, value["downloadedBytes"].intValue ?? 0)
        totalBytes = max(0, value["totalBytes"].intValue ?? 0)
        canDownload = [.available, .failed, .cancelled].contains(phase) && value["canDownload"].boolValue == true
        canInstall = phase == .ready && value["verified"].boolValue == true && value["canInstall"].boolValue == true
    }
}

typealias MacOSUpdateInvoke = @MainActor (String, [String: JSONValue]) async throws -> JSONValue

@MainActor
@Observable
final class MacOSUpdateModel {
    nonisolated static var installedVersion: String {
        Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0.0.0"
    }
    nonisolated static var architecture: String {
        #if arch(arm64)
        "arm64"
        #else
        "x86_64"
        #endif
    }
    let currentVersion: String
    private let architecture: String
    private(set) var state = MacOSUpdateSnapshot(.object(["status": .string("idle"), "message": .string("点击检查更新。")]))
    private(set) var errorMessage: String?
    private(set) var isChecking = false
    private(set) var isDownloading = false
    private(set) var isInstalling = false
    @ObservationIgnored private let invoke: MacOSUpdateInvoke
    @ObservationIgnored private let openInstaller: @MainActor (URL) -> Bool
    @ObservationIgnored private let quit: @MainActor () -> Void
    @ObservationIgnored private var stateRevision = 0

    init(currentVersion: String = MacOSUpdateModel.installedVersion,
         architecture: String = MacOSUpdateModel.architecture,
         invoke: @escaping MacOSUpdateInvoke,
         openInstaller: @escaping @MainActor (URL) -> Bool,
         quit: @escaping @MainActor () -> Void) {
        self.currentVersion = currentVersion
        self.architecture = architecture
        self.invoke = invoke
        self.openInstaller = openInstaller
        self.quit = quit
    }

    var isBusy: Bool { isChecking || isDownloading || isInstalling || [.checking, .downloading, .verifying].contains(state.phase) }

    func refreshStatus() async {
        guard !isBusy else { return }
        let revision = stateRevision
        do {
            let value = try await invoke("macosUpdate.status", [:])
            guard revision == stateRevision else { return }
            state = MacOSUpdateSnapshot(value)
        }
        catch { if revision == stateRevision { fail(error) } }
    }

    func check() async {
        guard !isBusy else { return }
        isChecking = true
        stateRevision += 1
        errorMessage = nil
        defer { isChecking = false }
        do {
            state = MacOSUpdateSnapshot(try await invoke("macosUpdate.check", [
                "currentVersion": .string(currentVersion), "architecture": .string(architecture),
            ]))
        } catch { fail(error) }
    }

    func download() async {
        guard !isBusy, state.canDownload else { return }
        isDownloading = true
        stateRevision += 1
        errorMessage = nil
        let polling = Task { [weak self] in
            while !Task.isCancelled {
                do { try await Task.sleep(for: .milliseconds(300)) } catch { return }
                guard let self, !Task.isCancelled else { return }
                if let snapshot = try? await self.invoke("macosUpdate.status", [:]) {
                    guard !Task.isCancelled, self.isDownloading else { return }
                    self.state = MacOSUpdateSnapshot(snapshot)
                }
            }
        }
        defer { polling.cancel(); isDownloading = false }
        do { state = MacOSUpdateSnapshot(try await invoke("macosUpdate.download", [:])) }
        catch { fail(error) }
    }

    func cancelDownload() async {
        guard isDownloading || state.phase == .downloading else { return }
        do { _ = try await invoke("macosUpdate.cancel", [:]) }
        catch { errorMessage = error.localizedDescription }
    }

    func install(confirmed: Bool) async {
        guard confirmed, !isBusy, state.canInstall else { return }
        isInstalling = true
        stateRevision += 1
        errorMessage = nil
        defer { isInstalling = false }
        do {
            let result = try await invoke("macosUpdate.prepareInstall", ["confirmed": .bool(true)])
            state = MacOSUpdateSnapshot(result)
            let path = result["filePath"].stringValue
            guard state.canInstall, path.hasPrefix("/"), path.hasSuffix(".dmg") else {
                throw NSError(domain: "BXBUpdate", code: 1, userInfo: [NSLocalizedDescriptionKey: "安装包未通过校验，请重新下载。"])
            }
            guard openInstaller(URL(filePath: path)) else {
                errorMessage = "无法打开安装包，请稍后重试。"
                return
            }
            quit()
        } catch { fail(error) }
    }

    private func fail(_ error: Error) {
        errorMessage = error.localizedDescription
        state = MacOSUpdateSnapshot(.object(["status": .string("failed"), "message": .string("操作失败，请重试检查更新。")]))
    }
}
