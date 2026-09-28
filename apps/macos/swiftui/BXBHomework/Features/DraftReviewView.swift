import SwiftUI

struct DraftReviewView: View {
    @Environment(BackendConnectionModel.self) private var backend
    @State private var model = DraftViewModel()
    @State private var showingApproveConfirmation = false
    @State private var showingRejectConfirmation = false

    var body: some View {
        @Bindable var model = model

        VStack(spacing: 0) {
            header
                .padding(.horizontal, 24)
                .padding(.vertical, 18)

            Divider()

            controls
                .padding(.horizontal, 20)
                .padding(.vertical, 12)

            Divider()

            HSplitView {
                draftList
                    .frame(minWidth: 300, idealWidth: 360, maxWidth: 460)
                detailPane
                    .frame(minWidth: 480, maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .navigationTitle("草稿审核")
        .task {
            await model.loadDrafts(using: backend)
        }
        .onChange(of: model.selectedFilter) {
            Task { await model.loadDrafts(using: backend) }
        }
        .onChange(of: model.selectedDraftID) {
            Task { await model.loadSelectedDraft(using: backend) }
        }
        .confirmationDialog(
            "确认通过这份草稿？",
            isPresented: $showingApproveConfirmation,
            titleVisibility: .visible
        ) {
            Button("通过审核") {
                Task { await model.approve(using: backend) }
            }
            Button("取消", role: .cancel) {}
        } message: {
            Text("这只会修改本地审核状态，不会提交作业或发送私信。")
        }
        .confirmationDialog(
            "确认驳回这份草稿？",
            isPresented: $showingRejectConfirmation,
            titleVisibility: .visible
        ) {
            Button("驳回草稿", role: .destructive) {
                Task { await model.reject(using: backend) }
            }
            Button("取消", role: .cancel) {}
        } message: {
            Text("驳回只影响本地草稿；不会删除草稿或影响办学帮。")
        }
    }

    private var header: some View {
        HStack(spacing: 14) {
            Image(systemName: "doc.text.magnifyingglass")
                .font(.system(size: 25, weight: .medium))
                .foregroundStyle(.tint)
                .frame(width: 48, height: 48)
                .background(.tint.opacity(0.12), in: RoundedRectangle(cornerRadius: 12))
            VStack(alignment: .leading, spacing: 3) {
                Text("草稿审核")
                    .font(.title2.bold())
                Text("查看和修改本地草稿，并在任何真实提交动作之前完成审核。")
                    .foregroundStyle(.secondary)
            }
            Spacer()
        }
    }

    private var controls: some View {
        HStack(spacing: 12) {
            Picker("状态", selection: Binding(
                get: { model.selectedFilter },
                set: { model.selectedFilter = $0 }
            )) {
                ForEach(DraftFilter.allCases) { filter in
                    Text(filter.title).tag(filter)
                }
            }
            .frame(width: 210)

            if model.isLoadingList {
                ProgressView()
                    .controlSize(.small)
            }

            Spacer()

            Text("所有数据均保存在本机")
                .font(.caption)
                .foregroundStyle(.secondary)

            Button {
                Task { await model.loadDrafts(using: backend) }
            } label: {
                Label("刷新", systemImage: "arrow.clockwise")
            }
            .disabled(model.isLoadingList)
        }
    }

    private var draftList: some View {
        VStack(spacing: 0) {
            HStack {
                Text("草稿")
                    .font(.headline)
                Spacer()
                Text("\(model.drafts.count) 项")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)

            Divider()

            if model.isLoadingList && model.drafts.isEmpty {
                ProgressView("正在读取草稿…")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if let error = model.listError {
                ContentUnavailableView(
                    "无法读取草稿",
                    systemImage: "exclamationmark.triangle",
                    description: Text(error)
                )
            } else if model.drafts.isEmpty {
                ContentUnavailableView(
                    "暂无草稿",
                    systemImage: "doc",
                    description: Text("当前筛选条件下没有本地草稿。")
                )
            } else {
                List(model.drafts, selection: Binding(
                    get: { model.selectedDraftID },
                    set: { model.selectedDraftID = $0 }
                )) { draft in
                    DraftSummaryRow(draft: draft)
                        .tag(draft.id)
                }
                .listStyle(.sidebar)
            }
        }
    }

    @ViewBuilder
    private var detailPane: some View {
        if model.isLoadingDetail {
            ProgressView("正在读取草稿…")
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if let detail = model.detail {
            DraftDetailView(
                detail: detail,
                editableText: Binding(
                    get: { model.editableText },
                    set: { model.editableText = $0 }
                ),
                editableSummary: Binding(
                    get: { model.editableSummary },
                    set: { model.editableSummary = $0 }
                ),
                hasUnsavedChanges: model.hasUnsavedChanges,
                isPerformingAction: model.isPerformingAction,
                actionMessage: model.actionMessage,
                errorMessage: model.detailError,
                onSave: { Task { await model.save(using: backend) } },
                onApprove: { showingApproveConfirmation = true },
                onReject: { showingRejectConfirmation = true },
                submissionPreview: model.submissionPreview,
                canPrepareSubmission: model.canPrepareSubmission,
                onPrepareSubmission: { Task { await model.prepareSubmission(using: backend) } },
                onCancelSubmission: model.cancelSubmissionPreview,
                onSubmit: { Task { await model.submitPreparedDraft(using: backend) } },
                privateMessagePreview: model.privateMessagePreview,
                selectedPrivateMessageContactKey: model.selectedPrivateMessageContactKey,
                canPreparePrivateMessage: model.canPreparePrivateMessage,
                onPreparePrivateMessage: { Task { await model.preparePrivateMessage(using: backend) } },
                onSelectPrivateMessageContact: { key in
                    Task { await model.selectPrivateMessageContact(key, using: backend) }
                },
                onCancelPrivateMessage: model.cancelPrivateMessagePreview,
                onSendPrivateMessage: { Task { await model.sendPreparedPrivateMessage(using: backend) } }
            )
        } else if let error = model.detailError {
            ContentUnavailableView(
                "无法读取草稿",
                systemImage: "exclamationmark.triangle",
                description: Text(error)
            )
        } else {
            ContentUnavailableView(
                "选择一份草稿",
                systemImage: "doc.text.magnifyingglass",
                description: Text("从左侧列表选择草稿以审核正文。")
            )
        }
    }
}

private struct DraftSummaryRow: View {
    let draft: SubmissionDraftSummary

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(draft.taskTitle)
                .fontWeight(.semibold)
                .lineLimit(2)
            if !draft.subjectName.isEmpty {
                Text(draft.subjectName)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            HStack(spacing: 8) {
                Label(draft.statusLabel, systemImage: draft.statusSymbol)
                Spacer(minLength: 0)
                Text(draft.createdDisplay)
            }
            .font(.caption2)
            .foregroundStyle(.secondary)

            if draft.warningCount > 0 || draft.missingInfoCount > 0 || draft.needsUserInput {
                HStack(spacing: 8) {
                    if draft.warningCount > 0 {
                        Label("\(draft.warningCount) 条警告", systemImage: "exclamationmark.triangle")
                    }
                    if draft.missingInfoCount > 0 {
                        Label("缺 \(draft.missingInfoCount) 项", systemImage: "questionmark.circle")
                    }
                }
                .font(.caption2)
                .foregroundStyle(.orange)
            }
            if ["unknown", "in_flight"].contains(draft.deliveryAttemptStatus)
                || ["unknown", "in_flight", "ready"].contains(draft.teacherMessageAttemptStatus)
                || (draft.teacherMessageAttemptStatus == "failed" && draft.teacherMessageConfirmedCount > 0) {
                Label("交付进度待核对", systemImage: "exclamationmark.triangle.fill")
                    .font(.caption2)
                    .foregroundStyle(.orange)
            }
        }
        .padding(.vertical, 5)
    }
}

private struct DraftDetailView: View {
    let detail: SubmissionDraftDetail
    @Binding var editableText: String
    @Binding var editableSummary: String
    let hasUnsavedChanges: Bool
    let isPerformingAction: Bool
    let actionMessage: String?
    let errorMessage: String?
    let onSave: () -> Void
    let onApprove: () -> Void
    let onReject: () -> Void
    let submissionPreview: DraftSubmissionPreview?
    let canPrepareSubmission: Bool
    let onPrepareSubmission: () -> Void
    let onCancelSubmission: () -> Void
    let onSubmit: () -> Void
    let privateMessagePreview: DraftPrivateMessagePreview?
    let selectedPrivateMessageContactKey: String?
    let canPreparePrivateMessage: Bool
    let onPreparePrivateMessage: () -> Void
    let onSelectPrivateMessageContact: (String) -> Void
    let onCancelPrivateMessage: () -> Void
    let onSendPrivateMessage: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            ScrollView {
                if let submissionPreview {
                    submissionPreviewSection(submissionPreview)
                        .padding(20)
                        .frame(maxWidth: 860, alignment: .leading)
                } else if let privateMessagePreview {
                    privateMessagePreviewSection(privateMessagePreview)
                        .padding(20)
                        .frame(maxWidth: 860, alignment: .leading)
                } else {
                    VStack(alignment: .leading, spacing: 16) {
                        titleSection
                        metadataSection
                        reviewSignals
                        deliveryHistorySection
                        editorSection
                    }
                    .padding(20)
                    .frame(maxWidth: 860, alignment: .leading)
                }
            }

            Divider()
            actionBar
        }
    }

    private var titleSection: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text(detail.taskTitle)
                        .font(.title2.bold())
                        .textSelection(.enabled)
                    Text(detail.subjectName.isEmpty ? "未知课程" : detail.subjectName)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                Label(detail.statusLabel, systemImage: detail.statusSymbol)
                    .font(.headline)
            }

            if detail.isFinal {
                Label("这份草稿已交付，不能再编辑或审核。", systemImage: "lock.fill")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            } else if detail.hasUnresolvedDelivery {
                Label("交付仍有未核对或已部分送达的内容；正文已锁定，避免修改后重发造成重复。", systemImage: "exclamationmark.triangle.fill")
                    .font(.caption)
                    .foregroundStyle(.orange)
            } else {
                Label("通过审核不会自动提交作业或发送私信。", systemImage: "hand.raised.fill")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }

    private var metadataSection: some View {
        GroupBox("基本信息") {
            Grid(alignment: .leading, horizontalSpacing: 18, verticalSpacing: 8) {
                metadataRow("Task ID", detail.taskID)
                metadataRow("草稿 ID", detail.id)
                metadataRow("创建时间", detail.createdDisplay)
                metadataRow("更新时间", detail.updatedDisplay)
                metadataRow("审核时间", detail.reviewedDisplay)
                metadataRow("拟交付方式", detail.deliveryTargetLabel)
                if !detail.reviewNote.isEmpty {
                    metadataRow("审核备注", detail.reviewNote)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.vertical, 5)
        }
    }

    @ViewBuilder
    private var reviewSignals: some View {
        if detail.needsUserInput || !detail.missingInfo.isEmpty || !detail.warnings.isEmpty {
            GroupBox("审核提示") {
                VStack(alignment: .leading, spacing: 10) {
                    if detail.needsUserInput {
                        Label("这份草稿仍需要用户补充信息。", systemImage: "person.crop.circle.badge.questionmark")
                            .foregroundStyle(.orange)
                    }
                    ForEach(detail.missingInfo, id: \.self) { item in
                        Label(item, systemImage: "questionmark.circle")
                    }
                    ForEach(detail.warnings, id: \.self) { item in
                        Label(item, systemImage: "exclamationmark.triangle")
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.vertical, 5)
            }
        }
    }

    private var editorSection: some View {
        GroupBox("草稿正文") {
            VStack(alignment: .leading, spacing: 10) {
                TextField("摘要（可选）", text: $editableSummary)
                    .textFieldStyle(.roundedBorder)
                    .disabled(!detail.canEdit || isPerformingAction)

                TextEditor(text: $editableText)
                    .font(.body)
                    .scrollContentBackground(.hidden)
                    .padding(8)
                    .frame(minHeight: 280)
                    .background(.background, in: RoundedRectangle(cornerRadius: 8))
                    .overlay {
                        RoundedRectangle(cornerRadius: 8)
                            .stroke(.separator, lineWidth: 1)
                    }
                    .disabled(!detail.canEdit || isPerformingAction)

                Text("正文必须保持纯文本。保存修改后状态会回到“待审核”。")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            .padding(.vertical, 5)
        }
    }

    @ViewBuilder
    private var deliveryHistorySection: some View {
        if !detail.deliveryHistory.isEmpty {
            GroupBox("交付记录") {
                VStack(alignment: .leading, spacing: 10) {
                    ForEach(detail.deliveryHistory) { entry in
                        VStack(alignment: .leading, spacing: 4) {
                            Label(entry.title, systemImage: entry.status == "success" ? "checkmark.circle" : "exclamationmark.triangle")
                                .fontWeight(.medium)
                                .foregroundStyle(entry.status == "success" ? Color.primary : Color.orange)
                            if !entry.modeLabel.isEmpty {
                                Text("方式：\(entry.modeLabel)")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                            if !entry.contactName.isEmpty {
                                Text("联系人：\(entry.contactName)")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                            if !entry.progress.isEmpty {
                                Text(entry.progress)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                            if !entry.submissionID.isEmpty {
                                Text("提交记录：\(entry.submissionID)")
                                    .font(.caption)
                                    .textSelection(.enabled)
                            }
                            if !entry.occurredAt.isEmpty {
                                Text(entry.occurredAt)
                                    .font(.caption2)
                                    .foregroundStyle(.secondary)
                            }
                            if !entry.error.isEmpty {
                                Text(entry.error)
                                    .font(.caption)
                                    .foregroundStyle(.red)
                                    .textSelection(.enabled)
                            }
                        }
                        if entry.id != detail.deliveryHistory.last?.id {
                            Divider()
                        }
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.vertical, 5)
            }
        }
    }

    private func submissionPreviewSection(_ preview: DraftSubmissionPreview) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            VStack(alignment: .leading, spacing: 5) {
                Text("提交前核对")
                    .font(.title2.bold())
                Text("请确认以下内容与目标作业一致。只有点击“确认并提交”后才会执行真实提交。")
                    .foregroundStyle(.secondary)
            }

            GroupBox("提交目标") {
                Grid(alignment: .leading, horizontalSpacing: 18, verticalSpacing: 8) {
                    metadataRow("课程", preview.subjectName)
                    metadataRow("作业", preview.taskTitle)
                    metadataRow("Task ID", preview.taskID)
                    metadataRow("目标", preview.destination)
                    metadataRow("方式", preview.modeLabel)
                    if !preview.submissionID.isEmpty {
                        metadataRow("现有提交记录", preview.submissionID)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.vertical, 5)
            }

            GroupBox("将提交的完整正文") {
                Text(preview.draftText.isEmpty ? "（空正文）" : preview.draftText)
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.vertical, 6)
            }

            GroupBox("保留的现有附件") {
                if preview.retainedAttachments.isEmpty {
                    Text("没有保留的附件。")
                        .foregroundStyle(.secondary)
                        .frame(maxWidth: .infinity, alignment: .leading)
                } else {
                    VStack(alignment: .leading, spacing: 7) {
                        ForEach(preview.retainedAttachments) { attachment in
                            HStack {
                                Label(attachment.fileName, systemImage: "paperclip")
                                Spacer()
                                if !attachment.fileSize.isEmpty {
                                    Text("\(attachment.fileSize) bytes")
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                            }
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            }

            if !preview.note.isEmpty {
                Label(preview.note, systemImage: "info.circle")
                    .foregroundStyle(.orange)
            }
            if !preview.canSubmit {
                Label(preview.reason.isEmpty ? "当前无法安全提交。" : preview.reason, systemImage: "exclamationmark.triangle.fill")
                    .foregroundStyle(.red)
                    .textSelection(.enabled)
            }
        }
    }

    private func privateMessagePreviewSection(_ preview: DraftPrivateMessagePreview) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            VStack(alignment: .leading, spacing: 5) {
                Text("私信发送前核对")
                    .font(.title2.bold())
                Text("先选定老师并检查所有消息分段。只有点击“确认并发送”后才会发送；续发只发送尚未确认的分段。")
                    .foregroundStyle(.secondary)
            }

            GroupBox("发送目标") {
                Grid(alignment: .leading, horizontalSpacing: 18, verticalSpacing: 8) {
                    metadataRow("课程", preview.subjectName)
                    metadataRow("作业", preview.taskTitle)
                    metadataRow("Task ID", preview.taskID)
                    metadataRow("目标", preview.destination)
                    if let selectedContact = preview.selectedContact {
                        metadataRow("联系人", selectedContact.peerName)
                        metadataRow("班级", selectedContact.className)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.vertical, 5)
            }

            GroupBox("选择已有联系人") {
                if preview.contacts.isEmpty {
                    Label("当前伴学邦账号没有可用的私信联系人。", systemImage: "person.crop.circle.badge.exclamationmark")
                        .foregroundStyle(.secondary)
                        .frame(maxWidth: .infinity, alignment: .leading)
                } else {
                    Picker("老师联系人", selection: Binding(
                        get: { selectedPrivateMessageContactKey ?? preview.selectedContact?.contactKey ?? "" },
                        set: onSelectPrivateMessageContact
                    )) {
                        Text("选择联系人…").tag("")
                        ForEach(preview.contacts) { contact in
                            Text(contact.pickerLabel).tag(contact.contactKey)
                        }
                    }
                    .frame(maxWidth: 520, alignment: .leading)
                }
            }

            if preview.confirmedChunkCount > 0 {
                Label(
                    "已确认发送 \(preview.confirmedChunkCount) 段；接下来从第 \(preview.nextChunkIndex + 1) 段继续。",
                    systemImage: "arrowshape.turn.up.right.circle"
                )
                .foregroundStyle(.orange)
            }

            GroupBox("完整私信正文（按发送分段）") {
                if preview.chunks.isEmpty {
                    Text("没有可发送的消息正文。")
                        .foregroundStyle(.secondary)
                        .frame(maxWidth: .infinity, alignment: .leading)
                } else {
                    VStack(alignment: .leading, spacing: 12) {
                        ForEach(preview.chunks) { chunk in
                            VStack(alignment: .leading, spacing: 6) {
                                HStack {
                                    Text("第 \(chunk.index)/\(chunk.total) 段")
                                        .fontWeight(.semibold)
                                    if chunk.index <= preview.confirmedChunkCount {
                                        Label("已确认发送", systemImage: "checkmark.circle.fill")
                                            .font(.caption)
                                            .foregroundStyle(.green)
                                    }
                                    Spacer()
                                    Text("\(chunk.length) 字")
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                                Text(chunk.text)
                                    .textSelection(.enabled)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                    .padding(10)
                                    .background(.quaternary.opacity(0.35), in: RoundedRectangle(cornerRadius: 8))
                            }
                            if chunk.id != preview.chunks.last?.id {
                                Divider()
                            }
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.vertical, 5)
                }
            }

            if !preview.note.isEmpty {
                Label(preview.note, systemImage: "info.circle")
                    .foregroundStyle(.orange)
            }
            if !preview.canSend {
                Label(preview.reason.isEmpty ? "当前无法安全发送私信。" : preview.reason, systemImage: "exclamationmark.triangle.fill")
                    .foregroundStyle(.red)
                    .textSelection(.enabled)
            }
        }
    }

    private var actionBar: some View {
        HStack(spacing: 10) {
            if isPerformingAction {
                ProgressView()
                    .controlSize(.small)
            }

            if let errorMessage {
                Label(errorMessage, systemImage: "exclamationmark.triangle")
                    .foregroundStyle(.red)
                    .lineLimit(2)
            } else if let actionMessage {
                Label(actionMessage, systemImage: "checkmark.circle")
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
            } else if hasUnsavedChanges {
                Label("有未保存的修改", systemImage: "pencil.circle")
                    .foregroundStyle(.orange)
            }

            Spacer()

            if submissionPreview != nil {
                Button("返回草稿", action: onCancelSubmission)
                    .disabled(isPerformingAction)
                Button("确认并提交", action: onSubmit)
                    .buttonStyle(.borderedProminent)
                    .disabled(isPerformingAction || submissionPreview?.canSubmit != true)
            } else if privateMessagePreview != nil {
                Button("返回草稿", action: onCancelPrivateMessage)
                    .disabled(isPerformingAction)
                Button("确认并发送", action: onSendPrivateMessage)
                    .buttonStyle(.borderedProminent)
                    .disabled(isPerformingAction || privateMessagePreview?.canSend != true)
            } else {
                Button("保存正文", action: onSave)
                    .disabled(!detail.canEdit || !hasUnsavedChanges || isPerformingAction || editableText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)

                Button("驳回", role: .destructive, action: onReject)
                    .disabled(!detail.canReview || hasUnsavedChanges || isPerformingAction)

                Button("通过审核", action: onApprove)
                    .buttonStyle(.borderedProminent)
                    .disabled(!detail.canReview || hasUnsavedChanges || isPerformingAction)

                if detail.status == "approved" {
                    Button("准备提交", action: onPrepareSubmission)
                        .disabled(!canPrepareSubmission)
                    Button(detail.deliveryAttemptStatus == "failed" ? "改用私信老师" : "准备私信老师", action: onPreparePrivateMessage)
                        .disabled(!canPreparePrivateMessage)
                }
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
    }

    private func metadataRow(_ label: String, _ value: String) -> some View {
        GridRow {
            Text(label)
                .foregroundStyle(.secondary)
            Text(value.isEmpty ? "—" : value)
                .textSelection(.enabled)
        }
    }
}
