import Foundation

@main
struct DraftParsingSmoke {
    static func main() throws {
        let payload = #"""
        {
          "draftDirectory": "/tmp/drafts",
          "drafts": [
            {
              "draftId": "draft_1",
              "status": "pending_review",
              "taskId": "task_9",
              "taskTitle": "Unit 3 Reflection",
              "subjectName": "English",
              "createdAt": "2026-09-21T10:30:00.000Z",
              "warningCount": 1,
              "missingInfoCount": 2,
              "needsUserInput": true
            }
          ]
        }
        """#
        let value = try JSONDecoder().decode(JSONValue.self, from: Data(payload.utf8))
        let drafts = SubmissionDraftSummary.parseList(value)
        precondition(drafts.count == 1)
        precondition(drafts[0].id == "draft_1")
        precondition(drafts[0].statusLabel == "待审核")
        precondition(drafts[0].warningCount == 1)
        precondition(drafts[0].missingInfoCount == 2)

        let detailPayload = #"""
        {
          "draft": {
            "draftId": "draft_1",
            "status": "approved",
            "taskId": "task_9",
            "taskTitle": "Unit 3 Reflection",
            "subjectName": "English",
            "draftText": "A plain-text response.",
            "summary": "Short reflection",
            "createdAt": "2026-09-21T10:30:00.000Z",
            "updatedAt": "2026-09-21T11:00:00.000Z",
            "preferredTarget": "teacher_private_message",
            "deliveryAttempt": {"status": "unknown"},
            "deliveryHistory": [{"type": "task", "status": "unknown", "taskId": "task_9", "modeLabel": "提交", "completedAt": "2026-09-21T11:30:00.000Z", "error": "connection lost"}],
            "warnings": ["Check the cited page."],
            "missingInfo": ["Confirm the due date."],
            "needsUserInput": true
          }
        }
        """#
        let detailValue = try JSONDecoder().decode(JSONValue.self, from: Data(detailPayload.utf8))
        let detail = SubmissionDraftDetail.parse(detailValue)
        precondition(detail.id == "draft_1")
        precondition(detail.statusLabel == "已通过")
        precondition(detail.draftText == "A plain-text response.")
        precondition(detail.deliveryTargetLabel == "私信老师")
        precondition(detail.deliveryAttemptStatus == "unknown")
        precondition(detail.deliveryHistory.first?.title == "提交作业结果待核对")
        precondition(detail.deliveryHistory.first?.error == "connection lost")
        precondition(detail.warnings == ["Check the cited page."])
        precondition(detail.missingInfo == ["Confirm the due date."])

        let previewPayload = #"""
        {"draftId":"draft_1","taskId":"task_9","taskTitle":"Unit 3 Reflection","subjectName":"English","destination":"伴学邦作业提交","draftText":"Full response","mode":"resubmit","modeLabel":"重新提交","submissionId":"submission_3","retainedAttachments":[{"fileId":"file_1","fileName":"answer.pdf","fileSize":"321"}],"canSubmit":true,"confirmationToken":"token_1"}
        """#
        let preview = DraftSubmissionPreview.parse(try JSONDecoder().decode(JSONValue.self, from: Data(previewPayload.utf8)))
        precondition(preview?.taskID == "task_9")
        precondition(preview?.draftText == "Full response")
        precondition(preview?.retainedAttachments.first?.fileName == "answer.pdf")
        precondition(preview?.canSubmit == true)
        print("draft-parser=ok count=\(drafts.count) status=\(detail.status)")
    }
}
