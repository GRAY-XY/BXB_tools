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

        let importResult = try decode(#"""
        {
          "imported": [
            {
              "name": "poem (2).txt",
              "relativePath": "poem (2).txt",
              "kind": "file",
              "renamed": true
            }
          ],
          "conflicts": [
            {
              "sourcePath": "/tmp/sources/notes.txt",
              "name": "notes.txt",
              "code": "name_conflict",
              "message": "工作区中已存在“notes.txt”，原文件未被覆盖。"
            }
          ],
          "blocked": [
            {
              "sourcePath": "/tmp/sources/escape",
              "code": "blocked_symlink",
              "message": "“escape”是符号链接，为避免指向工作区外部，未导入。"
            }
          ]
        }
        """#)
        let outcome = WorkspaceImportOutcome.parse(importResult)
        precondition(outcome.imported.count == 1)
        precondition(outcome.imported[0].renamed)
        precondition(outcome.conflicts.count == 1)
        precondition(outcome.problems.count == 2)
        precondition(outcome.blocked[0].name == "escape")
        precondition(outcome.summaryText.contains("已导入 1 项"))
        precondition(outcome.summaryText.contains("1 项因同名未覆盖"))

        precondition(WorkspaceNameValidator.validate("notes.md").normalizedName == "notes.md")
        precondition(WorkspaceNameValidator.validate("   ").message != nil)
        precondition(WorkspaceNameValidator.validate("..").message != nil)
        precondition(WorkspaceNameValidator.validate("a/b.txt").message != nil)
        precondition(WorkspaceNameValidator.validate("a:b.txt").message != nil)
        precondition(
            WorkspaceNameValidator.extensionHint(for: "draft", originalExtension: ".md")?.contains("draft.md") == true
        )
        precondition(WorkspaceNameValidator.extensionHint(for: "draft.txt", originalExtension: ".md") == nil)

        let restored = WorkspaceSelection.restoredID(for: files[0], in: files)
        precondition(restored == files[0].id)
        precondition(WorkspaceSelection.restoredID(for: files[0], in: []) == nil)
        precondition(WorkspaceSelection.restoredID(for: nil, in: files) == nil)

        let folderListing = try decode(#"""
        {
          "files": [
            {
              "name": "pack",
              "relativePath": "pack",
              "path": "/tmp/workspace/pack",
              "extension": "",
              "size": 96,
              "modifiedAt": "2026-09-19T12:00:00.000Z",
              "category": "directory",
              "identity": "16777229:63775990",
              "isDirectory": true
            }
          ]
        }
        """#)
        let folders = WorkspaceFile.parseList(folderListing)
        precondition(folders.count == 1)
        precondition(folders[0].isDirectory)
        precondition(folders[0].symbolName == "folder")
        precondition(folders[0].sizeDisplay == "文件夹")
        precondition(!files[0].isDirectory)
        precondition(files[0].sizeDisplay != "文件夹")

        print(
            "workspace-parsing=ok files=\(files.count) reader=\(preview.reader) "
                + "imported=\(outcome.imported.count) problems=\(outcome.problems.count) "
                + "folders=\(folders.count)"
        )
    }

    private static func decode(_ text: String) throws -> JSONValue {
        try JSONDecoder().decode(JSONValue.self, from: Data(text.utf8))
    }
}
