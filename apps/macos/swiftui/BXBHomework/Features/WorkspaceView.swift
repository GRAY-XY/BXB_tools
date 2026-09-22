import AppKit
import QuickLookUI
import SwiftUI

struct WorkspaceView: View {
    @Environment(BackendConnectionModel.self) private var backend
    @State private var model = WorkspaceViewModel()
    @State private var showingPasteSheet = false
    @State private var showingDeleteConfirmation = false
    @State private var pendingDelete: WorkspaceFile?

    var body: some View {
        VStack(spacing: 0) {
            header
                .padding(.horizontal, 24)
                .padding(.vertical, 18)

            Divider()

            controls
                .padding(.horizontal, 20)
                .padding(.vertical, 12)

            Divider()

            statusArea

            HSplitView {
                fileList
                    .frame(minWidth: 290, idealWidth: 350, maxWidth: 460)
                previewPane
                    .frame(minWidth: 440, maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .navigationTitle("文件")
        .task(id: model.searchText) {
            if !model.searchText.isEmpty {
                try? await Task.sleep(for: .milliseconds(300))
            }
            guard !Task.isCancelled else { return }
            await model.loadFiles(using: backend)
        }
        .onChange(of: model.selectedFileID) {
            Task { await model.loadSelectedFile(using: backend) }
        }
        .sheet(isPresented: $showingPasteSheet) {
            pasteSheet
        }
        .confirmationDialog(
            deleteTitle,
            isPresented: $showingDeleteConfirmation,
            titleVisibility: .visible
        ) {
            Button(deleteButtonTitle, role: .destructive) {
                guard let target = pendingDelete else { return }
                pendingDelete = nil
                Task { await model.delete(target, using: backend) }
            }
            Button("取消", role: .cancel) {
                pendingDelete = nil
            }
        } message: {
            Text(deleteMessage)
        }
    }

    private var header: some View {
        HStack(spacing: 14) {
            Image(systemName: "folder")
                .font(.system(size: 25, weight: .medium))
                .foregroundStyle(.tint)
                .frame(width: 48, height: 48)
                .background(.tint.opacity(0.12), in: RoundedRectangle(cornerRadius: 12))
            VStack(alignment: .leading, spacing: 3) {
                Text("本地工作区")
                    .font(.title2.bold())
                Text(model.workspaceDir ?? "浏览导入文件、作业附件和助理生成的本地文件。")
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .truncationMode(.middle)
                    .textSelection(.enabled)
            }
            Spacer()
        }
    }

    private var controls: some View {
        HStack(spacing: 12) {
            TextField("搜索文件名或路径", text: Binding(
                get: { model.searchText },
                set: { model.searchText = $0 }
            ))
            .textFieldStyle(.roundedBorder)
            .frame(maxWidth: 320)

            if model.isLoadingFiles || model.isBusy {
                ProgressView()
                    .controlSize(.small)
            }

            Spacer()

            Button {
                presentImportPanel()
            } label: {
                Label("导入…", systemImage: "square.and.arrow.down")
            }
            .disabled(model.isBusy)
            .help("从工作区外部导入文件或文件夹（只复制，不移动）")

            Button {
                beginSavingPastedText()
            } label: {
                Label("保存剪贴板文本…", systemImage: "doc.on.clipboard")
            }
            .disabled(model.isBusy)

            Button {
                guard let file = model.selectedFile else { return }
                model.beginRenaming(file)
            } label: {
                Label("重命名", systemImage: "pencil")
            }
            .disabled(!model.canUseSelection)

            Button {
                requestDelete()
            } label: {
                Label("删除", systemImage: "trash")
            }
            .disabled(!model.canUseSelection)
            .help("删除所选项目，删除前会再次确认；文件夹只有为空时才能删除")

            Button {
                Task { await model.revealWorkspace(using: backend) }
            } label: {
                Label("在 Finder 中显示", systemImage: "arrow.up.forward.app")
            }
            .help("在 Finder 中打开工作区文件夹")

            Button {
                Task {
                    await model.loadFiles(using: backend)
                    await model.loadSelectedFile(using: backend)
                }
            } label: {
                Label("刷新", systemImage: "arrow.clockwise")
            }
            .disabled(model.isLoadingFiles || model.isBusy)
        }
    }

    @ViewBuilder
    private var statusArea: some View {
        if let message = model.actionError {
            statusBar(
                message: message,
                symbol: "exclamationmark.triangle.fill",
                tint: .orange,
                showsConflictActions: false
            )
            Divider()
        } else if let outcome = model.importOutcome, !outcome.isEmpty {
            importSummaryBar(outcome)
            Divider()
        } else if let message = model.actionMessage {
            statusBar(message: message, symbol: "checkmark.circle", tint: .gray, showsConflictActions: false)
            Divider()
        }
    }

    private func statusBar(
        message: String,
        symbol: String,
        tint: Color,
        showsConflictActions: Bool
    ) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: symbol)
                .foregroundStyle(tint)
            Text(message)
                .font(.callout)
                .textSelection(.enabled)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 12)
            if showsConflictActions {
                Button("为冲突项保留两者") {
                    Task { await model.importConflictsKeepingBoth(using: backend) }
                }
                .disabled(model.isBusy)
            }
            Button("关闭") {
                model.clearActionMessages()
            }
            .buttonStyle(.link)
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 10)
        .background(Color.gray.opacity(0.12))
    }

    private func importSummaryBar(_ outcome: WorkspaceImportOutcome) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            statusBar(
                message: outcome.summaryText,
                symbol: "tray.and.arrow.down",
                tint: .gray,
                showsConflictActions: !outcome.conflicts.isEmpty
            )
            if !outcome.problems.isEmpty {
                VStack(alignment: .leading, spacing: 3) {
                    ForEach(outcome.problems) { problem in
                        Text("• \(problem.message)")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .textSelection(.enabled)
                    }
                }
                .padding(.horizontal, 20)
                .padding(.bottom, 10)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Color.gray.opacity(0.12))
            }
        }
    }

    private var fileList: some View {
        VStack(spacing: 0) {
            HStack {
                Text("文件")
                    .font(.headline)
                Spacer()
                Text("\(model.files.count) 项")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)

            Divider()

            if model.isLoadingFiles && model.files.isEmpty {
                ProgressView("正在读取工作区…")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if let error = model.listError {
                ContentUnavailableView(
                    "无法读取工作区",
                    systemImage: "exclamationmark.triangle",
                    description: Text(error)
                )
            } else if model.files.isEmpty {
                ContentUnavailableView(
                    model.searchText.isEmpty ? "工作区为空" : "没有匹配文件",
                    systemImage: "folder",
                    description: Text(model.searchText.isEmpty ? "导入和下载的文件会显示在这里。" : "尝试修改搜索内容。")
                )
            } else {
                List(model.files, selection: Binding(
                    get: { model.selectedFileID },
                    set: { model.selectedFileID = $0 }
                )) { file in
                    fileRow(file)
                        .tag(file.id)
                }
                .listStyle(.sidebar)
            }
        }
    }

    @ViewBuilder
    private func fileRow(_ file: WorkspaceFile) -> some View {
        if model.renamingFileID == file.id {
            VStack(alignment: .leading, spacing: 6) {
                TextField("文件名", text: Binding(
                    get: { model.renameDraft },
                    set: { model.updateRenameDraft($0, originalExtension: file.isDirectory ? "" : file.fileExtension) }
                ))
                .textFieldStyle(.roundedBorder)
                .onSubmit {
                    Task { await model.commitRename(using: backend) }
                }

                if let message = model.renameValidationMessage {
                    Label(message, systemImage: "exclamationmark.triangle.fill")
                        .font(.caption)
                        .foregroundStyle(.orange)
                } else if let hint = model.renameHint {
                    Text(hint)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                } else {
                    Text(file.relativePath)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                HStack(spacing: 8) {
                    Button("保存") {
                        Task { await model.commitRename(using: backend) }
                    }
                    .disabled(model.renameValidationMessage != nil || model.isBusy)
                    Button("取消") {
                        model.cancelRenaming()
                    }
                    .keyboardShortcut(.cancelAction)
                }
                .controlSize(.small)
            }
            .padding(.vertical, 4)
        } else {
            WorkspaceFileRow(file: file)
                .contentShape(Rectangle())
                .simultaneousGesture(
                    TapGesture(count: 2).onEnded {
                        model.beginRenaming(file)
                    }
                )
        }
    }

    @ViewBuilder
    private var previewPane: some View {
        if model.isLoadingPreview {
            ProgressView("正在读取文件…")
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if let error = model.previewError {
            ContentUnavailableView(
                "无法预览文件",
                systemImage: "exclamationmark.triangle",
                description: Text(error)
            )
        } else if let preview = model.preview {
            switch preview {
            case .text(let file, let textPreview):
                WorkspaceTextPreviewView(file: file, preview: textPreview)
            case .quickLook(let file):
                VStack(spacing: 0) {
                    WorkspacePreviewHeader(file: file)
                    Divider()
                    if !file.hasBuiltInReader {
                        unsupportedTypeNotice(file)
                        Divider()
                    }
                    QuickLookPreview(url: URL(filePath: file.path))
                }
            case .directory(let file):
                WorkspaceFolderPreviewView(file: file) {
                    model.revealSelectedFile()
                }
            }
        } else {
            ContentUnavailableView(
                "选择一个文件",
                systemImage: "doc.text.magnifyingglass",
                description: Text("从左侧列表选择文件以预览。")
            )
        }
    }

    private func unsupportedTypeNotice(_ file: WorkspaceFile) -> some View {
        HStack(spacing: 10) {
            Image(systemName: "questionmark.circle")
                .foregroundStyle(.secondary)
            Text("“\(file.name)”已保存在工作区，但当前版本没有内置读取器。这里使用系统 Quick Look 预览，也可以直接在 Finder 中打开。")
                .font(.callout)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 12)
            Button("在 Finder 中显示") {
                model.revealSelectedFile()
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
    }

    private var pasteSheet: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("保存剪贴板文本")
                .font(.title3.bold())
            Text("保存到：\(model.workspaceDir ?? "工作区")")
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(1)
                .truncationMode(.middle)

            TextField("文件名", text: Binding(
                get: { model.pastedTextName },
                set: { model.updatePastedTextName($0) }
            ))
            .textFieldStyle(.roundedBorder)

            if let message = model.pastedTextValidationMessage {
                Label(message, systemImage: "exclamationmark.triangle.fill")
                    .font(.caption)
                    .foregroundStyle(.orange)
            } else {
                Text("将写入 \(model.pastedTextDraft.count) 个字符（UTF-8），不会覆盖同名文件。")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            if let error = model.actionError {
                Label(error, systemImage: "exclamationmark.triangle.fill")
                    .font(.caption)
                    .foregroundStyle(.orange)
                    .fixedSize(horizontal: false, vertical: true)
            }

            HStack {
                Spacer()
                Button("取消") {
                    model.cancelPastedText()
                    showingPasteSheet = false
                }
                .keyboardShortcut(.cancelAction)
                Button("保存") {
                    Task {
                        if await model.savePastedText(using: backend) {
                            showingPasteSheet = false
                        }
                    }
                }
                .keyboardShortcut(.defaultAction)
                .disabled(model.isBusy || model.pastedTextValidationMessage != nil)
            }
        }
        .padding(20)
        .frame(width: 460)
    }

    private var deleteTitle: String {
        "确定要永久删除“\(pendingDelete?.name ?? "")”吗？"
    }

    private var deleteButtonTitle: String {
        "删除“\(pendingDelete?.name ?? "")”"
    }

    private var deleteMessage: String {
        guard let target = pendingDelete else { return "此操作无法撤销。" }
        if target.isDirectory {
            return "目标：\(target.relativePath)\n这是一个文件夹，只有空文件夹可以删除。"
                + "如果里面还有内容，删除会被拒绝——应用不提供递归删除。"
        }
        return "目标：\(target.relativePath)\n此操作无法撤销，删除后工作区中不会保留该文件。"
    }

    // MARK: - Actions

    private func requestDelete() {
        guard let file = model.selectedFile else { return }
        pendingDelete = file
        showingDeleteConfirmation = true
    }

    private func beginSavingPastedText() {
        guard let text = model.readClipboardText() else {
            model.reportEmptyClipboard()
            return
        }
        model.beginSavingPastedText(text)
        showingPasteSheet = true
    }

    private func presentImportPanel() {
        let panel = NSOpenPanel()
        panel.title = "导入到工作区"
        panel.message = model.workspaceDir.map { "导入到：\($0)" } ?? "导入到工作区"
        panel.prompt = "导入"
        panel.canChooseFiles = true
        panel.canChooseDirectories = true
        panel.allowsMultipleSelection = true
        panel.resolvesAliases = false
        guard panel.runModal() == .OK else { return }
        let paths = panel.urls.map { $0.path(percentEncoded: false) }
        Task { await model.importItems(paths, using: backend) }
    }
}

private struct WorkspaceFileRow: View {
    let file: WorkspaceFile

    var body: some View {
        HStack(spacing: 11) {
            Image(systemName: file.symbolName)
                .font(.title3)
                .foregroundStyle(.tint)
                .frame(width: 24)
            VStack(alignment: .leading, spacing: 4) {
                Text(file.name)
                    .fontWeight(.semibold)
                    .lineLimit(1)
                Text(file.relativePath)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                Text("\(file.sizeDisplay) · \(file.modifiedDisplay)")
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
            }
        }
        .padding(.vertical, 4)
    }
}

private struct WorkspacePreviewHeader: View {
    let file: WorkspaceFile

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: file.symbolName)
                .font(.title2)
                .foregroundStyle(.tint)
            VStack(alignment: .leading, spacing: 3) {
                Text(file.name)
                    .font(.headline)
                    .textSelection(.enabled)
                Text("\(file.relativePath) · \(file.sizeDisplay)")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .textSelection(.enabled)
            }
            Spacer()
        }
        .padding(16)
    }
}

