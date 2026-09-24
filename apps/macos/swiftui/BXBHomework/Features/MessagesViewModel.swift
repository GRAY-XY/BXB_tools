import Foundation
import Observation

@MainActor
@Observable
final class MessagesViewModel {
    // MARK: - 联系人列表

    private(set) var contacts: [PrivateContact] = []
    private(set) var isLoadingContacts = false
    private(set) var contactsError: String?
    var searchText = ""

    // MARK: - 当前会话

    private(set) var selectedContactID: String?
    private(set) var messages: [PrivateMessage] = []
    private(set) var phase: MessagesPhase = .normal

    /// 快速切换联系人时，丢弃过期的线程响应，避免覆盖当前选择
    private var threadRequestID = UUID()

    // MARK: - 草稿保护（按联系人隔离，切换不丢，取消/失败不丢）

    var currentDraft = ""
    private var drafts: [String: String] = [:]

    // MARK: - 发送二次确认

    var isShowingConfirmation = false
    private(set) var isSending = false
    private(set) var previewContact: PrivateContact?
    private(set) var previewContent = ""

    // MARK: - 派生状态

    var filteredContacts: [PrivateContact] {
        let trimmed = searchText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return contacts }
        return contacts.filter { contact in
            contact.peerName.localizedCaseInsensitiveContains(trimmed)
                || (contact.courseName?.localizedCaseInsensitiveContains(trimmed) ?? false)
                || (contact.className?.localizedCaseInsensitiveContains(trimmed) ?? false)
        }
    }

    var selectedContact: PrivateContact? {
        guard let selectedContactID else { return nil }
        return contacts.first { $0.id == selectedContactID }
    }

    /// 判断消息是否来自当前登录学生（优先与 session 用户 ID 比对，其次按学生身份类型判断）
    func isCurrentUser(_ message: PrivateMessage, currentUserID: String?) -> Bool {
        if let currentUserID, !currentUserID.isEmpty {
            return message.senderType == "S" && message.senderId == currentUserID
        }
        return message.senderType == "S"
    }

    // MARK: - 联系人加载

    func loadContacts(using backend: BackendConnectionModel) async {
        guard backend.session?.ready == true else {
            contacts = []
            selectedContactID = nil
            return
        }
        isLoadingContacts = true
        contactsError = nil
        do {
            let result = try await backend.callTool("list_private_message_contacts")
            contacts = PrivateContact.parseList(result)
            isLoadingContacts = false

            // 保持已有选择；首次进入自动选中第一个联系人。
            // 首次选中由视图层 onChange(of: selectedContactID) 触发线程加载；
            // 选择保持不变时（如重试联系人列表）在此手动刷新线程。
            if let current = selectedContactID, contacts.contains(where: { $0.id == current }) {
                await loadThread(using: backend)
            } else if let first = contacts.first {
                selectContact(first.id)
            } else {
                selectedContactID = nil
                messages = []
                phase = .empty(reason: "暂无可私信的联系人")
            }
        } catch {
            isLoadingContacts = false
            contactsError = error.localizedDescription
            phase = .error(message: error.localizedDescription)
        }
    }

    // MARK: - 会话切换

    func selectContact(_ contactID: String) {
        guard contactID != selectedContactID else { return }
        if let previousID = selectedContactID {
            drafts[previousID] = currentDraft
        }
        selectedContactID = contactID
        currentDraft = drafts[contactID] ?? ""
    }

    // MARK: - 历史消息加载（严格只读）

    func loadThread(using backend: BackendConnectionModel) async {
        guard let contact = selectedContact else {
            messages = []
            phase = .normal
            return
        }
        let requestID = UUID()
        threadRequestID = requestID
        phase = .loading
        do {
            let result = try await backend.callTool(
                "get_private_message_thread",
                arguments: [
                    "contact": contact.raw,
                    "size": .number(50),
                ]
            )
            // 切换联系人后丢弃过期响应，保证当前选择不被旧数据覆盖
            guard threadRequestID == requestID else { return }
            messages = PrivateMessage.parseList(result)
            phase = messages.isEmpty ? .empty(reason: "暂无消息记录") : .normal
        } catch {
            guard threadRequestID == requestID else { return }
            phase = .error(message: error.localizedDescription)
        }
    }

    // MARK: - 发送流程（预览 → 二次确认 → 发送；绝无自动发送）

    /// 第一步：唤起精确排版预览与二次确认弹窗，本身不发送任何内容
    func requestSendPreview() {
        let trimmed = currentDraft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, let contact = selectedContact else { return }
        previewContact = contact
        previewContent = trimmed
        isShowingConfirmation = true
    }

    /// 取消发送：仅关闭弹窗，草稿完整保留
    func cancelSend() {
        isShowingConfirmation = false
        previewContact = nil
        previewContent = ""
    }

    /// 第二步：用户在弹窗中显式确认后才真正发送
    func confirmSend(using backend: BackendConnectionModel) async {
        guard let contact = previewContact, !isSending else { return }
        let targetContactID = contact.id
        let textToSend = previewContent
        isShowingConfirmation = false
        previewContact = nil
        previewContent = ""
        isSending = true
        defer { isSending = false }

        do {
            _ = try await backend.callTool(
                "send_private_message_text",
                arguments: [
                    "contact": contact.raw,
                    "content": .string(textToSend),
                ]
            )
            // 仅发送成功后才清草稿（按目标联系人精确清除）
            drafts.removeValue(forKey: targetContactID)

            // 发送请求期间用户可能已切换到其他会话：
            // 只有仍停留在目标会话时才清空输入框并刷新该线程，
            // 避免误清新会话草稿；切回目标会话时 onChange 会自动加载最新消息。
            if selectedContactID == targetContactID {
                currentDraft = ""
                await loadThread(using: backend)
            }
        } catch {
            // 发送失败：草稿继续保留（取消时也未清），仅当仍在目标会话时展示错误
            if selectedContactID == targetContactID {
                phase = .error(message: error.localizedDescription)
            }
        }
    }

    /// 错误重试：重新加载当前线程（不会自动重发消息）
    func retry(using backend: BackendConnectionModel) async {
        if contactsError != nil {
            await loadContacts(using: backend)
        } else {
            await loadThread(using: backend)
        }
    }
}
