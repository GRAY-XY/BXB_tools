import Foundation
import Observation

@MainActor
@Observable
final class WorkspaceViewModel {
    private(set) var files: [WorkspaceFile] = []
    private(set) var preview: WorkspacePreview?
    private(set) var isLoadingFiles = false
    private(set) var isLoadingPreview = false
    private(set) var listError: String?
    private(set) var previewError: String?

    var searchText = ""
    var selectedFileID: String?

    private var listRequestID = UUID()
    private var previewRequestID = UUID()

    func loadFiles(using backend: BackendConnectionModel) async {
        let requestID = UUID()
        listRequestID = requestID
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
            if let selectedFileID, !files.contains(where: { $0.id == selectedFileID }) {
                self.selectedFileID = nil
                preview = nil
            }
            isLoadingFiles = false
        } catch {
            guard listRequestID == requestID else { return }
            isLoadingFiles = false
            files = []
            preview = nil
            listError = error.localizedDescription
        }
    }

    func loadSelectedFile(using backend: BackendConnectionModel) async {
        guard let file = files.first(where: { $0.id == selectedFileID }) else {
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
}
