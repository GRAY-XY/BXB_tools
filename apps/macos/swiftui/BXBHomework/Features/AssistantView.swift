import AppKit
import SwiftUI

private struct AssistantScrollMetrics: Equatable {
    let offset: CGFloat
    let viewportHeight: CGFloat
    let contentHeight: CGFloat

    var isNearBottom: Bool { offset + viewportHeight >= contentHeight - 70 }
}

struct AssistantView: View {
    @Environment(BackendConnectionModel.self) private var backend
    @State private var model = AssistantViewModel()
    @State private var showingImagePicker = false
    @State private var showingRenameAlert = false
    @State private var renameTargetID: String?
    @State private var renameTitle = ""
    @State private var showingDeleteConfirmation = false
    @State private var deleteTargetID: String?
    @State private var deleteTargetTitle = ""
    @State private var showingResetConfirmation = false
    @State private var shouldFollowLatest = true

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
        .sheet(isPresented: $showingImagePicker) {
            AssistantImagePicker(model: model)
                .environment(backend)
        }
        .alert("重命名对话", isPresented: $showingRenameAlert) {
            TextField("对话名称", text: $renameTitle)
            Button("保存") {
                if let renameTargetID {
                    Task { await model.renameConversation(renameTargetID, title: renameTitle, using: backend) }
                }
            }
            Button("取消", role: .cancel) {}
        } message: {
            Text("给这段对话取一个容易找到的名称。")
        }
        .confirmationDialog(
            "删除“\(deleteTargetTitle)”？",
            isPresented: $showingDeleteConfirmation,
            titleVisibility: .visible
        ) {
            Button("删除对话", role: .destructive) {
                if let deleteTargetID {
                    Task { await model.deleteConversation(deleteTargetID, using: backend) }
                }
            }
            Button("取消", role: .cancel) {}
        } message: {
            Text("这会永久删除本地对话记录。")
        }
        .confirmationDialog(
            "清空当前对话？",
            isPresented: $showingResetConfirmation,
            titleVisibility: .visible
        ) {
            Button("清空对话", role: .destructive) {
                Task { await model.resetConversation(using: backend) }
            }
            Button("取消", role: .cancel) {}
        } message: {
            Text("当前对话的消息和上下文会被清空，操作无法撤销。")
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
                .disabled(!model.canChangeConversation)
            }
            .padding(14)

            Divider()

            TextField("搜索对话", text: Binding(
                get: { model.conversationSearch },
                set: { model.conversationSearch = $0 }
            ))
            .textFieldStyle(.roundedBorder)
            .padding(10)

