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
                onReject: { showingRejectConfirmation = true }
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

    var body: some View {
        VStack(spacing: 0) {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    titleSection
                    metadataSection
                    reviewSignals
                    editorSection
                }
                .padding(20)
                .frame(maxWidth: 860, alignment: .leading)
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
                    .disabled(detail.isFinal || isPerformingAction)

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
                    .disabled(detail.isFinal || isPerformingAction)

                Text("正文必须保持纯文本。保存修改后状态会回到“待审核”。")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            .padding(.vertical, 5)
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

            Button("保存正文", action: onSave)
                .disabled(detail.isFinal || !hasUnsavedChanges || isPerformingAction || editableText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)

            Button("驳回", role: .destructive, action: onReject)
                .disabled(!detail.canReview || hasUnsavedChanges || isPerformingAction)

            Button("通过审核", action: onApprove)
                .buttonStyle(.borderedProminent)
                .disabled(!detail.canReview || hasUnsavedChanges || isPerformingAction)
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
