import SwiftUI

struct OverviewView: View {
    @Environment(BackendConnectionModel.self) private var backend
    @State private var showingLogin = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                header

                if let errorMessage = backend.errorMessage {
                    errorCard(errorMessage)
                }

                sessionGrid
                runtimeCard
            }
            .padding(32)
            .frame(maxWidth: 980, alignment: .leading)
        }
        .navigationTitle("概览")
        .sheet(isPresented: $showingLogin) {
            LoginView()
                .environment(backend)
        }
        .toolbar {
            if backend.state == .connected, backend.session?.ready != true {
                ToolbarItem {
                    Button("登录办学帮") {
                        showingLogin = true
                    }
                }
            }
            ToolbarItem {
                Button {
                    Task { await backend.refreshSession() }
                } label: {
                    Label("刷新", systemImage: "arrow.clockwise")
                }
                .disabled(backend.state == .connecting)
            }
        }
    }

    private var header: some View {
        HStack(alignment: .center, spacing: 16) {
            Image(systemName: "rectangle.grid.2x2")
                .font(.system(size: 30, weight: .medium))
                .frame(width: 56, height: 56)
                .background(.tint.opacity(0.12), in: RoundedRectangle(cornerRadius: 14))
                .foregroundStyle(.tint)

            VStack(alignment: .leading, spacing: 5) {
                Text("概览")
                    .font(.largeTitle.bold())
                Label(backend.statusText, systemImage: backend.statusSymbol)
                    .foregroundStyle(backend.state == .connected ? Color.secondary : Color.orange)
            }
        }
    }

    private var sessionGrid: some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 190), spacing: 14)], spacing: 14) {
            SummaryCard(
                title: "账号",
                value: backend.session?.user?.name ?? (backend.session?.ready == true ? "已登录" : "尚未登录"),
                symbol: "person.crop.circle"
            )
            SummaryCard(
                title: "当前学期",
                value: backend.session?.currentTermName ?? "—",
                symbol: "calendar"
            )
            SummaryCard(
                title: "课程",
                value: backend.session?.ready == true ? "\(backend.session?.courseCount ?? 0)" : "—",
                symbol: "books.vertical"
            )
            SummaryCard(
                title: "待完成",
                value: backend.session?.ready == true ? "\(backend.session?.pendingCount ?? 0)" : "—",
                symbol: "checklist"
            )
        }
    }

    private var runtimeCard: some View {
        GroupBox("本地运行时") {
            Grid(alignment: .leading, horizontalSpacing: 24, verticalSpacing: 10) {
                GridRow {
                    Text("客户端")
                        .foregroundStyle(.secondary)
                    Text("SwiftUI 原生客户端")
                }
                GridRow {
                    Text("后端")
                        .foregroundStyle(.secondary)
                    Text(backend.appInfo.map { "v\($0.version) · \($0.platform)" } ?? "等待连接")
                }
                GridRow {
                    Text("Node.js")
                        .foregroundStyle(.secondary)
                    Text(backend.appInfo?.nodeVersion ?? "—")
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.vertical, 6)
        }
    }

    private func errorCard(_ message: String) -> some View {
        GroupBox {
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .foregroundStyle(.orange)
                VStack(alignment: .leading, spacing: 6) {
                    Text("无法连接本地后端")
                        .font(.headline)
                    Text(message)
                        .foregroundStyle(.secondary)
                        .textSelection(.enabled)
                    Button("重试") {
                        Task { await backend.connect() }
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

private struct SummaryCard: View {
    let title: String
    let value: String
    let symbol: String

    var body: some View {
        GroupBox {
            HStack(spacing: 12) {
                Image(systemName: symbol)
                    .font(.title2)
                    .foregroundStyle(.tint)
                VStack(alignment: .leading, spacing: 3) {
                    Text(title)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Text(value)
                        .font(.title3.weight(.semibold))
                        .lineLimit(1)
                }
                Spacer(minLength: 0)
            }
            .padding(.vertical, 5)
        }
    }
}
