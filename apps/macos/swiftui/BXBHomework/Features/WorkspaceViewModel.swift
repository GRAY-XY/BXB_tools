import AppKit
import Foundation
import Observation

@MainActor
@Observable
final class WorkspaceViewModel {
    private(set) var files: [WorkspaceFile] = []
    private(set) var preview: WorkspacePreview?
    private(set) var isLoadingFiles = false
    private(set) var isLoadingPreview = false
    private(set) var isBusy = false
    private(set) var listError: String?
    private(set) var previewError: String?
    private(set) var actionError: String?
    private(set) var actionMessage: String?
    private(set) var workspaceDir: String?
    private(set) var importOutcome: WorkspaceImportOutcome?

    var searchText = ""
    var selectedFileID: String?

    var renamingFileID: String?
    var renameDraft = ""
    var renameHint: String?
    var renameValidationMessage: String?

    var pastedTextDraft = ""
    var pastedTextName = ""
    var pastedTextValidationMessage: String?

    private var listRequestID = UUID()
    private var previewRequestID = UUID()

    var selectedFile: WorkspaceFile? {
        guard let selectedFileID else { return nil }
        return files.first { $0.id == selectedFileID }
    }

    var canUseSelection: Bool {
        selectedFile != nil && !isBusy
    }

    var conflictingImportSources: [String] {
        importOutcome?.conflicts.map(\.sourcePath).filter { !$0.isEmpty } ?? []
    }

    // MARK: - Loading

    func loadFiles(using backend: BackendConnectionModel, preservingSelection: Bool = true) async {
        let requestID = UUID()
        listRequestID = requestID
        let previousSelection = preservingSelection ? selectedFile : nil
        isLoadingFiles = true
        listError = nil

        do {
            let result = try await backend.callTool(
                "list_workspace_files",
                arguments: [
                    "query": .string(searchText.trimmingCharacters(in: .whitespacesAndNewlines)),
                    "max_files": .number(300),
                ],
                requiresSession: false
            )
            guard listRequestID == requestID else { return }
            files = WorkspaceFile.parseList(result)
            if let reported = result["workspaceDir"].stringValue.nonEmpty {
                workspaceDir = reported
            }

            let restoredID = WorkspaceSelection.restoredID(for: previousSelection, in: files)
            if selectedFileID != restoredID {
                selectedFileID = restoredID
            }
            if restoredID == nil {
                preview = nil
            }
            isLoadingFiles = false
        } catch {
            guard listRequestID == requestID else { return }
            isLoadingFiles = false
            if files.isEmpty {
                listError = error.localizedDescription
                preview = nil
            } else {
                // A failed refresh keeps the last good list instead of
                // resetting search, selection, and preview.
                actionError = "刷新失败：\(error.localizedDescription)"
            }
        }
    }

    func loadSelectedFile(using backend: BackendConnectionModel) async {
        guard let file = selectedFile else {
            preview = nil
            return
        }

        let requestID = UUID()
        previewRequestID = requestID
        isLoadingPreview = true
        previewError = nil
        preview = nil

        if file.category != "text" {
            guard previewRequestID == requestID else { return }
            preview = .quickLook(file)
            isLoadingPreview = false
            return
        }

        do {
            let result = try await backend.callTool(
                "read_workspace_file",
                arguments: [
                    "file": .string(file.relativePath),
                    "max_chars": .number(20_000),
                ],
                requiresSession: false
            )
            guard previewRequestID == requestID else { return }
            preview = .text(file, WorkspaceTextPreview.parse(result))
            isLoadingPreview = false
        } catch {
            guard previewRequestID == requestID else { return }
            isLoadingPreview = false
            previewError = error.localizedDescription
        }
    }

    // MARK: - Messages

    func clearActionMessages() {
        actionError = nil
        actionMessage = nil
        importOutcome = nil
    }

    private func reportFailure(_ error: Error, context: String) {
        if let bridgeError = error as? BackendBridgeError, bridgeError.remoteCode == "target_changed" {
            actionError = "\(context)：文件在确认后发生了变化，已取消操作。请刷新后重新确认。"
            return
        }
        actionError = "\(context)：\(error.localizedDescription)"
    }

    // MARK: - Import

    func importItems(_ paths: [String], using backend: BackendConnectionModel) async {
        guard !paths.isEmpty else { return }
        isBusy = true
        actionError = nil
        actionMessage = nil
        importOutcome = nil
        defer { isBusy = false }

        do {
            let result = try await backend.invoke(
                "workspace:import",
                params: ["paths": .array(paths.map { .string($0) })]
            )
            let outcome = WorkspaceImportOutcome.parse(result)
            importOutcome = outcome
            actionMessage = outcome.summaryText
            await loadFiles(using: backend)
            if let first = outcome.imported.first, files.contains(where: { $0.id == first.relativePath }) {
                selectedFileID = first.relativePath
            }
        } catch {
            reportFailure(error, context: "导入失败")
        }
    }

    func importConflictsKeepingBoth(using backend: BackendConnectionModel) async {
        let sources = conflictingImportSources
        guard !sources.isEmpty else { return }
        isBusy = true
        actionError = nil
        importOutcome = nil
        defer { isBusy = false }

        do {
            let result = try await backend.invoke(
                "workspace:import",
                params: [
                    "paths": .array(sources.map { .string($0) }),
                    "conflictPolicy": .string("keep-both"),
                ]
            )
            let outcome = WorkspaceImportOutcome.parse(result)
            importOutcome = outcome
            actionMessage = "已保留两者：\(outcome.summaryText)"
            await loadFiles(using: backend)
            if let first = outcome.imported.first, files.contains(where: { $0.id == first.relativePath }) {
                selectedFileID = first.relativePath
            }
        } catch {
            reportFailure(error, context: "导入失败")
        }
    }

