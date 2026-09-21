import Foundation
import Observation

@MainActor
@Observable
final class AssistantViewModel {
    private(set) var conversations: [AssistantConversationSummary] = []
    private(set) var messages: [AssistantMessage] = []
    private(set) var activeTitle = "新对话"
    private(set) var contextUsagePercent = 0
    private(set) var modelSummary: AssistantModelSummary?
    private(set) var isLoading = false
    private(set) var isSending = false
    private(set) var isCreating = false
    private(set) var errorMessage: String?

    var activeConversationID: String?
    var draftText = ""

    private var loadRequestID = UUID()

    var canSend: Bool {
        !draftText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !isSending
    }

    func load(using backend: BackendConnectionModel) async {
        let requestID = UUID()
        loadRequestID = requestID
        isLoading = true
        errorMessage = nil

        do {
            let value = try await backend.invoke("conversation.list")
            guard loadRequestID == requestID else { return }
            apply(AssistantConversationState.parse(value))
            isLoading = false
        } catch {
            guard loadRequestID == requestID else { return }
            isLoading = false
            errorMessage = error.localizedDescription
        }

        do {
            modelSummary = AssistantModelSummary.parse(try await backend.invoke("modelConfig.load"))
        } catch {
            modelSummary = nil
        }
    }

    func createConversation(using backend: BackendConnectionModel) async {
        guard !isCreating, !isSending else { return }
        isCreating = true
        errorMessage = nil
        defer { isCreating = false }

        do {
            let value = try await backend.invoke(
                "conversation.create",
                params: ["title": .string("新对话")]
            )
            apply(AssistantConversationState.parse(value))
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func selectConversation(_ id: String?, using backend: BackendConnectionModel) async {
        guard let id, id != activeConversationID, !isSending else { return }
        errorMessage = nil
        do {
            let value = try await backend.invoke(
                "conversation.select",
                params: ["conversationId": .string(id)]
            )
            apply(AssistantConversationState.parse(value))
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func send(using backend: BackendConnectionModel) async {
        let text = draftText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, !isSending else { return }

        if activeConversationID == nil {
            await createConversation(using: backend)
        }
        guard let conversationID = activeConversationID else {
            errorMessage = "无法创建本地对话。"
            return
        }

        let userMessageID = UUID().uuidString
        let assistantMessageID = UUID().uuidString
        draftText = ""
        errorMessage = nil
        isSending = true
        messages.append(.optimistic(id: userMessageID, role: "user", text: text))
        messages.append(.optimistic(id: assistantMessageID, role: "assistant", text: "", isRunning: true))

        do {
            _ = try await backend.invoke(
                "agent.chat",
                params: [
                    "text": .string(text),
                    "attachments": .array([]),
                    "conversationId": .string(conversationID),
                    "userMessageId": .string(userMessageID),
                    "assistantMessageId": .string(assistantMessageID),
                ]
            )
            let value = try await backend.invoke("conversation.list")
            apply(AssistantConversationState.parse(value))
        } catch {
            let failureMessage = error.localizedDescription
            messages.removeAll { $0.id == assistantMessageID }
            errorMessage = failureMessage
            if let value = try? await backend.invoke("conversation.list") {
                apply(AssistantConversationState.parse(value))
                errorMessage = failureMessage
            }
        }
        isSending = false
    }

    private func apply(_ state: AssistantConversationState) {
        conversations = state.conversations
        activeConversationID = state.activeID
        activeTitle = state.activeTitle
        messages = state.messages
        contextUsagePercent = state.contextUsagePercent
    }
}
