import SwiftUI

struct AssistantView: View {
    @Environment(BackendConnectionModel.self) private var backend
    @State private var model = AssistantViewModel()

    var body: some View {
        @Bindable var model = model

        VStack(spacing: 0) {
            header
                .padding(.horizontal, 24)
                .padding(.vertical, 18)

            Divider()

            HSplitView {
                conversationSidebar
                    .frame(minWidth: 260, idealWidth: 310, maxWidth: 380)
                conversationPane
                    .frame(minWidth: 520, maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .navigationTitle("智能助理")
        .task {
            await model.load(using: backend)
        }
    }

    private var header: some View {
        HStack(spacing: 14) {
            Image(systemName: "sparkles")
                .font(.system(size: 25, weight: .medium))
                .foregroundStyle(.tint)
                .frame(width: 48, height: 48)
                .background(.tint.opacity(0.12), in: RoundedRectangle(cornerRadius: 12))
            VStack(alignment: .leading, spacing: 3) {
                Text("智能助理")
                    .font(.title2.bold())
                Text("围绕课程、作业和本地资料整理问题与草稿。")
                    .foregroundStyle(.secondary)
            }
            Spacer()
            modelBadge
        }
    }

    @ViewBuilder
    private var modelBadge: some View {
        if let summary = model.modelSummary {
            VStack(alignment: .trailing, spacing: 3) {
                Label(summary.displayName, systemImage: summary.isConfigured ? "checkmark.circle.fill" : "exclamationmark.circle")
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(summary.isConfigured ? Color.secondary : Color.orange)
                if !summary.isConfigured {
                    Text("需要在设置中配置模型")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
        } else {
            Text("模型配置未知")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }

    private var conversationSidebar: some View {
        VStack(spacing: 0) {
            HStack {
                Text("对话")
                    .font(.headline)
                Spacer()
                Button {
                    Task { await model.createConversation(using: backend) }
                } label: {
                    Label("新建", systemImage: "square.and.pencil")
                }
                .disabled(model.isCreating || model.isSending)
            }
            .padding(14)

            Divider()

            if model.isLoading && model.conversations.isEmpty {
                ProgressView("正在读取对话…")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if model.conversations.isEmpty {
                ContentUnavailableView(
                    "暂无对话",
                    systemImage: "bubble.left.and.bubble.right",
                    description: Text("新建一个本地对话开始使用助理。")
                )
            } else {
                List(model.conversations, selection: Binding(
                    get: { model.activeConversationID },
                    set: { id in
                        Task { await model.selectConversation(id, using: backend) }
                    }
                )) { conversation in
                    AssistantConversationRow(conversation: conversation)
                        .tag(conversation.id)
                }
                .listStyle(.sidebar)
            }
        }
    }

    private var conversationPane: some View {
        VStack(spacing: 0) {
            conversationTitleBar
            Divider()
            transcript
            Divider()
            composer
        }
    }

    private var conversationTitleBar: some View {
        HStack(spacing: 10) {
            VStack(alignment: .leading, spacing: 2) {
                Text(model.activeTitle)
                    .font(.headline)
                    .lineLimit(1)
                Text("本地保存 · 上下文使用 (model.contextUsagePercent)%")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            if model.isLoading {
                ProgressView()
                    .controlSize(.small)
            }
            Button {
                Task { await model.load(using: backend) }
            } label: {
                Label("刷新", systemImage: "arrow.clockwise")
            }
            .disabled(model.isLoading || model.isSending)
        }
        .padding(.horizontal, 18)
        .padding(.vertical, 11)
    }

    private var transcript: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(spacing: 18) {
                    if model.messages.isEmpty {
                        ContentUnavailableView(
                            "开始新对话",
                            systemImage: "sparkles",
                            description: Text("输入问题后，助理会在这里给出回答。")
                        )
                        .frame(minHeight: 320)
                    } else {
                        ForEach(model.messages) { message in
                            AssistantMessageRow(message: message)
                                .id(message.id)
                        }
                    }
                }
                .padding(22)
                .frame(maxWidth: 900)
                .frame(maxWidth: .infinity)
            }
            .onChange(of: model.messages.count) {
                if let id = model.messages.last?.id {
                    withAnimation { proxy.scrollTo(id, anchor: .bottom) }
                }
            }
        }
    }

    private var composer: some View {
        VStack(alignment: .leading, spacing: 9) {
            if let error = model.errorMessage {
                Label(error, systemImage: "exclamationmark.triangle.fill")
                    .font(.caption)
                    .foregroundStyle(.red)
                    .textSelection(.enabled)
            }

            HStack(alignment: .bottom, spacing: 12) {
                TextEditor(text: Binding(
                    get: { model.draftText },
                    set: { model.draftText = $0 }
                ))
                .font(.body)
                .scrollContentBackground(.hidden)
                .padding(8)
                .frame(minHeight: 72, maxHeight: 130)
                .background(.background.secondary, in: RoundedRectangle(cornerRadius: 10))
                .overlay {
                    RoundedRectangle(cornerRadius: 10)
                        .stroke(.separator, lineWidth: 1)
                }

                Button {
                    Task { await model.send(using: backend) }
                } label: {
                    if model.isSending {
                        ProgressView()
                            .controlSize(.small)
                            .frame(width: 58)
                    } else {
                        Label("发送", systemImage: "paperplane.fill")
                    }
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
                .disabled(!model.canSend)
                .keyboardShortcut(.return, modifiers: .command)
            }

            Text("⌘↩ 发送 · 当前版本等待完整回答后显示；实时过程与图片附件将在后续接入。")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .padding(16)
    }
}

private struct AssistantConversationRow: View {
    let conversation: AssistantConversationSummary

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(conversation.title)
                .fontWeight(.semibold)
                .lineLimit(2)
            HStack(spacing: 8) {
                Text("\(conversation.messageCount) 条消息")
                Spacer(minLength: 0)
                Text(conversation.updatedDisplay)
            }
            .font(.caption2)
            .foregroundStyle(.secondary)
            if conversation.contextUsagePercent > 0 {
                ProgressView(value: Double(conversation.contextUsagePercent), total: 100)
                    .controlSize(.mini)
            }
        }
        .padding(.vertical, 5)
    }
}

private struct AssistantMessageRow: View {
    let message: AssistantMessage

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            if message.isUser { Spacer(minLength: 70) }

            VStack(alignment: .leading, spacing: 8) {
                HStack(spacing: 6) {
                    Image(systemName: message.isUser ? "person.fill" : "sparkles")
                    Text(message.isUser ? "你" : "助理")
                        .fontWeight(.semibold)
                    Spacer(minLength: 8)
                    Text(message.timeDisplay)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }

                if message.isRunning {
                    HStack(spacing: 8) {
                        ProgressView()
                            .controlSize(.small)
                        Text("正在生成回答…")
                            .foregroundStyle(.secondary)
                    }
                } else {
                    Text(message.text.isEmpty ? "（无文本内容）" : message.text)
                        .textSelection(.enabled)
                }

                if !message.steps.isEmpty {
                    DisclosureGroup("执行过程（\(message.steps.count) 步）") {
                        VStack(alignment: .leading, spacing: 10) {
                            ForEach(message.steps) { step in
                                VStack(alignment: .leading, spacing: 3) {
                                    Label(step.title, systemImage: stepSymbol(step.kind))
                                        .font(.caption.weight(.semibold))
                                    if !step.detail.isEmpty {
                                        Text(step.detail)
                                            .font(.caption)
                                            .foregroundStyle(.secondary)
                                            .textSelection(.enabled)
                                    }
                                }
                            }
                        }
                        .padding(.top, 6)
                    }
                    .font(.caption)
                }
            }
            .padding(14)
            .background(
                message.isUser ? Color.accentColor.opacity(0.12) : Color.secondary.opacity(0.09),
                in: RoundedRectangle(cornerRadius: 14)
            )
            .frame(maxWidth: 680, alignment: .leading)

            if !message.isUser { Spacer(minLength: 70) }
        }
        .frame(maxWidth: .infinity)
    }

    private func stepSymbol(_ kind: String) -> String {
        switch kind {
        case "tool": "wrench.and.screwdriver"
        case "llm": "brain"
        case "done": "checkmark.circle"
        case "error": "exclamationmark.triangle"
        case "context": "text.badge.minus"
        default: "circle"
        }
    }
}

#Preview {
    AssistantView()
        .environment(BackendConnectionModel())
        .frame(width: 1100, height: 720)
}
