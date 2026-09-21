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
        precondition(detail.warnings == ["Check the cited page."])
        precondition(detail.missingInfo == ["Confirm the due date."])
        print("draft-parser=ok count=\(drafts.count) status=\(detail.status)")
    }
}
