import Foundation

struct AssistantStep: Identifiable, Hashable, Sendable {
    let id: String
    let kind: String
    let title: String
    let detail: String
    let at: String

    static func parse(_ value: JSONValue, index: Int) -> AssistantStep {
        let kind = value.firstString("kind", "type")
        let title = value.firstString("title").fallback("执行步骤")
        let at = value.firstString("at", "createdAt")
        return AssistantStep(
            id: value.firstString("id").fallback("\(index)-\(kind)-\(title)-\(at)"),
            kind: kind,
            title: title,
            detail: value.firstString("detail", "message"),
            at: at
        )
    }
}

struct AssistantAttachment: Identifiable, Hashable, Sendable {
    let fileName: String
    let relativePath: String
    let mimeType: String
    let sizeBytes: Int

    var id: String { relativePath }

    static func parse(_ value: JSONValue) -> AssistantAttachment? {
        let relativePath = value.firstString("relativePath")
        guard !relativePath.isEmpty else { return nil }
        return AssistantAttachment(
            fileName: value.firstString("fileName", "name").fallback(relativePath),
            relativePath: relativePath,
            mimeType: value.firstString("mimeType"),
            sizeBytes: value["sizeBytes"].intValue ?? 0
        )
    }
}

struct AssistantMessage: Identifiable, Hashable, Sendable {
    let id: String
    let role: String
    var text: String
    let at: String
    var steps: [AssistantStep]
    var isRunning: Bool
    var status: String
    let attachments: [AssistantAttachment]

    var isUser: Bool { role == "user" }
    var timeDisplay: String { AssistantDate.display(at) }

    static func parse(_ value: JSONValue, index: Int) -> AssistantMessage {
        let role = value.firstString("role") == "user" ? "user" : "assistant"
        let at = value.firstString("at", "createdAt")
        return AssistantMessage(
            id: value.firstString("id").fallback("message-\(index)-\(at)"),
            role: role,
            text: value.firstString("text", "content", "message"),
            at: at,
            steps: value["steps"].arrayValue.enumerated().map { AssistantStep.parse($0.element, index: $0.offset) },
            isRunning: value["isRunning"].boolValue ?? false,
            status: value.firstString("status").fallback("completed"),
            attachments: value["attachments"].arrayValue.compactMap(AssistantAttachment.parse)
        )
    }

    static func optimistic(
        id: String,
        role: String,
        text: String,
        isRunning: Bool = false,
        attachments: [AssistantAttachment] = []
    ) -> AssistantMessage {
        AssistantMessage(
            id: id,
            role: role,
            text: text,
            at: ISO8601DateFormatter().string(from: Date()),
            steps: [],
            isRunning: isRunning,
            status: isRunning ? "running" : "completed",
            attachments: attachments
        )
    }

    mutating func apply(_ progress: AssistantProgress) {
        guard progress.messageID == id else { return }
        switch progress.kind {
        case .text(let text):
            self.text = text
        case .steps(let steps):
            self.steps = steps
        }
    }
}

struct AssistantProgress: Sendable {
    enum Kind: Sendable {
        case text(String)
        case steps([AssistantStep])
    }

    let conversationID: String
    let messageID: String
    let kind: Kind

    static func parse(_ value: JSONValue) -> AssistantProgress? {
        let conversationID = value.firstString("conversationId")
        let messageID = value.firstString("messageId")
        guard !conversationID.isEmpty, !messageID.isEmpty else { return nil }
        switch value.firstString("type") {
        case "agent-text":
            return AssistantProgress(
                conversationID: conversationID,
                messageID: messageID,
                kind: .text(value["text"].stringValue)
            )
        case "agent-step":
            let steps = value["steps"].arrayValue.enumerated().map {
                AssistantStep.parse($0.element, index: $0.offset)
            }
            return AssistantProgress(conversationID: conversationID, messageID: messageID, kind: .steps(steps))
        default:
            return nil
        }
    }
}

struct AssistantConversationSummary: Identifiable, Hashable, Sendable {
    let id: String
    let title: String
    let createdAt: String
    let updatedAt: String
    let messageCount: Int
    let contextUsagePercent: Int

    var updatedDisplay: String { AssistantDate.display(updatedAt) }

    static func parse(_ value: JSONValue) -> AssistantConversationSummary? {
        let id = value.firstString("id", "conversationId")
        guard !id.isEmpty else { return nil }
        return AssistantConversationSummary(
            id: id,
            title: value.firstString("title").fallback("新对话"),
            createdAt: value.firstString("createdAt"),
            updatedAt: value.firstString("updatedAt"),
            messageCount: value["messageCount"].intValue ?? 0,
            contextUsagePercent: value["context"]["usagePercent"].intValue ?? 0
        )
    }
}

struct AssistantConversationState: Sendable {
    let activeID: String?
    let conversations: [AssistantConversationSummary]
    let activeTitle: String
    let messages: [AssistantMessage]
    let contextUsagePercent: Int

    static func parse(_ value: JSONValue) -> AssistantConversationState {
        let active = value["activeConversation"]
        let activeID = value.firstString("activeId").nilIfEmpty
            ?? active.firstString("id", "conversationId").nilIfEmpty
        return AssistantConversationState(
            activeID: activeID,
            conversations: value["conversations"].arrayValue.compactMap(AssistantConversationSummary.parse),
            activeTitle: active.firstString("title").fallback("新对话"),
            messages: active["messages"].arrayValue.enumerated().map { AssistantMessage.parse($0.element, index: $0.offset) },
            contextUsagePercent: active["context"]["usagePercent"].intValue ?? 0
        )
    }
}

struct AssistantModelSummary: Sendable {
    let providerName: String
    let modelName: String
    let hasAPIKey: Bool

    var displayName: String {
        if modelName.isEmpty { return providerName }
        return "\(providerName) · \(modelName)"
    }

    var isConfigured: Bool {
        hasAPIKey && !modelName.isEmpty
    }

    static func parse(_ value: JSONValue) -> AssistantModelSummary {
        AssistantModelSummary(
            providerName: value.firstString("providerName").fallback("默认提供商"),
            modelName: value.firstString("modelName"),
            hasAPIKey: value["hasApiKey"].boolValue ?? false
        )
    }
}

private enum AssistantDate {
    static func display(_ value: String) -> String {
        guard !value.isEmpty else { return "—" }
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let formatters = [fractional, ISO8601DateFormatter()]
        guard let date = formatters.lazy.compactMap({ $0.date(from: value) }).first else { return value }
        return date.formatted(date: .abbreviated, time: .shortened)
    }
}

private extension String {
    var nilIfEmpty: String? { isEmpty ? nil : self }

    func fallback(_ value: String) -> String {
        isEmpty ? value : self
    }
}
