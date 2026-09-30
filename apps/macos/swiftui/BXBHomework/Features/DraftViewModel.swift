import Foundation
import Observation

@MainActor
@Observable
final class DraftViewModel {
    private(set) var drafts: [SubmissionDraftSummary] = []
    private(set) var detail: SubmissionDraftDetail?
    private(set) var isLoadingList = false
    private(set) var isLoadingDetail = false
    private(set) var isPerformingAction = false
    private(set) var listError: String?
    private(set) var detailError: String?
    private(set) var actionMessage: String?
    private(set) var submissionPreview: DraftSubmissionPreview?

    var selectedFilter: DraftFilter = .all
    var selectedDraftID: String?
    var editableText = ""
    var editableSummary = ""

    private var listRequestID = UUID()
    private var detailRequestID = UUID()

    var hasUnsavedChanges: Bool {
        guard let detail else { return false }
        return editableText.trimmingCharacters(in: .whitespacesAndNewlines) != detail.draftText.trimmingCharacters(in: .whitespacesAndNewlines)
            || editableSummary.trimmingCharacters(in: .whitespacesAndNewlines) != detail.summary.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    var canPrepareSubmission: Bool {
        detail?.status == "approved" && !hasUnsavedChanges && !isPerformingAction
    }

    func loadDrafts(using backend: BackendConnectionModel) async {
        let requestID = UUID()
        listRequestID = requestID
        isLoadingList = true
        listError = nil

        do {
            let result = try await backend.callTool(
                "list_submission_drafts",
                arguments: ["status": .string(selectedFilter.rawValue)],
                requiresSession: false
            )
            guard listRequestID == requestID else { return }
            drafts = SubmissionDraftSummary.parseList(result)
            if let selectedDraftID, !drafts.contains(where: { $0.id == selectedDraftID }) {
                self.selectedDraftID = nil
                detail = nil
                editableText = ""
                editableSummary = ""
                submissionPreview = nil
            }
            isLoadingList = false
        } catch {
            guard listRequestID == requestID else { return }
            isLoadingList = false
            drafts = []
            listError = error.localizedDescription
        }
    }

    func loadSelectedDraft(using backend: BackendConnectionModel) async {
        submissionPreview = nil
        guard let selectedDraftID else {
            detail = nil
            editableText = ""
            editableSummary = ""
            return
        }

        let requestID = UUID()
        detailRequestID = requestID
        isLoadingDetail = true
        detailError = nil
        actionMessage = nil

        do {
            let result = try await backend.callTool(
                "get_submission_draft",
                arguments: ["draft_id": .string(selectedDraftID)],
                requiresSession: false
            )
            guard detailRequestID == requestID else { return }
            apply(SubmissionDraftDetail.parse(result))
            isLoadingDetail = false
        } catch {
            guard detailRequestID == requestID else { return }
            isLoadingDetail = false
            detail = nil
            detailError = error.localizedDescription
        }
    }

    func save(using backend: BackendConnectionModel) async {
        guard let detail, !detail.isFinal else { return }
        let text = editableText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else {
            actionMessage = "草稿正文不能为空。"
            return
        }

        await performAction(backend: backend) {
            try await backend.callTool(
                "update_submission_draft",
                arguments: [
                    "draft_id": .string(detail.id),
                    "draft_text": .string(text),
                    "summary": .string(editableSummary.trimmingCharacters(in: .whitespacesAndNewlines)),
                ],
                requiresSession: false
            )
        } successMessage: {
            "草稿已保存，并回到待审核状态。"
        }
    }

    func approve(using backend: BackendConnectionModel) async {
        guard let detail, detail.canReview else { return }
        await performAction(backend: backend) {
            try await backend.callTool(
                "approve_submission_draft",
                arguments: [
                    "draft_id": .string(detail.id),
                    "review_note": .string("macOS SwiftUI approved"),
                ],
                requiresSession: false
            )
        } successMessage: {
            "草稿已通过审核。真实提交仍未执行。"
        }
    }

    func reject(using backend: BackendConnectionModel) async {
        guard let detail, detail.canReview else { return }
        await performAction(backend: backend) {
            try await backend.callTool(
                "reject_submission_draft",
                arguments: [
                    "draft_id": .string(detail.id),
                    "review_note": .string("macOS SwiftUI rejected"),
                ],
                requiresSession: false
            )
        } successMessage: {
            "草稿已驳回；没有提交或发送任何内容。"
        }
    }

    func prepareSubmission(using backend: BackendConnectionModel) async {
        guard canPrepareSubmission, let detail else { return }
        isPerformingAction = true
        detailError = nil
        actionMessage = nil
        defer { isPerformingAction = false }

        do {
            let result = try await backend.callTool(
                "prepare_draft_submission",
                arguments: ["draft_id": .string(detail.id)]
            )
            guard let preview = DraftSubmissionPreview.parse(result) else {
                throw BackendBridgeError.protocolFailure("提交预览缺少 task 信息或确认令牌。")
            }
            submissionPreview = preview
        } catch {
            detailError = error.localizedDescription
        }
    }

    func cancelSubmissionPreview() {
        submissionPreview = nil
        detailError = nil
    }

    func submitPreparedDraft(using backend: BackendConnectionModel) async {
        guard let detail, let preview = submissionPreview, preview.canSubmit,
              detail.id == preview.draftID, detail.status == "approved", !hasUnsavedChanges else { return }

        isPerformingAction = true
        detailError = nil
        actionMessage = nil
        submissionPreview = nil
        defer { isPerformingAction = false }

        do {
            let result = try await backend.callTool(
                "submit_approved_draft",
                arguments: [
                    "draft_id": .string(detail.id),
                    "confirmation_token": .string(preview.confirmationToken),
                ]
            )
            guard result["submitted"].boolValue == true else {
                throw BackendBridgeError.protocolFailure("提交工具没有确认作业已提交。")
            }
            let localRecordUpdated = result["localRecordUpdated"].boolValue ?? false
            let localRecordError = result.firstString("localRecordError")
            await loadSelectedDraft(using: backend)
            await loadDrafts(using: backend)
            actionMessage = localRecordUpdated
                ? "作业已提交，结果已保存到本地交付记录。"
                : "作业已提交，但本地交付记录未能保存：\(localRecordError.isEmpty ? "请检查本机草稿状态。" : localRecordError)"
        } catch {
            let message = error.localizedDescription
            await loadSelectedDraft(using: backend)
            detailError = message
        }
    }

    private func performAction(
        backend: BackendConnectionModel,
        _ action: () async throws -> JSONValue,
        successMessage: () -> String
    ) async {
        isPerformingAction = true
        detailError = nil
        actionMessage = nil
        defer { isPerformingAction = false }

        do {
            let result = try await action()
            apply(SubmissionDraftDetail.parse(result))
            actionMessage = successMessage()
            await loadDrafts(using: backend)
        } catch {
            detailError = error.localizedDescription
        }
    }

    private func apply(_ draft: SubmissionDraftDetail) {
        detail = draft
        editableText = draft.draftText
        editableSummary = draft.summary
    }
}