            if model.isLoading && model.conversations.isEmpty {
                ProgressView("正在读取对话…")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if model.filteredConversations.isEmpty {
                ContentUnavailableView(
                    model.conversationSearch.isEmpty ? "暂无对话" : "没有匹配的对话",
                    systemImage: "bubble.left.and.bubble.right",
                    description: Text(model.conversationSearch.isEmpty ? "新建一个本地对话开始使用助理。" : "试试其他关键词。")
                )
            } else {
                List(model.filteredConversations, selection: Binding(
                    get: { model.activeConversationID },
                    set: { id in
                        Task { await model.selectConversation(id, using: backend) }
                    }
                )) { conversation in
                    AssistantConversationRow(conversation: conversation)
                        .tag(conversation.id)
                        .contextMenu {
                            Button("重命名") { beginRename(conversation) }
                            Button("删除", role: .destructive) { beginDelete(conversation) }
                        }
                }
                .listStyle(.sidebar)
                .disabled(!model.canChangeConversation)
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
                Text("本地保存 · 上下文使用 \(model.contextUsagePercent)%")
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

            Menu {
                Button("重命名") {
                    if let conversation = model.conversations.first(where: { $0.id == model.activeConversationID }) {
                        beginRename(conversation)
                    }
                }
                Button("压缩上下文") {
                    Task { await model.compactConversation(using: backend) }
                }
                Divider()
                Button("清空消息", role: .destructive) { showingResetConfirmation = true }
                Button("删除对话", role: .destructive) {
                    if let conversation = model.conversations.first(where: { $0.id == model.activeConversationID }) {
                        beginDelete(conversation)
                    }
                }
            } label: {
                Image(systemName: "ellipsis.circle")
            }
            .disabled(!model.canChangeConversation || model.activeConversationID == nil)
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
                            AssistantMessageRow(message: message, workspaceDirectory: backend.appInfo?.workspaceDir)
                                .id(message.id)
                        }
                    }
                    Color.clear.frame(height: 1).id("assistant-bottom")
                }
                .padding(22)
                .frame(maxWidth: 900)
                .frame(maxWidth: .infinity)
            }
            .onScrollGeometryChange(for: AssistantScrollMetrics.self) { geometry in
                AssistantScrollMetrics(
                    offset: geometry.contentOffset.y,
                    viewportHeight: geometry.containerSize.height,
                    contentHeight: geometry.contentSize.height
                )
            } action: { old, new in
                if old.contentHeight != new.contentHeight && abs(old.offset - new.offset) < 1 && shouldFollowLatest {
                    return
                }
                shouldFollowLatest = new.isNearBottom
            }
            .onChange(of: model.messages.count) {
                if shouldFollowLatest {
                    proxy.scrollTo("assistant-bottom", anchor: .bottom)
                }
            }
            .onChange(of: model.messages.last?.text.count) {
                if shouldFollowLatest { proxy.scrollTo("assistant-bottom", anchor: .bottom) }
            }
            .onChange(of: model.messages.last?.steps.count) {
                if shouldFollowLatest { proxy.scrollTo("assistant-bottom", anchor: .bottom) }
            }
            .onChange(of: model.isSending) { _, sending in
                if sending {
                    shouldFollowLatest = true
                    proxy.scrollTo("assistant-bottom", anchor: .bottom)
                }
            }
            .onChange(of: model.activeConversationID) {
                shouldFollowLatest = true
                proxy.scrollTo("assistant-bottom", anchor: .bottom)
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
            if let notice = model.notice {
                Text(notice)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            if !model.selectedImages.isEmpty {
                ScrollView(.horizontal) {
                    HStack(spacing: 10) {
                        ForEach(model.selectedImages) { file in
                            HStack(spacing: 6) {
                                AssistantImageThumbnail(path: file.path, size: 42)
                                Text(file.name)
                                    .font(.caption)
                                    .lineLimit(1)
                                Button {
                                    model.removeImage(file.id)
                                } label: {
                                    Image(systemName: "xmark.circle.fill")
                                }
                                .buttonStyle(.plain)
                                .accessibilityLabel("移除 \(file.name)")
                            }
                            .padding(5)
                            .background(.background.secondary, in: RoundedRectangle(cornerRadius: 8))
                        }
                    }
                }
            }

            HStack(alignment: .bottom, spacing: 12) {
                Button {
                    showingImagePicker = true
                } label: {
                    Image(systemName: "photo.badge.plus")
                }
                .controlSize(.large)
                .help("从工作区选择图片")
                .disabled(model.isSending || model.selectedImages.count >= 8)

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
                    if model.isSending {
                        Task { await model.stop(using: backend) }
                    } else {
                        Task { await model.send(using: backend) }
                    }
                } label: {
                    if model.isSending {
                        Label(model.isStopping ? "停止中" : "停止", systemImage: "stop.fill")
                    } else {
                        Label("发送", systemImage: "paperplane.fill")
                    }
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
                .disabled(model.isSending ? model.isStopping : !model.canSend)
                .keyboardShortcut(.return, modifiers: .command)
            }

            Text("⌘↩ 发送 · 图片从本地工作区选择，最多 8 张。")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .padding(16)
    }

    private func beginRename(_ conversation: AssistantConversationSummary) {
        renameTargetID = conversation.id
        renameTitle = conversation.title
        showingRenameAlert = true
    }

    private func beginDelete(_ conversation: AssistantConversationSummary) {
        deleteTargetID = conversation.id
        deleteTargetTitle = conversation.title
        showingDeleteConfirmation = true
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
    let workspaceDirectory: String?
    @State private var showingSteps = true

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

                if !message.text.isEmpty {
                    Text(message.text)
                        .textSelection(.enabled)
                }

                if !message.attachments.isEmpty {
                    ForEach(message.attachments) { attachment in
                        HStack(spacing: 8) {
                            if let path = imagePath(for: attachment) {
                                AssistantImageThumbnail(path: path, size: 72)
                            } else {
                                Image(systemName: "photo")
                            }
                            Text(attachment.fileName)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                                .lineLimit(2)
                        }
                    }
                }

                if message.isRunning {
                    HStack(spacing: 8) {
                        ProgressView()
                            .controlSize(.small)
                        Text(message.text.isEmpty ? "正在生成回答…" : "正在继续生成…")
                            .foregroundStyle(.secondary)
                    }
                } else if message.status == "failed" || message.status == "interrupted" {
                    Label(message.status == "failed" ? "生成失败" : "上次生成已中断", systemImage: "exclamationmark.triangle")
                        .font(.caption)
                        .foregroundStyle(.orange)
                } else if message.status == "canceled" {
                    Label("已停止生成", systemImage: "stop.circle")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                } else if message.text.isEmpty && message.attachments.isEmpty {
                    Text("（无文本内容）")
                        .foregroundStyle(.secondary)
                }

                if !message.steps.isEmpty {
                    DisclosureGroup("执行过程（\(message.steps.count) 步）", isExpanded: $showingSteps) {
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

    private func imagePath(for attachment: AssistantAttachment) -> String? {
        guard let workspaceDirectory, !workspaceDirectory.isEmpty else { return nil }
        let root = URL(filePath: workspaceDirectory, directoryHint: .isDirectory)
            .standardizedFileURL.resolvingSymlinksInPath()
        let file = root.appending(path: attachment.relativePath)
            .standardizedFileURL.resolvingSymlinksInPath()
        let prefix = root.path.hasSuffix("/") ? root.path : root.path + "/"
        guard file.path.hasPrefix(prefix) else { return nil }
        return FileManager.default.fileExists(atPath: file.path) ? file.path : nil
    }
}

private struct AssistantImagePicker: View {
    @Environment(BackendConnectionModel.self) private var backend
    @Environment(\.dismiss) private var dismiss
    @Bindable var model: AssistantViewModel

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text("从工作区选择图片")
                    .font(.title3.bold())
                Spacer()
                Text("已选 \(model.selectedImages.count)/8")
                    .foregroundStyle(.secondary)
                Button("完成") { dismiss() }
                    .buttonStyle(.borderedProminent)
            }
            .padding(18)

            TextField("搜索图片", text: Binding(
                get: { model.imageSearch },
                set: { model.imageSearch = $0 }
            ))
            .textFieldStyle(.roundedBorder)
            .padding(.horizontal, 18)
            .padding(.bottom, 12)

            Divider()

            if model.isLoadingImages {
                ProgressView("正在读取工作区图片…")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if let imageError = model.imageError {
                ContentUnavailableView(
                    "无法读取工作区图片",
                    systemImage: "exclamationmark.triangle",
                    description: Text(imageError)
                )
            } else if model.filteredImages.isEmpty {
                ContentUnavailableView(
                    model.imageSearch.isEmpty ? "工作区里没有图片" : "没有匹配的图片",
                    systemImage: "photo",
                    description: Text("先把图片导入工作区，再从这里附加到消息。")
                )
            } else {
                ScrollView {
                    LazyVStack(spacing: 4) {
                        ForEach(model.filteredImages) { file in
                            HStack(spacing: 12) {
                                AssistantImageThumbnail(path: file.path, size: 56)
                                VStack(alignment: .leading, spacing: 4) {
                                    Text(file.name)
                                        .lineLimit(1)
                                    Text("\(file.relativePath) · \(file.formattedSize)")
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                        .lineLimit(1)
                                }
                                Spacer()
                                let selected = model.selectedImages.contains(where: { $0.id == file.id })
                                Button(selected ? "移除" : "添加") {
                                    if selected { model.removeImage(file.id) }
                                    else { model.addImage(file) }
                                }
                                .disabled(!selected && (model.selectedImages.count >= 8 || file.size > 25 * 1024 * 1024))
                            }
                            .padding(.horizontal, 16)
                            .padding(.vertical, 6)
                        }
                    }
                }
            }
        }
        .frame(width: 600, height: 520)
        .task { await model.loadWorkspaceImages(using: backend) }
    }
}

private struct AssistantImageThumbnail: View {
    let path: String
    let size: CGFloat

    var body: some View {
        Group {
            if let image = NSImage(contentsOfFile: path) {
                Image(nsImage: image)
                    .resizable()
                    .scaledToFill()
            } else {
                Image(systemName: "photo")
                    .resizable()
                    .scaledToFit()
                    .padding(10)
                    .foregroundStyle(.secondary)
            }
        }
        .frame(width: size, height: size)
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .background(.background.secondary, in: RoundedRectangle(cornerRadius: 8))
    }
}

#Preview {
    AssistantView()
        .environment(BackendConnectionModel())
        .frame(width: 1100, height: 720)
}
