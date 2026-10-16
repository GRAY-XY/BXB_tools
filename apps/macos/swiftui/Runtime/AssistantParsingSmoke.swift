import Foundation

@main
struct AssistantParsingSmoke {
    static func main() throws {
        let payload = #"""
        {
          "activeId": "conversation_1",
          "conversations": [
            {
              "id": "conversation_1",
              "title": "Homework plan",
              "createdAt": "2026-09-21T10:00:00.000Z",
              "updatedAt": "2026-09-21T10:05:00.000Z",
              "messageCount": 2,
              "context": { "usagePercent": 12 }
            }
          ],
          "activeConversation": {
            "id": "conversation_1",
            "title": "Homework plan",
            "context": { "usagePercent": 12 },
            "messages": [
              {
                "id": "m1", "role": "user", "text": "Make a plan", "at": "2026-09-21T10:00:00.000Z",
                "attachments": [{ "fileName": "diagram.png", "relativePath": "images/diagram.png", "mimeType": "image/png", "sizeBytes": 1200 }]
              },
              {
                "id": "m2",
                "role": "assistant",
                "text": "Here is a plan.",
                "at": "2026-09-21T10:05:00.000Z",
                "steps": [{ "kind": "done", "title": "Finished", "detail": "Rendered two code pages", "previewImages": [
                  { "relativePath": "Code Previews/solution-01.png", "fileName": "solution-01.png", "width": 1000, "height": 900, "firstLine": 1, "lastLine": 40 },
                  { "relativePath": "Code Previews/solution-02.png", "fileName": "solution-02.png", "width": 1000, "height": 400, "firstLine": 41, "lastLine": 55 }
                ] }],
                "status": "completed"
              }
            ]
          }
        }
        """#
        let value = try JSONDecoder().decode(JSONValue.self, from: Data(payload.utf8))
        let state = AssistantConversationState.parse(value)
        precondition(state.activeID == "conversation_1")
        precondition(state.conversations.count == 1)
        precondition(state.conversations[0].messageCount == 2)
        precondition(state.contextUsagePercent == 12)
        precondition(state.messages.count == 2)
        precondition(state.messages[0].isUser)
        precondition(state.messages[0].attachments.first?.relativePath == "images/diagram.png")
        precondition(state.messages[1].steps.first?.kind == "done")
        let storedStep = state.messages[1].steps[0]
        precondition(storedStep.detail == "Rendered two code pages")
        precondition(storedStep.previewImages.count == 2)
        precondition(storedStep.previewImages[0].width == 1000)
        precondition(storedStep.previewImages[0].height == 900)
        precondition(storedStep.previewImages[1].relativePath == "Code Previews/solution-02.png")
        precondition(storedStep.previewImages[1].caption == "solution-02.png · 第 41–55 行")
        precondition(storedStep.previewImages[0].id != storedStep.previewImages[1].id)

        let textEvent = try JSONDecoder().decode(JSONValue.self, from: Data(#"{"type":"agent-text","conversationId":"conversation_1","messageId":"m2","text":"Draft response","isRunning":true}"#.utf8))
        let stepEvent = try JSONDecoder().decode(JSONValue.self, from: Data(#"{"type":"agent-step","conversationId":"conversation_1","messageId":"m2","steps":[{"kind":"llm","title":"Thinking"}]}"#.utf8))
        var streamingMessage = AssistantMessage.optimistic(id: "m2", role: "assistant", text: "", isRunning: true)
        guard let textProgress = AssistantProgress.parse(textEvent),
              let stepProgress = AssistantProgress.parse(stepEvent) else {
            preconditionFailure("Progress event was not parsed")
        }
        streamingMessage.apply(textProgress)
        streamingMessage.apply(stepProgress)
        precondition(streamingMessage.text == "Draft response")
        precondition(streamingMessage.steps.first?.title == "Thinking")
        precondition(streamingMessage.steps[0].previewImages.isEmpty)

        let previewEvent = JSONValue.object([
            "type": .string("agent-step"),
            "conversationId": .string("conversation_1"),
            "messageId": .string("m2"),
            "steps": value["activeConversation"]["messages"].arrayValue[1]["steps"]
        ])
        guard let previewProgress = AssistantProgress.parse(previewEvent) else {
            preconditionFailure("Code preview progress was not parsed")
        }
        streamingMessage.apply(previewProgress)
        precondition(streamingMessage.steps == state.messages[1].steps)

        let legacyStep = AssistantStep.parse(.object(["title": .string("Older conversation")]), index: 0)
        precondition(legacyStep.previewImages.isEmpty)
        let malformedPreviews = AssistantStep.parse(.object(["previewImages": .array([
            .null,
            .string("invalid"),
            .object(["relativePath": .string("Code Previews/fallback.png")]),
            .object([:])
        ])]), index: 0).previewImages
        precondition(malformedPreviews.count == 2)
        precondition(malformedPreviews[0].caption == "fallback.png")
        precondition(malformedPreviews[1].caption == "代码预览.png")

        let configPayload = #"""
        { "providerName": "OpenAI", "modelName": "gpt-test", "hasApiKey": true }
        """#
        let configValue = try JSONDecoder().decode(JSONValue.self, from: Data(configPayload.utf8))
        let model = AssistantModelSummary.parse(configValue)
        precondition(model.isConfigured)
        precondition(model.displayName == "OpenAI · gpt-test")
        print("assistant-parser=ok conversations=\(state.conversations.count) messages=\(state.messages.count)")
    }
}
