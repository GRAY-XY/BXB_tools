import AppKit
import SwiftUI

enum AssistantCodePreviewLoader {
    static func imageData(for preview: AssistantPreviewImage, workspaceDirectory: String?) async -> Data? {
        guard let url = preview.fileURL(in: workspaceDirectory) else { return nil }
        return await Task.detached(priority: .utility) {
            guard let values = try? url.resourceValues(forKeys: [.isRegularFileKey, .fileSizeKey]),
                  values.isRegularFile == true,
                  let size = values.fileSize, size > 0, size <= 12 * 1024 * 1024 else { return nil as Data? }
            return try? Data(contentsOf: url)
        }.value
    }
}

struct AssistantCodePreviewView: View {
    let preview: AssistantPreviewImage
    let workspaceDirectory: String?
    @State private var image: NSImage?
    @State private var isLoading = true
    @State private var showingFullSize = false

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(preview.caption)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .textSelection(.enabled)
                Spacer(minLength: 0)
                if image != nil {
                    Button("放大", systemImage: "arrow.up.left.and.arrow.down.right") {
                        showingFullSize = true
                    }
                    .controlSize(.small)
                }
            }

            if let image {
                Image(nsImage: image)
                    .resizable()
                    .interpolation(.high)
                    .scaledToFit()
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .clipShape(RoundedRectangle(cornerRadius: 6))
                    .accessibilityLabel(preview.caption)
            } else if isLoading {
                ProgressView("正在读取代码预览…")
                    .controlSize(.small)
            } else {
                Label("无法显示代码预览：文件不可用或图片已损坏。", systemImage: "exclamationmark.triangle")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.top, 6)
        .task(id: workspaceDirectory) {
            image = nil
            isLoading = true
            let data = await AssistantCodePreviewLoader.imageData(for: preview, workspaceDirectory: workspaceDirectory)
            guard !Task.isCancelled else { return }
            image = data.flatMap { NSImage(data: $0) }
            isLoading = false
        }
        .sheet(isPresented: $showingFullSize) {
            VStack(spacing: 0) {
                HStack {
                    Text(preview.caption)
                        .font(.headline)
                        .textSelection(.enabled)
                    Spacer()
                    Button("完成") { showingFullSize = false }
                        .keyboardShortcut(.cancelAction)
                }
                .padding(16)
                Divider()
                if let image {
                    ScrollView([.horizontal, .vertical]) {
                        Image(nsImage: image)
                            .fixedSize()
                            .accessibilityLabel(preview.caption)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            }
            .frame(minWidth: 360, idealWidth: 900, maxWidth: .infinity,
                   minHeight: 300, idealHeight: 650, maxHeight: .infinity)
        }
    }
}
