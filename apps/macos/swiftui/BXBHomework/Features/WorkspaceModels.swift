import Foundation

struct WorkspaceFile: Identifiable, Hashable, Sendable {
    let id: String
    let name: String
    let relativePath: String
    let path: String
    let fileExtension: String
    let size: Int
    let modifiedAt: String
    let category: String
    let identity: String
    let isDirectory: Bool

    var symbolName: String {
        switch category {
        case "directory": "folder"
        case "image": "photo"
        case "video": "film"
        case "audio": "waveform"
        case "pdf": "doc.richtext"
        case "docx", "doc": "doc.text"
        case "text": "doc.plaintext"
        default: "doc"
        }
    }

    var formattedSize: String {
        ByteCountFormatter.string(fromByteCount: Int64(size), countStyle: .file)
    }

    var sizeDisplay: String {
        isDirectory ? "文件夹" : formattedSize
    }

    var modifiedDisplay: String {
        guard let date = ISO8601DateFormatter().date(from: modifiedAt) else { return modifiedAt }
        return date.formatted(date: .abbreviated, time: .shortened)
    }

    var hasBuiltInReader: Bool {
        category != "file"
    }

    static func parseList(_ value: JSONValue) -> [WorkspaceFile] {
        value["files"].arrayValue.compactMap { item -> WorkspaceFile? in
            let relativePath = item.firstString("relativePath", "name")
            let path = item.firstString("path")
            guard !relativePath.isEmpty, !path.isEmpty else { return nil }
            return WorkspaceFile(
                id: relativePath,
                name: item.firstString("name").fallback(relativePath),
                relativePath: relativePath,
                path: path,
                fileExtension: item.firstString("extension"),
                size: item["size"].intValue ?? 0,
                modifiedAt: item.firstString("modifiedAt"),
                category: item.firstString("category").fallback("file"),
                identity: item.firstString("identity"),
                isDirectory: item["isDirectory"].boolValue ?? false
            )
        }
    }
}

/// Result of an import request. Conflicts are reported instead of overwritten
/// so the page can explain exactly which item kept its original version.
struct WorkspaceImportOutcome: Sendable {
    struct Item: Sendable {
        let name: String
        let relativePath: String
        let kind: String
        let renamed: Bool
    }

    struct Problem: Sendable, Identifiable {
        let sourcePath: String
        let name: String
        let code: String
        let message: String

        var id: String { "\(code)|\(sourcePath)|\(name)" }
    }

    let imported: [Item]
    let conflicts: [Problem]
    let blocked: [Problem]

    var isEmpty: Bool { imported.isEmpty && conflicts.isEmpty && blocked.isEmpty }

    var summaryText: String {
        var parts: [String] = []
        if !imported.isEmpty { parts.append("已导入 \(imported.count) 项") }
        if !conflicts.isEmpty { parts.append("\(conflicts.count) 项因同名未覆盖") }
        if !blocked.isEmpty { parts.append("\(blocked.count) 项被阻止") }
        guard !parts.isEmpty else { return "没有导入任何项目。" }
        return parts.joined(separator: "，") + "。"
    }

    var problems: [Problem] { conflicts + blocked }

    static func parse(_ value: JSONValue) -> WorkspaceImportOutcome {
        WorkspaceImportOutcome(
            imported: value["imported"].arrayValue.map { item in
                Item(
                    name: item.firstString("name"),
                    relativePath: item.firstString("relativePath", "name"),
                    kind: item.firstString("kind").fallback("file"),
                    renamed: item["renamed"].boolValue ?? false
                )
            },
            conflicts: value["conflicts"].arrayValue.map(problem),
            blocked: value["blocked"].arrayValue.map(problem)
        )
    }

    private static func problem(_ value: JSONValue) -> Problem {
        let sourcePath = value.firstString("sourcePath")
        return Problem(
            sourcePath: sourcePath,
            name: value.firstString("name").fallback((sourcePath as NSString).lastPathComponent),
            code: value.firstString("code"),
            message: value.firstString("message")
        )
    }
}

enum WorkspaceNameCheck: Equatable {
    case valid(String)
    case invalid(String)

    var normalizedName: String? {
        if case .valid(let name) = self { return name }
        return nil
    }

    var message: String? {
        if case .invalid(let message) = self { return message }
        return nil
    }
}

/// Mirrors the workspace guard in `backend/src/banxuebang-client.js` so the page
/// can explain a problem while typing. The service validates again on its side.
enum WorkspaceNameValidator {
    static let maxLength = 255
    private static let reservedCharacters: Set<Character> = ["<", ">", ":", "\"", "|", "?", "*"]

    static func validate(_ rawName: String) -> WorkspaceNameCheck {
        let trimmed = rawName.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty {
            return .invalid("文件名不能为空。")
        }
        if trimmed == "." || trimmed == ".." {
            return .invalid("不能使用“\(trimmed)”作为文件名。")
        }
        if trimmed.contains("/") || trimmed.contains("\\") {
            return .invalid("文件名不能包含路径分隔符，请只输入文件名本身。")
        }
        if trimmed.unicodeScalars.contains(where: { $0.value < 0x20 || $0.value == 0x7F }) {
            return .invalid("文件名不能包含控制字符。")
        }
        if trimmed.contains(where: { reservedCharacters.contains($0) }) {
            return .invalid("文件名不能包含 < > : \" | ? * 这些字符。")
        }
        if trimmed.count > maxLength {
            return .invalid("文件名过长，请缩短后再试。")
        }
        return .valid(trimmed)
    }

    /// The service keeps the previous extension when the new name has none.
    static func extensionHint(for rawName: String, originalExtension: String) -> String? {
        guard case .valid(let name) = validate(rawName) else { return nil }
        guard !originalExtension.isEmpty else { return nil }
        guard (name as NSString).pathExtension.isEmpty else { return nil }
        return "将保留原扩展名：\(name)\(originalExtension)"
    }
}

/// Restores the previous selection after a refresh: file identity first, then
/// the relative path, and nothing at all when the item really disappeared.
enum WorkspaceSelection {
    static func restoredID(for previous: WorkspaceFile?, in files: [WorkspaceFile]) -> String? {
        guard let previous else { return nil }
        if !previous.identity.isEmpty,
           let match = files.first(where: { $0.identity == previous.identity }) {
            return match.id
        }
        return files.first(where: { $0.relativePath == previous.relativePath })?.id
    }
}

struct WorkspaceTextPreview: Sendable {
    let text: String
    let reader: String
    let truncated: Bool
    let totalCharacters: Int
    let note: String

    static func parse(_ value: JSONValue) -> WorkspaceTextPreview {
        let file = value["file"]
        return WorkspaceTextPreview(
            text: file.firstString("text", "content", "preview"),
            reader: file.firstString("reader"),
            truncated: file["truncated"].boolValue ?? false,
            totalCharacters: file["totalChars"].intValue ?? 0,
            note: file.firstString("note")
        )
    }
}

enum WorkspacePreview {
    case text(WorkspaceFile, WorkspaceTextPreview)
    case quickLook(WorkspaceFile)
    case directory(WorkspaceFile)
}

private extension String {
    func fallback(_ value: String) -> String {
        isEmpty ? value : self
    }
}

extension String {
    var nonEmpty: String? {
        isEmpty ? nil : self
    }
}
