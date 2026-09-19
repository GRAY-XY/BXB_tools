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

    var symbolName: String {
        switch category {
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

    var modifiedDisplay: String {
        guard let date = ISO8601DateFormatter().date(from: modifiedAt) else { return modifiedAt }
        return date.formatted(date: .abbreviated, time: .shortened)
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
                category: item.firstString("category").fallback("file")
            )
        }
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
}

private extension String {
    func fallback(_ value: String) -> String {
        isEmpty ? value : self
    }
}
