import Foundation

enum BackendBridgeError: LocalizedError, Sendable {
    case repositoryNotFound
    case nodeNotFound
    case scriptNotFound(String)
    case processLaunch(String)
    case protocolFailure(String)
    case remote(String)
    case remoteCoded(code: String, message: String)

    var remoteCode: String? {
        if case .remoteCoded(let code, _) = self { return code }
        return nil
    }

    var errorDescription: String? {
        switch self {
        case .repositoryNotFound:
            "找不到 BXB 仓库根目录。"
        case .nodeNotFound:
            "找不到项目要求的 Node.js 运行时。"
        case .scriptNotFound(let path):
            "找不到 macOS 后端启动脚本：\(path)"
        case .processLaunch(let message):
            "无法启动本地后端：\(message)"
        case .protocolFailure(let message):
            "本地后端协议错误：\(message)"
        case .remote(let message):
            message
        case .remoteCoded(_, let message):
            message
        }
    }
}

private struct BackendRequest: Encodable {
    let id: String
    let method: String
    let params: [String: JSONValue]
}

private struct BackendResponse: Decodable {
    struct Failure: Decodable {
        let message: String?
        let code: String?
    }

    let id: String?
    let ok: Bool?
    let event: String?
    let result: JSONValue?
    let error: Failure?
}

enum BackendStreamEvent: Sendable {
    case progress(JSONValue)
    case result(JSONValue)
}

private struct BackendRuntime {
    let repositoryRoot: URL
    let nodeExecutable: URL
    let bridgeScript: URL

    static func locate() throws -> BackendRuntime {
        guard let repositoryRoot = locateRepositoryRoot() else {
            throw BackendBridgeError.repositoryNotFound
        }

        let bridgeScript = repositoryRoot
            .appending(path: "apps/macos/swiftui/Runtime/macos-backend.js")
        guard FileManager.default.fileExists(atPath: bridgeScript.path) else {
            throw BackendBridgeError.scriptNotFound(bridgeScript.path)
        }

        guard let nodeExecutable = locateNode(repositoryRoot: repositoryRoot) else {
            throw BackendBridgeError.nodeNotFound
        }

        return BackendRuntime(
            repositoryRoot: repositoryRoot,
            nodeExecutable: nodeExecutable,
            bridgeScript: bridgeScript
        )
    }

