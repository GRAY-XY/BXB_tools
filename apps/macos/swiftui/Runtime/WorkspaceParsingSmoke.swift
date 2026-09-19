import Foundation

@main
struct WorkspaceParsingSmoke {
    static func main() throws {
        let list = try decode(#"""
        {
          "count": 2,
          "files": [
            {
              "name": "笔记.md",
              "relativePath": "课程/笔记.md",
              "path": "/tmp/workspace/课程/笔记.md",
              "extension": ".md",
              "size": 128,
              "modifiedAt": "2026-09-19T12:00:00.000Z",
              "category": "text"
            },
            {
              "name": "要求.pdf",
              "relativePath": "要求.pdf",
              "path": "/tmp/workspace/要求.pdf",
              "extension": ".pdf",
              "size": "2048",
              "modifiedAt": "2026-09-19T11:00:00.000Z",
              "category": "pdf"
            }
          ]
        }
        """#)
        let files = WorkspaceFile.parseList(list)
        precondition(files.count == 2)
        precondition(files[0].relativePath == "课程/笔记.md")
        precondition(files[1].size == 2_048)
        precondition(files[1].symbolName == "doc.richtext")

        let read = try decode(#"""
        {
          "file": {
            "text": "第一行\n第二行",
            "reader": "plain-text",
            "truncated": true,
            "totalChars": 24000
          }
        }
        """#)
        let preview = WorkspaceTextPreview.parse(read)
        precondition(preview.text.contains("第二行"))
        precondition(preview.truncated)
        precondition(preview.totalCharacters == 24_000)

        print("workspace-parsing=ok files=\(files.count) reader=\(preview.reader)")
    }

    private static func decode(_ text: String) throws -> JSONValue {
        try JSONDecoder().decode(JSONValue.self, from: Data(text.utf8))
    }
}
