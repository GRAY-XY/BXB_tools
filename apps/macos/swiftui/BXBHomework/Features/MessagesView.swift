import SwiftUI

struct MessagesView: View {
    @Environment(BackendConnectionModel.self) private var backend
    @State private var model = MessagesViewModel()
    @State private var showingLogin = false

    var body: some View {
        Group {
            if backend.session?.ready == true {
                threadLayout
            } else {
                loginRequired
            }
        }
        .navigationTitle("私信")
        .sheet(isPresented: $showingLogin) {
            LoginView()
                .environment(backend)
        }
        .sheet(isPresented: Binding(
            get: { model.isShowingConfirmation },
            set: { if !$0 { model.cancelSend() } }
        )) {
            if let contact = model.previewContact {
                SendConfirmationSheet(
                    contact: contact,
                    content: model.previewContent,
                    onConfirm: {
                        Task { await model.confirmSend(using: backend) }
                    },
                    onCancel: { model.cancelSend() }
                )
            }
        }
        .task(id: backend.session?.ready) {
            if backend.session?.ready == true {
                await model.loadContacts(using: backend)
            }
        }
        .onChange(of: model.selectedContactID) { _, _ in
            Task { await model.loadThread(using: backend) }
        }
    }

    // MARK: - 双栏布局：联系人 | 会话详情

    private var threadLayout: some View {
        @Bindable var model = model
        return HStack(spacing: 0) {
            ContactSidebar(model: model, backend: backend)
                .frame(width: 260)
            Divider()
            ThreadDetail(model: model, backend: backend, currentUserID: backend.session?.user?.id)
        }
    }

    private var loginRequired: some View {
        ContentUnavailableView {
            Label("需要登录办学帮", systemImage: "person.crop.circle.badge.exclamationmark")
        } description: {
            Text("登录后才能读取联系人与私信记录。")
        } actions: {
            Button("登录办学帮") { showingLogin = true }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

// MARK: - 联系人侧边栏

private struct ContactSidebar: View {
    @Bindable var model: MessagesViewModel
    let backend: BackendConnectionModel

    var body: some View {
        List(selection: Binding(
            get: { model.selectedContactID },
            set: { if let id = $0 { model.selectContact(id) } }
        )) {
            ForEach(model.filteredContacts) { contact in
                PrivateContactRow(contact: contact)
                    .tag(contact.id)
            }
        }
        .searchable(text: $model.searchText, placement: .sidebar, prompt: "搜索联系人")
        .listStyle(.sidebar)
        .overlay {
            if model.isLoadingContacts && model.contacts.isEmpty {
                ProgressView("同步联系人中...")
            } else if let error = model.contactsError, model.contacts.isEmpty {
                ContentUnavailableView {
                    Label("联系人加载失败", systemImage: "exclamationmark.triangle")
                } description: {
                    Text(error)
                } actions: {
                    Button("重试") { Task { await model.loadContacts(using: backend) } }
                }
            } else if model.contacts.isEmpty {
                ContentUnavailableView(
                    "暂无可私信的联系人",
                    systemImage: "person.slash",
                    description: Text("联系人列表为空。")
                )
            } else if model.filteredContacts.isEmpty {
                ContentUnavailableView.search(text: model.searchText)
            }
        }
    }
}

// MARK: - 联系人行

private struct PrivateContactRow: View {
    let contact: PrivateContact

    var body: some View {
        HStack(spacing: 10) {
            Circle()
                .fill(Color.accentColor.opacity(0.22))
                .frame(width: 34, height: 34)
                .overlay(
                    Text(String(contact.peerName.prefix(1)))
                        .font(.subheadline.bold())
                )

            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Text(contact.peerName)
                        .font(.system(size: 13, weight: .medium))
                        .lineLimit(1)
                    if contact.unreadCount > 0 {
                        Text("\(contact.unreadCount)")
                            .font(.system(size: 10, weight: .semibold))
                            .foregroundStyle(.white)
                            .padding(.horizontal, 5)
                            .padding(.vertical, 1)
                            .background(Capsule().fill(Color.red))
                    }
                }
                Text(contact.subtitle)
                    .font(.system(size: 11))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            Spacer(minLength: 0)
        }
        .padding(.vertical, 2)
    }
}

// MARK: - 会话详情

private struct ThreadDetail: View {
    @Bindable var model: MessagesViewModel
    let backend: BackendConnectionModel
    let currentUserID: String?

    var body: some View {
        VStack(spacing: 0) {
            if let contact = model.selectedContact {
                threadHeader(contact)
                Divider()
            }

            if case .error(let message) = model.phase, model.selectedContact != nil {
                ErrorBanner(message: message) {
                    Task { await model.retry(using: backend) }
                }
            }

            ZStack {
                if model.selectedContact == nil {
                    ContentUnavailableView(
                        "选择联系人",
                        systemImage: "bubble.left.and.bubble.right",
                        description: Text("从左侧选择一位联系人开始阅读私信。")
                    )
                } else {
                    switch model.phase {
                    case .loading:
                        ProgressView("同步消息记录中...")
                            .frame(maxWidth: .infinity, maxHeight: .infinity)
                    case .empty(let reason):
                        ContentUnavailableView(
                            "暂无消息",
                            systemImage: "bubble.left.and.bubble.right",
                            description: Text(reason)
                        )
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                    case .normal, .error:
                        messageScroll
                    }
                }
            }

            Divider()
            MessageComposer(model: model)
        }
        .background(Color(nsColor: .textBackgroundColor).opacity(0.25))
    }

    private func threadHeader(_ contact: PrivateContact) -> some View {
        HStack(spacing: 10) {
            VStack(alignment: .leading, spacing: 2) {
                Text(contact.peerName).font(.headline)
                if !contact.subtitle.isEmpty {
                    Text(contact.subtitle)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            Spacer()
            Button {
                Task { await model.loadThread(using: backend) }
            } label: {
                Label("刷新", systemImage: "arrow.clockwise")
            }
            .help("重新加载当前会话")
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
    }

    private var messageScroll: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(spacing: 12) {
                    ForEach(model.messages) { message in
                        MessageBubble(
                            message: message,
                            isCurrentUser: model.isCurrentUser(message, currentUserID: currentUserID)
                        )
                        .id(message.id)
                    }
                }
                .padding(16)
            }
            .textSelection(.enabled) // 阅读区严格只读：允许选择复制，不提供任何修改入口
            .onChange(of: model.messages.count) { _, _ in
                if let last = model.messages.last {
                    withAnimation { proxy.scrollTo(last.id, anchor: .bottom) }
                }
            }
        }
    }
}

// MARK: - 错误提示条

private struct ErrorBanner: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "exclamationmark.triangle.fill")
            Text(message).font(.caption).lineLimit(2)
            Spacer()
            Button("重试", action: onRetry)
                .buttonStyle(.borderedProminent)
                .controlSize(.small)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(Color.red.opacity(0.12))
        .foregroundStyle(.red)
    }
}

