import Foundation

enum DraftFilter: String, CaseIterable, Identifiable {
    case all
    case pendingReview = "pending_review"
    case approved
    case rejected
    case submitted
    case sentToTeacher = "sent_to_teacher"

    var id: Self { self }

    var title: String {
        switch self {
        case .all: "全部状态"
        case .pendingReview: "待审核"
        case .approved: "已通过"
        case .rejected: "已驳回"
        case .submitted: "已提交"
        case .sentToTeacher: "已私信老师"
        }
    }
}

struct SubmissionDraftSummary: Identifiable, Hashable, Sendable {
    let id: String
    let taskID: String
    let taskTitle: String
    let subjectName: String
    let status: String
    let createdAt: String
    let updatedAt: String
    let deliveryTarget: String
    let deliveryAttemptStatus: String
    let warningCount: Int
    let missingInfoCount: Int
    let needsUserInput: Bool

    var statusLabel: String { DraftStatus.label(for: status) }
    var statusSymbol: String { DraftStatus.symbol(for: status) }
    var isFinal: Bool { DraftStatus.isFinal(status) }
    var createdDisplay: String { DraftDate.display(createdAt) }

    static func parseList(_ value: JSONValue) -> [SubmissionDraftSummary] {
        value["drafts"].arrayValue.compactMap { item in
            let id = item.firstString("draftId", "id")
            guard !id.isEmpty else { return nil }
            return SubmissionDraftSummary(
                id: id,
                taskID: item.firstString("taskId"),
                taskTitle: item.firstString("taskTitle").fallback("未命名草稿"),
                subjectName: item.firstString("subjectName"),
                status: item.firstString("status").fallback("pending_review"),
                createdAt: item.firstString("createdAt"),
                updatedAt: item.firstString("updatedAt"),
                deliveryTarget: item.firstString("deliveryTarget", "preferredTarget").fallback("task"),
                deliveryAttemptStatus: item["deliveryAttempt"]["status"].stringValue
                    .fallback(item.firstString("deliveryAttemptStatus")),
                warningCount: item["warningCount"].intValue ?? 0,
                missingInfoCount: item["missingInfoCount"].intValue ?? 0,
                needsUserInput: item["needsUserInput"].boolValue ?? false
            )
        }
    }
}

struct SubmissionDraftDetail: Sendable {
    let id: String
    let taskID: String
    let taskTitle: String
    let subjectName: String
    let status: String
    let draftText: String
    let summary: String
    let createdAt: String
    let updatedAt: String
    let reviewedAt: String
    let reviewNote: String
    let deliveryTarget: String
    let deliveryAttemptStatus: String
    let deliveryHistory: [DraftDeliveryHistoryEntry]
    let warnings: [String]
    let missingInfo: [String]
    let needsUserInput: Bool

    var statusLabel: String { DraftStatus.label(for: status) }
    var statusSymbol: String { DraftStatus.symbol(for: status) }
    var isFinal: Bool { DraftStatus.isFinal(status) }
    var canReview: Bool { !isFinal }
    var createdDisplay: String { DraftDate.display(createdAt) }
    var updatedDisplay: String { DraftDate.display(updatedAt) }
    var reviewedDisplay: String { DraftDate.display(reviewedAt) }
    var deliveryTargetLabel: String {
        deliveryTarget == "teacher_private_message" ? "私信老师" : "作业提交"
    }

    static func parse(_ value: JSONValue) -> SubmissionDraftDetail {
        let nested = value["draft"]
        let source = nested.firstString("draftId", "id").isEmpty ? value : nested
        return SubmissionDraftDetail(
            id: source.firstString("draftId", "id"),
            taskID: source.firstString("taskId"),
            taskTitle: source.firstString("taskTitle").fallback("未命名草稿"),
            subjectName: source.firstString("subjectName"),
            status: source.firstString("status").fallback("pending_review"),
            draftText: source.firstString("draftText"),
            summary: source.firstString("summary"),
            createdAt: source.firstString("createdAt"),
            updatedAt: source.firstString("updatedAt"),
            reviewedAt: source.firstString("reviewedAt", "rejectedAt"),
            reviewNote: source.firstString("reviewNote"),
            deliveryTarget: source.firstString("deliveryTarget", "preferredTarget").fallback("task"),
            deliveryAttemptStatus: source["deliveryAttempt"]["status"].stringValue,
            deliveryHistory: DraftDeliveryHistoryEntry.parseList(source["deliveryHistory"].arrayValue),
            warnings: source["warnings"].stringArray,
            missingInfo: source["missingInfo"].stringArray,
            needsUserInput: source["needsUserInput"].boolValue ?? false
        )
    }
}

