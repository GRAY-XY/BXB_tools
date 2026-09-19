import QuickLookUI
import SwiftUI

struct WorkspaceView: View {
    @Environment(BackendConnectionModel.self) private var backend
    @State private var model = WorkspaceViewModel()

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
                Text("浏览导入文件、作业附件和助理生成的本地文件。")
                    .foregroundStyle(.secondary)
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
            .frame(maxWidth: 420)

            if model.isLoadingFiles {
                ProgressView()
                    .controlSize(.small)
            }

            Spacer()

            Button {
                Task { await model.loadFiles(using: backend) }
            } label: {
                Label("刷新", systemImage: "arrow.clockwise")
            }
            .disabled(model.isLoadingFiles)
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
                    WorkspaceFileRow(file: file)
                        .tag(file.id)
                }
                .listStyle(.sidebar)
            }
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
                    QuickLookPreview(url: URL(filePath: file.path))
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
                Text("\(file.formattedSize) · \(file.modifiedDisplay)")
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
                Text("\(file.relativePath) · \(file.formattedSize)")
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