    private static func locateRepositoryRoot() -> URL? {
        let environment = ProcessInfo.processInfo.environment
        let candidates = [
            environment["BXB_REPO_ROOT"].map { URL(filePath: $0, directoryHint: .isDirectory) },
            URL(filePath: FileManager.default.currentDirectoryPath, directoryHint: .isDirectory),
            URL(filePath: #filePath).deletingLastPathComponent(),
        ].compactMap { $0 }

        for candidate in candidates {
            var current = candidate.standardizedFileURL
            while current.pathComponents.count > 1 {
                let package = current.appending(path: "package.json")
                let backend = current.appending(path: "backend/bridge/winui-backend.js")
                if FileManager.default.fileExists(atPath: package.path),
                   FileManager.default.fileExists(atPath: backend.path) {
                    return current
                }
                current.deleteLastPathComponent()
            }
        }
        return nil
    }

    private static func locateNode(repositoryRoot: URL) -> URL? {
        let environment = ProcessInfo.processInfo.environment
        var candidates: [URL] = []

        if let override = environment["BXB_NODE_EXECUTABLE"] {
            candidates.append(URL(filePath: override))
        }

        let versionFile = repositoryRoot.appending(path: ".nvmrc")
        if let version = try? String(contentsOf: versionFile, encoding: .utf8)
            .trimmingCharacters(in: .whitespacesAndNewlines),
           !version.isEmpty {
            let directory = version.hasPrefix("v") ? version : "v\(version)"
            candidates.append(
                FileManager.default.homeDirectoryForCurrentUser
                    .appending(path: ".nvm/versions/node/\(directory)/bin/node")
            )
        }

        candidates.append(URL(filePath: "/opt/homebrew/bin/node"))
        candidates.append(URL(filePath: "/usr/local/bin/node"))
        candidates.append(URL(filePath: "/usr/bin/node"))

        return candidates.first { FileManager.default.isExecutableFile(atPath: $0.path) }
    }
}

actor NodeBackendClient {
    private let bridgeScriptOverride: URL?
    private var process: Process?
    private var stdinHandle: FileHandle?
    private var stdoutHandle: FileHandle?
    private var stderrHandle: FileHandle?
    private var stdoutReadTask: Task<Void, Never>?
    private var stdoutBuffer = Data()
    private var stderrLines: [String] = []
    private var nextRequestID = 0
    private var pending: [String: CheckedContinuation<JSONValue, Error>] = [:]
    private var streaming: [String: AsyncThrowingStream<BackendStreamEvent, Error>.Continuation] = [:]

    init(bridgeScriptOverride: URL? = nil) {
        self.bridgeScriptOverride = bridgeScriptOverride
    }

    func invoke<T: Decodable & Sendable>(
        _ method: String,
        params: [String: JSONValue] = [:],
        as type: T.Type
    ) async throws -> T {
        let value = try await invoke(method, params: params)
        return try value.decoded(type)
    }

    func invoke(
        _ method: String,
        params: [String: JSONValue] = [:]
    ) async throws -> JSONValue {
        try await startIfNeeded()
        nextRequestID += 1
        let requestID = String(nextRequestID)
        let request = BackendRequest(id: requestID, method: method, params: params)
        var payload = try JSONEncoder().encode(request)
        payload.append(0x0A)

        return try await withCheckedThrowingContinuation { continuation in
            pending[requestID] = continuation
            do {
                try stdinHandle?.write(contentsOf: payload)
            } catch {
                pending.removeValue(forKey: requestID)
                continuation.resume(throwing: BackendBridgeError.processLaunch(error.localizedDescription))
            }
        }
    }

    func stream(
        _ method: String,
        params: [String: JSONValue] = [:]
    ) async throws -> AsyncThrowingStream<BackendStreamEvent, Error> {
        try await startIfNeeded()
        nextRequestID += 1
        let requestID = String(nextRequestID)
        let request = BackendRequest(id: requestID, method: method, params: params)
        var payload = try JSONEncoder().encode(request)
        payload.append(0x0A)

        return AsyncThrowingStream { continuation in
            streaming[requestID] = continuation
            continuation.onTermination = { [weak self] termination in
                if case .cancelled = termination {
                    Task { await self?.removeStream(requestID) }
                }
            }
            do {
                try stdinHandle?.write(contentsOf: payload)
            } catch {
                streaming.removeValue(forKey: requestID)
                continuation.finish(throwing: BackendBridgeError.processLaunch(error.localizedDescription))
            }
        }
    }

    private func removeStream(_ requestID: String) {
        streaming.removeValue(forKey: requestID)
    }

    private func startIfNeeded() async throws {
        if let oldProcess = process, !oldProcess.isRunning {
            await processDidTerminate(oldProcess)
        }
        if process?.isRunning == true {
            return
        }

        let runtime = try BackendRuntime.locate()
        let bridgeScript = bridgeScriptOverride ?? runtime.bridgeScript
        guard FileManager.default.fileExists(atPath: bridgeScript.path) else {
            throw BackendBridgeError.scriptNotFound(bridgeScript.path)
        }
        let process = Process()
        let stdinPipe = Pipe()
        let stdoutPipe = Pipe()
        let stderrPipe = Pipe()

        process.executableURL = runtime.nodeExecutable
        process.arguments = [bridgeScript.path]
        process.currentDirectoryURL = runtime.repositoryRoot
        process.standardInput = stdinPipe
        process.standardOutput = stdoutPipe
        process.standardError = stderrPipe

        var environment = ProcessInfo.processInfo.environment
        environment["APPDATA"] = FileManager.default.homeDirectoryForCurrentUser
            .appending(path: "Library/Application Support")
            .path
        process.environment = environment

        let outputHandle = stdoutPipe.fileHandleForReading
        let errorHandle = stderrPipe.fileHandleForReading
        let stdoutChunks = AsyncStream<Data> { continuation in
            outputHandle.readabilityHandler = { handle in
                let data = handle.availableData
                if data.isEmpty {
                    handle.readabilityHandler = nil
                    continuation.finish()
                } else {
                    continuation.yield(data)
                }
            }
        }
        errorHandle.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            guard !data.isEmpty else {
                handle.readabilityHandler = nil
                return
            }
            Task { await self?.consumeStderr(data) }
        }
        process.terminationHandler = { [weak self] process in
            Task { await self?.processDidTerminate(process) }
        }

        do {
            try process.run()
        } catch {
            outputHandle.readabilityHandler = nil
            errorHandle.readabilityHandler = nil
            throw BackendBridgeError.processLaunch(error.localizedDescription)
        }

        self.process = process
        stdinHandle = stdinPipe.fileHandleForWriting
        stdoutHandle = outputHandle
        stderrHandle = errorHandle
        stdoutReadTask = Task { [weak self] in
            for await data in stdoutChunks {
                await self?.consumeStdout(data)
            }
        }
    }