    // MARK: - Pasted text

    func readClipboardText() -> String? {
        guard let text = NSPasteboard.general.string(forType: .string), !text.isEmpty else { return nil }
        return text
    }

    func reportEmptyClipboard() {
        actionMessage = nil
        importOutcome = nil
        actionError = "剪贴板中没有纯文本内容，请先复制文本再试。"
    }

    func beginSavingPastedText(_ text: String) {
        pastedTextDraft = text
        pastedTextName = "pasted-text-\(Self.timestampForFileName()).txt"
        pastedTextValidationMessage = nil
        actionError = nil
        actionMessage = nil
    }

    private static func timestampForFileName() -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyyMMdd-HHmmss"
        return formatter.string(from: Date())
    }

    func updatePastedTextName(_ value: String) {
        pastedTextName = value
        pastedTextValidationMessage = WorkspaceNameValidator.validate(value).message
    }

    func cancelPastedText() {
        pastedTextDraft = ""
        pastedTextName = ""
        pastedTextValidationMessage = nil
    }

    func savePastedText(using backend: BackendConnectionModel) async -> Bool {
        let check = WorkspaceNameValidator.validate(pastedTextName)
        guard let name = check.normalizedName else {
            pastedTextValidationMessage = check.message
            return false
        }

        isBusy = true
        actionError = nil
        actionMessage = nil
        defer { isBusy = false }

        do {
            let result = try await backend.callTool(
                "write_workspace_text_file",
                arguments: [
                    "file_name": .string(name),
                    "content": .string(pastedTextDraft),
                ],
                requiresSession: false
            )
            let relativePath = result["file"].firstString("relativePath", "name")
            cancelPastedText()
            await loadFiles(using: backend)
            if !relativePath.isEmpty, files.contains(where: { $0.id == relativePath }) {
                selectedFileID = relativePath
                actionMessage = "已保存剪贴板文本：\(relativePath)"
            } else {
                actionMessage = "已保存剪贴板文本。"
            }
            return true
        } catch {
            reportFailure(error, context: "保存失败")
            return false
        }
    }

    // MARK: - Rename

    func beginRenaming(_ file: WorkspaceFile) {
        renamingFileID = file.id
        renameDraft = file.name
        renameHint = nil
        renameValidationMessage = nil
        actionError = nil
        actionMessage = nil
    }

    func cancelRenaming() {
        renamingFileID = nil
        renameDraft = ""
        renameHint = nil
        renameValidationMessage = nil
    }

    func updateRenameDraft(_ value: String, originalExtension: String) {
        renameDraft = value
        let check = WorkspaceNameValidator.validate(value)
        renameValidationMessage = check.message
        renameHint = check.message == nil
            ? WorkspaceNameValidator.extensionHint(for: value, originalExtension: originalExtension)
            : nil
    }

    func commitRename(using backend: BackendConnectionModel) async {
        guard let renamingFileID, let file = files.first(where: { $0.id == renamingFileID }) else { return }
        let check = WorkspaceNameValidator.validate(renameDraft)
        guard let newName = check.normalizedName else {
            renameValidationMessage = check.message
            return
        }
        if newName == file.name {
            cancelRenaming()
            return
        }

        isBusy = true
        actionError = nil
        actionMessage = nil
        defer { isBusy = false }

        do {
            let result = try await backend.invoke(
                "workspace:rename",
                params: [
                    "file": .string(file.relativePath),
                    "newName": .string(newName),
                ]
            )
            let renamedPath = result["file"].firstString("relativePath", "name")
            cancelRenaming()
            // The list keeps the item selected through its file identity, so a
            // successful rename moves the selection to the new name.
            await loadFiles(using: backend)
            if !renamedPath.isEmpty, files.contains(where: { $0.id == renamedPath }) {
                selectedFileID = renamedPath
            }
            actionMessage = "已重命名为：\(result["file"].firstString("name", renamedPath))"
        } catch {
            reportFailure(error, context: "重命名失败")
        }
    }

    // MARK: - Delete

    func delete(_ file: WorkspaceFile, using backend: BackendConnectionModel) async {
        isBusy = true
        actionError = nil
        actionMessage = nil
        importOutcome = nil
        defer { isBusy = false }

        do {
            _ = try await backend.invoke(
                "workspace:delete",
                params: [
                    "file": .string(file.relativePath),
                    "expected": .object([
                        "identity": .string(file.identity),
                        "modifiedAt": .string(file.modifiedAt),
                    ]),
                ]
            )
            if selectedFileID == file.id {
                selectedFileID = nil
                preview = nil
            }
            await loadFiles(using: backend, preservingSelection: false)
            actionMessage = "已删除文件：\(file.relativePath)"
        } catch {
            reportFailure(error, context: "删除失败")
            await loadFiles(using: backend)
        }
    }

    // MARK: - Finder

    func revealWorkspace(using backend: BackendConnectionModel) async {
        do {
            _ = try await backend.invoke("workspace:open")
            actionError = nil
        } catch {
            actionError = "无法在 Finder 中显示工作区：\(error.localizedDescription)"
        }
    }

    func revealSelectedFile() {
        guard let file = selectedFile else { return }
        guard isInsideWorkspace(file.path) else {
            actionError = "只能显示工作区内的文件。"
            return
        }
        NSWorkspace.shared.activateFileViewerSelecting([URL(filePath: file.path)])
    }

    private func isInsideWorkspace(_ path: String) -> Bool {
        guard let workspaceDir, !workspaceDir.isEmpty else { return false }
        let root = URL(filePath: workspaceDir).standardizedFileURL.pathComponents
        let target = URL(filePath: path).standardizedFileURL.pathComponents
        return target.count > root.count && Array(target.prefix(root.count)) == root
    }
}