private struct WorkspaceTextPreviewView: View {
    let file: WorkspaceFile
    let preview: WorkspaceTextPreview

    var body: some View {
        VStack(spacing: 0) {
            WorkspacePreviewHeader(file: file)
            Divider()
            ScrollView {
                Text(preview.text.isEmpty ? "文件没有可读取的文本内容。" : preview.text)
                    .font(.system(.body, design: .monospaced))
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .topLeading)
                    .padding(20)
            }
            Divider()
            HStack {
                Text(preview.reader.isEmpty ? "文本预览" : "读取器：\(preview.reader)")
                Spacer()
                if preview.totalCharacters > 0 {
                    Text("\(preview.totalCharacters) 字符")
                }
                if preview.truncated {
                    Label("预览已截断", systemImage: "exclamationmark.triangle")
                        .foregroundStyle(.orange)
                }
            }
            .font(.caption)
            .foregroundStyle(.secondary)
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
        }
    }
}

private struct QuickLookPreview: NSViewRepresentable {
    let url: URL

    final class Coordinator {
        var url: URL?
    }

    func makeCoordinator() -> Coordinator {
        Coordinator()
    }

    func makeNSView(context: Context) -> QLPreviewView {
        let view = QLPreviewView(frame: .zero, style: .normal)!
        view.autostarts = true
        return view
    }

    func updateNSView(_ view: QLPreviewView, context: Context) {
        guard context.coordinator.url != url else { return }
        context.coordinator.url = url
        view.previewItem = url as NSURL
        view.refreshPreviewItem()
    }
}

private struct WorkspaceFolderPreviewView: View {
    let file: WorkspaceFile
    let onReveal: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            WorkspacePreviewHeader(file: file)
            Divider()
            VStack(spacing: 12) {
                Image(systemName: "folder")
                    .font(.system(size: 44))
                    .foregroundStyle(.tint)
                Text("这是一个文件夹")
                    .font(.headline)
                Text("文件夹没有可预览的内容。应用只删除空文件夹；如果里面还有内容，删除会被拒绝，因为不提供递归删除。")
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: 460)
                Button("在 Finder 中显示") {
                    onReveal()
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .padding(20)
        }
    }
}