// MARK: - 消息气泡

private struct MessageBubble: View {
    let message: PrivateMessage
    let isCurrentUser: Bool

    var body: some View {
        HStack(alignment: .bottom, spacing: 8) {
            if isCurrentUser { Spacer(minLength: 48) }

            VStack(alignment: isCurrentUser ? .trailing : .leading, spacing: 4) {
                if !isCurrentUser && !message.senderName.isEmpty {
                    Text(message.senderName)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
                Text(message.isText ? message.content : message.placeholderText)
                    .font(.body)
                    .foregroundStyle(message.isText
                        ? (isCurrentUser ? Color.white : Color.primary)
                        : Color.secondary)
                    .textSelection(.enabled)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .background(
                        isCurrentUser
                            ? Color.accentColor
                            : Color(nsColor: .controlBackgroundColor)
                    )
                    .clipShape(RoundedRectangle(cornerRadius: 12))

                if let date = message.createdAt {
                    Text(date, style: .time)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
            }

            if !isCurrentUser { Spacer(minLength: 48) }
        }
    }
}

// MARK: - 底部编辑器

private struct MessageComposer: View {
    @Bindable var model: MessagesViewModel

    private var isEmpty: Bool {
        model.currentDraft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    var body: some View {
        VStack(alignment: .trailing, spacing: 8) {
            TextEditor(text: $model.currentDraft)
                .font(.body)
                .frame(height: 72)
                .scrollContentBackground(.hidden)
                .padding(8)
                .background(Color(nsColor: .textBackgroundColor))
                .clipShape(RoundedRectangle(cornerRadius: 8))
                .overlay(
                    RoundedRectangle(cornerRadius: 8)
                        .stroke(Color.secondary.opacity(0.2))
                )
                .disabled(model.selectedContact == nil)

            HStack {
                Text("\(model.currentDraft.count) 字符")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                Spacer()
                Button {
                    model.requestSendPreview()
                } label: {
                    if model.isSending {
                        ProgressView().controlSize(.small)
                    } else {
                        Label("预览并发送", systemImage: "paperplane")
                    }
                }
                .buttonStyle(.borderedProminent)
                .disabled(isEmpty || model.isSending || model.selectedContact == nil)
            }
        }
        .padding(12)
        .background(Color(nsColor: .windowBackgroundColor))
    }
}

// MARK: - 发送前二次确认弹窗（精确预览）

private struct SendConfirmationSheet: View {
    let contact: PrivateContact
    let content: String
    let onConfirm: () -> Void
    let onCancel: () -> Void

    private var recipientLine: String {
        if contact.subtitle.isEmpty {
            return "发送给：\(contact.peerName)"
        }
        return "发送给：\(contact.peerName)（\(contact.subtitle)）"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Image(systemName: "paperplane.fill")
                    .foregroundStyle(.tint)
                Text("确认发送私信")
                    .font(.headline)
            }

            Text(recipientLine)
                .font(.subheadline)
                .foregroundStyle(.secondary)

            Divider()

            Text("发送内容精确排版预览：")
                .font(.caption)
                .foregroundStyle(.secondary)

            ScrollView {
                Text(content)
                    .font(.body)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(10)
                    .background(Color(nsColor: .controlBackgroundColor))
                    .clipShape(RoundedRectangle(cornerRadius: 6))
            }
            .frame(maxHeight: 160)

            Label(
                "取消发送会完整保留草稿；发送只能由此确认窗口触发，不存在后台自动发送。",
                systemImage: "lock.shield"
            )
            .font(.caption2)
            .foregroundStyle(.secondary)

            HStack {
                Spacer()
                Button("取消（保留草稿）", action: onCancel)
                    .keyboardShortcut(.cancelAction)
                Button("确认发送", action: onConfirm)
                    .buttonStyle(.borderedProminent)
                    .keyboardShortcut(.defaultAction)
            }
        }
        .padding(20)
        .frame(width: 460)
    }
}