struct DraftDeliveryHistoryEntry: Identifiable, Hashable, Sendable {
    let id: String
    let type: String
    let status: String
    let taskID: String
    let modeLabel: String
    let submissionID: String
    let occurredAt: String
    let error: String

    var title: String {
        let target = type == "teacher_private_message" ? "私信老师" : "提交作业"
        switch status {
        case "success": return "\(target)成功"
        case "failed": return "\(target)失败"
        case "unknown", "in_flight": return "\(target)结果待核对"
        case "partial": return "\(target)部分完成"
        default: return target
        }
    }

    static func parseList(_ values: [JSONValue]) -> [Self] {
        values.enumerated().map { index, item in
            Self(
                id: item.firstString("attemptId", "submittedAt", "sentAt", "failedAt").fallback(String(index)),
                type: item.firstString("type"),
                status: item.firstString("status"),
                taskID: item.firstString("taskId"),
                modeLabel: item.firstString("modeLabel"),
                submissionID: item.firstString("submissionId"),
                occurredAt: item.firstString("completedAt", "submittedAt", "sentAt", "failedAt", "startedAt"),
                error: item.firstString("error")
            )
        }
    }
}

struct DraftRetainedAttachment: Identifiable, Hashable, Sendable {
    let id: String
    let fileName: String
    let fileSize: String

    static func parseList(_ values: [JSONValue]) -> [Self] {
        values.enumerated().map { index, item in
            let fileID = item.firstString("fileId")
            return Self(
                id: fileID.isEmpty ? String(index) : fileID,
                fileName: item.firstString("fileName", "name").fallback("未命名附件"),
                fileSize: item.firstString("fileSize")
            )
        }
    }
}

struct DraftSubmissionPreview: Sendable {
    let draftID: String
    let taskID: String
    let taskTitle: String
    let subjectName: String
    let destination: String
    let draftText: String
    let mode: String
    let modeLabel: String
    let submissionID: String
    let retainedAttachments: [DraftRetainedAttachment]
    let canSubmit: Bool
    let reason: String
    let note: String
    let confirmationToken: String

    static func parse(_ value: JSONValue) -> Self? {
        let taskID = value.firstString("taskId")
        let token = value.firstString("confirmationToken")
        guard !taskID.isEmpty, !token.isEmpty else { return nil }
        return Self(
            draftID: value.firstString("draftId"),
            taskID: taskID,
            taskTitle: value.firstString("taskTitle").fallback("未命名作业"),
            subjectName: value.firstString("subjectName").fallback("未知课程"),
            destination: value.firstString("destination").fallback("伴学邦作业提交"),
            draftText: value.firstString("draftText"),
            mode: value.firstString("mode"),
            modeLabel: value.firstString("modeLabel").fallback("提交"),
            submissionID: value.firstString("submissionId"),
            retainedAttachments: DraftRetainedAttachment.parseList(value["retainedAttachments"].arrayValue),
            canSubmit: value["canSubmit"].boolValue ?? false,
            reason: value.firstString("reason"),
            note: value.firstString("note"),
            confirmationToken: token
        )
    }
}

enum DraftStatus {
    static func label(for value: String) -> String {
        switch value {
        case "pending_review": "待审核"
        case "approved": "已通过"
        case "rejected": "已驳回"
        case "submitted": "已提交"
        case "sent_to_teacher": "已私信老师"
        default: value.isEmpty ? "未知状态" : value
        }
    }

    static func symbol(for value: String) -> String {
        switch value {
        case "pending_review": "clock.badge.questionmark"
        case "approved": "checkmark.seal.fill"
        case "rejected": "xmark.seal.fill"
        case "submitted": "paperplane.fill"
        case "sent_to_teacher": "message.fill"
        default: "questionmark.circle"
        }
    }

    static func isFinal(_ value: String) -> Bool {
        value == "submitted" || value == "sent_to_teacher"
    }
}

private enum DraftDate {
    static func display(_ value: String) -> String {
        guard !value.isEmpty else { return "—" }
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let formatters = [fractional, ISO8601DateFormatter()]
        guard let date = formatters.lazy.compactMap({ $0.date(from: value) }).first else { return value }
        return date.formatted(date: .abbreviated, time: .shortened)
    }
}

private extension JSONValue {
    var stringArray: [String] {
        arrayValue.map(\.stringValue).filter { !$0.isEmpty }
    }
}

private extension String {
    func fallback(_ value: String) -> String {
        isEmpty ? value : self
    }
}
