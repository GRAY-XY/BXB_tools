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
    private(set) var isChangingConversation = false
    private(set) var isSending = false
    private(set) var isStopping = false
    private(set) var isLoadingImages = false
    private(set) var workspaceImages: [WorkspaceFile] = []
    private(set) var selectedImages: [WorkspaceFile] = []
    private(set) var imageError: String?
    private(set) var errorMessage: String?
    private(set) var notice: String?

    var activeConversationID: String?
    var draftText = ""
    var conversationSearch = ""
    var imageSearch = ""

    private var loadRequestID = UUID()
    private var imageRequestID = UUID()
    private var runningMessageID: String?

    var filteredConversations: [AssistantConversationSummary] {
        let query = conversationSearch.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !query.isEmpty else { return conversations }
        return conversations.filter { $0.title.localizedCaseInsensitiveContains(query) }
    }

    var filteredImages: [WorkspaceFile] {
        let query = imageSearch.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !query.isEmpty else { return workspaceImages }
        return workspaceImages.filter {
            $0.name.localizedCaseInsensitiveContains(query)
                || $0.relativePath.localizedCaseInsensitiveContains(query)
        }
    }

    var canSend: Bool {
        (!draftText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !selectedImages.isEmpty)
            && !isSending && !isChangingConversation && !isLoading
    }

    var canChangeConversation: Bool { !isSending && !isChangingConversation && !isLoading }

    func load(using backend: BackendConnectionModel) async {
        guard !isSending, !isChangingConversation else { return }
        let requestID = UUID()
        loadRequestID = requestID
        let selection = activeConversationID
        isLoading = true
        errorMessage = nil

        do {
            var value = try await backend.invoke("conversation.list")
            var state = AssistantConversationState.parse(value)
            if let selection,
               selection != state.activeID,
               state.conversations.contains(where: { $0.id == selection }) {
                value = try await backend.invoke(
                    "conversation.select",
                    params: ["conversationId": .string(selection)]
                )
                state = AssistantConversationState.parse(value)
            }
            guard loadRequestID == requestID else { return }
            apply(state)
            isLoading = false
        } catch {
            guard loadRequestID == requestID else { return }
            isLoading = false
            errorMessage = error.localizedDescription
        }

        guard loadRequestID == requestID else { return }
        modelSummary = (try? await backend.invoke("modelConfig.load")).map(AssistantModelSummary.parse)
    }

    func createConversation(using backend: BackendConnectionModel) async {
        guard canChangeConversation else { return }
        await changeConversation(using: backend, method: "conversation.create", params: ["title": .string("新对话")])
    }

    func selectConversation(_ id: String?, using backend: BackendConnectionModel) async {
        guard let id, id != activeConversationID, canChangeConversation else { return }
        await changeConversation(
            using: backend,
            method: "conversation.select",
            params: ["conversationId": .string(id)]
        )
    }

    func renameConversation(_ id: String, title: String, using backend: BackendConnectionModel) async {
        let trimmed = String(title.trimmingCharacters(in: .whitespacesAndNewlines).prefix(80))
        guard !trimmed.isEmpty, canChangeConversation else {
            errorMessage = "对话名称不能为空。"
            return
        }
        await changeConversation(
            using: backend,
            method: "conversation.rename",
            params: ["conversationId": .string(id), "title": .string(trimmed)]
        )
    }

    func deleteConversation(_ id: String, using backend: BackendConnectionModel) async {
        guard canChangeConversation else { return }
        await changeConversation(
            using: backend,
            method: "conversation.delete",
            params: ["conversationId": .string(id)]
        )
    }

    func resetConversation(using backend: BackendConnectionModel) async {
        guard let id = activeConversationID, canChangeConversation else { return }
        isChangingConversation = true
        errorMessage = nil
        defer { isChangingConversation = false }
        do {
            _ = try await backend.invoke("agent.reset", params: ["conversationId": .string(id)])
            apply(AssistantConversationState.parse(try await backend.invoke("conversation.list")))
            notice = "对话内容已清空。"
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func compactConversation(using backend: BackendConnectionModel) async {
        guard let id = activeConversationID, canChangeConversation else { return }
        isChangingConversation = true
        errorMessage = nil
        defer { isChangingConversation = false }
        do {
            let result = try await backend.invoke("agent.compact", params: ["conversationId": .string(id)])
            apply(AssistantConversationState.parse(try await backend.invoke("conversation.list")))
            if result["changed"].boolValue == true {
                let before = result["beforeTokens"].intValue ?? 0
                let after = result["afterTokens"].intValue ?? 0
                notice = "上下文已压缩：\(before) → \(after) tokens。"
            } else {
                notice = "当前没有需要压缩的旧对话。"
            }
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func loadWorkspaceImages(using backend: BackendConnectionModel) async {
        let requestID = UUID()
        imageRequestID = requestID
        isLoadingImages = true
        imageError = nil
        do {
            let result = try await backend.callTool(
                "list_workspace_files",
                arguments: ["max_files": .number(500)],
                requiresSession: false
            )
            guard imageRequestID == requestID else { return }
            workspaceImages = WorkspaceFile.parseList(result).filter { $0.category == "image" }
            isLoadingImages = false
        } catch {
            guard imageRequestID == requestID else { return }
            workspaceImages = []
            isLoadingImages = false
            imageError = error.localizedDescription
        }
    }

    func addImage(_ file: WorkspaceFile) {
        guard !selectedImages.contains(where: { $0.id == file.id }) else { return }
        guard selectedImages.count < 8 else {
            errorMessage = "每条消息最多附带 8 张图片。"
            return
        }
        guard file.size <= 25 * 1024 * 1024 else {
            errorMessage = "图片不能超过 25 MB。"
            return
        }
        selectedImages.append(file)
        errorMessage = nil
    }

    func removeImage(_ id: String) {
        selectedImages.removeAll { $0.id == id }
    }

    func send(using backend: BackendConnectionModel) async {
        guard canSend else { return }
        let text = draftText.trimmingCharacters(in: .whitespacesAndNewlines)
        let images = selectedImages
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
        selectedImages = []
        errorMessage = nil
        notice = nil
        isSending = true
        runningMessageID = assistantMessageID
        messages.append(.optimistic(
            id: userMessageID,
            role: "user",
            text: text,
            attachments: images.map {
                AssistantAttachment(fileName: $0.name, relativePath: $0.relativePath, mimeType: "", sizeBytes: $0.size)
            }
        ))
        messages.append(.optimistic(id: assistantMessageID, role: "assistant", text: "", isRunning: true))

        var finalResult: JSONValue?
        do {
            let stream = try await backend.stream(
                "agent.chat",
                params: [
                    "text": .string(text),
                    "attachments": .array(images.map { .object([
                        "path": .string($0.path),
                        "relativePath": .string($0.relativePath),
                        "name": .string($0.name),
                    ]) }),
                    "conversationId": .string(conversationID),
                    "userMessageId": .string(userMessageID),
                    "assistantMessageId": .string(assistantMessageID),
                ]
            )
            for try await event in stream {
                switch event {
                case .progress(let value):
                    if let progress = AssistantProgress.parse(value) {
                        applyProgress(progress, conversationID: conversationID, messageID: assistantMessageID)
                    }
                case .result(let value):
                    finalResult = value
                }
            }
        } catch {
            errorMessage = error.localizedDescription
        }

        if let value = try? await backend.invoke("conversation.list") {
            let state = AssistantConversationState.parse(value)
            if errorMessage != nil, !state.messages.contains(where: { $0.id == userMessageID }) {
                draftText = draftText.isEmpty ? text : [text, draftText].filter { !$0.isEmpty }.joined(separator: "\n\n")
                selectedImages = images + selectedImages.filter { selected in
                    !images.contains(where: { $0.id == selected.id })
                }
            }
            apply(state)
        } else if let index = messages.firstIndex(where: { $0.id == assistantMessageID }) {
            messages[index].isRunning = false
            if let finalResult {
                let completedText = finalResult.firstString("message")
                if !completedText.isEmpty { messages[index].text = completedText }
                messages[index].steps = finalResult["steps"].arrayValue.enumerated().map {
                    AssistantStep.parse($0.element, index: $0.offset)
                }
                messages[index].status = finalResult["canceled"].boolValue == true ? "canceled" : "completed"
            } else {
                messages[index].status = "failed"
                if messages[index].text.isEmpty {
                    messages[index].text = errorMessage ?? "请求中断，刷新对话以查看保存的结果。"
                }
            }
        }
        runningMessageID = nil
        isStopping = false
        isSending = false
    }

    func stop(using backend: BackendConnectionModel) async {
        guard isSending, !isStopping,
              let conversationID = activeConversationID,
              let runningMessageID else { return }
        isStopping = true
        do {
            let result = try await backend.invoke(
                "agent.cancel",
                params: [
                    "conversationId": .string(conversationID),
                    "assistantMessageId": .string(runningMessageID),
                ]
            )
            if result["cancellationRequested"].boolValue != true {
                isStopping = false
            }
        } catch {
            isStopping = false
            errorMessage = error.localizedDescription
        }
    }

    private func changeConversation(
        using backend: BackendConnectionModel,
        method: String,
        params: [String: JSONValue]
    ) async {
        loadRequestID = UUID()
        isChangingConversation = true
        errorMessage = nil
        notice = nil
        defer { isChangingConversation = false }
        do {
            let value = try await backend.invoke(method, params: params)
            apply(AssistantConversationState.parse(value))
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func applyProgress(_ progress: AssistantProgress, conversationID: String, messageID: String) {
        guard progress.conversationID == conversationID,
              progress.messageID == messageID,
              activeConversationID == conversationID,
              let index = messages.firstIndex(where: { $0.id == messageID }) else { return }
        messages[index].apply(progress)
    }

    private func apply(_ state: AssistantConversationState) {
        conversations = state.conversations
        activeConversationID = state.activeID
        activeTitle = state.activeTitle
        messages = state.messages
        contextUsagePercent = state.contextUsagePercent
    }
}