    private func consumeStdout(_ data: Data) {
        stdoutBuffer.append(data)
        while let newline = stdoutBuffer.firstIndex(of: 0x0A) {
            let line = Data(stdoutBuffer[..<newline])
            stdoutBuffer.removeSubrange(...newline)
            guard !line.isEmpty else { continue }
            handleResponseLine(line)
        }
    }

    private func consumeStderr(_ data: Data) {
        guard let text = String(data: data, encoding: .utf8) else { return }
        stderrLines.append(contentsOf: text.split(whereSeparator: \.isNewline).map(String.init))
        if stderrLines.count > 20 {
            stderrLines.removeFirst(stderrLines.count - 20)
        }
    }

    private func handleResponseLine(_ data: Data) {
        let response: BackendResponse
        do {
            response = try JSONDecoder().decode(BackendResponse.self, from: data)
        } catch {
            return
        }

        guard let id = response.id else { return }
        if response.event == "progress" {
            streaming[id]?.yield(.progress(response.result ?? .null))
            return
        }
        if let continuation = streaming.removeValue(forKey: id) {
            if response.ok == true {
                continuation.yield(.result(response.result ?? .null))
                continuation.finish()
            } else {
                let message = response.error?.message ?? "本地后端请求失败。"
                if let code = response.error?.code, !code.isEmpty {
                    continuation.finish(throwing: BackendBridgeError.remoteCoded(code: code, message: message))
                } else {
                    continuation.finish(throwing: BackendBridgeError.remote(message))
                }
            }
            return
        }
        guard let continuation = pending.removeValue(forKey: id) else { return }
        if response.ok == true {
            continuation.resume(returning: response.result ?? .null)
        } else {
            let message = response.error?.message ?? "本地后端请求失败。"
            if let code = response.error?.code, !code.isEmpty {
                continuation.resume(throwing: BackendBridgeError.remoteCoded(code: code, message: message))
            } else {
                continuation.resume(throwing: BackendBridgeError.remote(message))
            }
        }
    }

    private func processDidTerminate(_ terminatedProcess: Process) async {
        guard process === terminatedProcess else { return }
        let readTask = stdoutReadTask
        await readTask?.value
        guard process === terminatedProcess else { return }
        let status = terminatedProcess.terminationStatus
        stdoutHandle?.readabilityHandler = nil
        stderrHandle?.readabilityHandler = nil
        process = nil
        stdinHandle = nil
        stdoutHandle = nil
        stderrHandle = nil
        stdoutReadTask = nil
        stdoutBuffer.removeAll()

        let details = stderrLines.suffix(3).joined(separator: " ")
        let message = details.isEmpty
            ? "本地后端已退出（状态码 \(status)）。"
            : "本地后端已退出（状态码 \(status)）：\(details)"
        let continuations = pending.values
        pending.removeAll()
        for continuation in continuations {
            continuation.resume(throwing: BackendBridgeError.processLaunch(message))
        }
        let streams = streaming.values
        streaming.removeAll()
        for stream in streams {
            stream.finish(throwing: BackendBridgeError.processLaunch(message))
        }
        stderrLines.removeAll()
    }
}
