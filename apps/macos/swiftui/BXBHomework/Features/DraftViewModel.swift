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
    private(set) var privateMessagePreview: DraftPrivateMessagePreview?
    private(set) var selectedPrivateMessageContactKey: String?

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

    var canPreparePrivateMessage: Bool {
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
                privateMessagePreview = nil
                selectedPrivateMessageContactKey = nil
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
        privateMessagePreview = nil
        selectedPrivateMessageContactKey = nil
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
        privateMessagePreview = nil
        selectedPrivateMessageContactKey = nil
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

    func preparePrivateMessage(using backend: BackendConnectionModel) async {
        guard canPreparePrivateMessage, let detail else { return }
        submissionPreview = nil
        privateMessagePreview = nil
        selectedPrivateMessageContactKey = nil
        isPerformingAction = true
        detailError = nil
        actionMessage = nil
        defer { isPerformingAction = false }

        do {
            let result = try await backend.callTool(
                "prepare_draft_private_message",
                arguments: ["draft_id": .string(detail.id)]
            )
            guard let preview = DraftPrivateMessagePreview.parse(result) else {
                throw BackendBridgeError.protocolFailure("私信预览缺少 task 信息或确认令牌。")
            }
            privateMessagePreview = preview
        } catch {
            detailError = error.localizedDescription
        }
    }

    func selectPrivateMessageContact(_ contactKey: String, using backend: BackendConnectionModel) async {
        guard let detail, let preview = privateMessagePreview,
              let contact = preview.contacts.first(where: { $0.contactKey == contactKey }) else { return }
        selectedPrivateMessageContactKey = contactKey
        isPerformingAction = true
        detailError = nil
        defer { isPerformingAction = false }

        do {
            let result = try await backend.callTool(
                "prepare_draft_private_message",
                arguments: [
                    "draft_id": .string(detail.id),
                    "contact": contact.rawValue,
                ]
            )
            guard let refreshedPreview = DraftPrivateMessagePreview.parse(result) else {
                throw BackendBridgeError.protocolFailure("所选联系人对应的私信预览无效。")
            }
            privateMessagePreview = refreshedPreview
        } catch {
            detailError = error.localizedDescription
        }
    }

    func cancelPrivateMessagePreview() {
        privateMessagePreview = nil
        selectedPrivateMessageContactKey = nil
        detailError = nil
    }

    func sendPreparedPrivateMessage(using backend: BackendConnectionModel) async {
        guard let detail, let preview = privateMessagePreview,
              let contact = preview.selectedContact, preview.canSend,
              detail.id == preview.draftID, detail.status == "approved", !hasUnsavedChanges else { return }

        isPerformingAction = true
        detailError = nil
        actionMessage = nil
        privateMessagePreview = nil
        defer { isPerformingAction = false }

        do {
            let result = try await backend.callTool(
                "send_approved_draft_private_message",
                arguments: [
                    "draft_id": .string(detail.id),
                    "contact": contact.rawValue,
                    "confirmation_token": .string(preview.confirmationToken),
                ]
            )
            await refreshAfterDelivery(using: backend)
            if result["sent"].boolValue == true {
                let localRecordUpdated = result["localRecordUpdated"].boolValue ?? false
                actionMessage = localRecordUpdated
                    ? "已向\(contact.peerName)发送 \(preview.chunks.count) 段私信，并保存了本地交付记录。"
                    : "私信已发送，但本地状态仍待核对：\(result.firstString("localRecordError").fallback("请检查本机草稿状态。"))"
            } else {
                let sentCount = result["sentCount"].intValue ?? 0
                let failedIndex = result["failedChunkIndex"].intValue ?? preview.nextChunkIndex + 1
                if result["outcomeUnknown"].boolValue == true {
                    detailError = result["remoteAccepted"].boolValue == true
                        ? "伴学邦已确认第 \(sentCount) 段发送成功，但本地进度保存失败。请核对伴学邦会话和本机草稿；系统已阻止重复发送。"
                        : "第 \(failedIndex) 段私信的结果未知。请先核对伴学邦会话；系统已锁定草稿并阻止重复发送。"
                } else if sentCount > 0 {
                    actionMessage = "已确认发送 \(sentCount) 段；第 \(failedIndex) 段被拒绝。重新准备并确认后会从未发送部分继续。"
                } else {
                    detailError = result.firstString("error").fallback("私信未发送，请检查联系人和消息内容后重试。")
                }
            }
        } catch {
            let message = error.localizedDescription
            await refreshAfterDelivery(using: backend)
            detailError = message
        }
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
            await refreshAfterDelivery(using: backend)
            actionMessage = localRecordUpdated
                ? "作业已提交，结果已保存到本地交付记录。"
                : "作业已提交，但本地交付记录未能保存：\(localRecordError.isEmpty ? "请检查本机草稿状态。" : localRecordError)"
        } catch {
            let message = error.localizedDescription
            await refreshAfterDelivery(using: backend)
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
        submissionPreview = nil
        privateMessagePreview = nil
        selectedPrivateMessageContactKey = nil
    }

    private func refreshAfterDelivery(using backend: BackendConnectionModel) async {
        await loadSelectedDraft(using: backend)
        if let detail, selectedFilter != .all, selectedFilter.rawValue != detail.status {
            selectedFilter = .all
        }
        await loadDrafts(using: backend)
    }
}
