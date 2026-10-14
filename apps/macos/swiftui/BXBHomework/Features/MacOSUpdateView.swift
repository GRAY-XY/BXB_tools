import AppKit
import SwiftUI

struct MacOSUpdateView: View {
    let model: MacOSUpdateModel
    @State private var showingInstallConfirmation = false

    var body: some View {
        Section("应用更新") {
            LabeledContent("当前版本", value: model.currentVersion)
            if !model.state.latestVersion.isEmpty {
                LabeledContent("可用版本", value: model.state.latestVersion)
            }
            Text(model.isChecking ? "正在检查更新…" : model.state.message)
                .foregroundStyle(model.state.phase == .failed ? Color.red : Color.secondary)
                .fixedSize(horizontal: false, vertical: true)
            if model.isDownloading || [.downloading, .verifying].contains(model.state.phase) {
                ProgressView(value: model.state.percent, total: 100)
                Text("\(formattedBytes(model.state.downloadedBytes)) / \(formattedBytes(model.state.totalBytes))")
                    .font(.caption).foregroundStyle(.secondary)
            }
            if let error = model.errorMessage {
                Label(error, systemImage: "exclamationmark.triangle")
                    .foregroundStyle(.red).fixedSize(horizontal: false, vertical: true)
            }
            HStack {
                Button("检查更新") { Task { await model.check() } }.disabled(model.isBusy)
                if model.state.canDownload {
                    Button("下载更新") { Task { await model.download() } }.disabled(model.isBusy)
                }
                if model.isDownloading {
                    Button("取消下载") { Task { await model.cancelDownload() } }
                }
                if model.state.canInstall {
                    Button("打开安装包并退出…") { showingInstallConfirmation = true }.disabled(model.isBusy)
                }
            }
            if !model.state.latestNotes.isEmpty {
                DisclosureGroup("更新说明") {
                    Text(model.state.latestNotes).textSelection(.enabled).fixedSize(horizontal: false, vertical: true)
                }
            }
            Text("确认安装后应用将退出。将安装包中的 BXB Homework 拖入“应用程序”并替换，完成后再手动打开。")
                .font(.caption).foregroundStyle(.secondary)
        }
        .task { await model.refreshStatus() }
        .confirmationDialog("打开已校验的更新安装包并退出？", isPresented: $showingInstallConfirmation) {
            Button("打开安装包并退出") { Task { await model.install(confirmed: true) } }
            Button("取消", role: .cancel) {}
        } message: {
            Text("请先保存未完成的输入。应用将再次校验安装包，打开 DMG 后退出；请拖入“应用程序”替换安装，再手动启动新版本。")
        }
    }

    private func formattedBytes(_ bytes: Int) -> String {
        ByteCountFormatter.string(fromByteCount: Int64(bytes), countStyle: .file)
    }
}
