import SwiftUI

struct FeaturePlaceholderView: View {
    let section: AppSection

    var body: some View {
        VStack(alignment: .leading, spacing: 24) {
            HStack(spacing: 16) {
                Image(systemName: section.symbolName)
                    .font(.system(size: 30, weight: .medium))
                    .frame(width: 56, height: 56)
                    .background(.tint.opacity(0.12), in: RoundedRectangle(cornerRadius: 14))
                    .foregroundStyle(.tint)

                VStack(alignment: .leading, spacing: 5) {
                    Text(section.title)
                        .font(.largeTitle.bold())
                    Text(section.summary)
                        .foregroundStyle(.secondary)
                }
            }

            GroupBox("迁移状态") {
                VStack(alignment: .leading, spacing: 12) {
                    StatusRow(symbol: "checkmark.circle.fill", title: "原生窗口与导航", color: .green)
                    StatusRow(symbol: "hammer.circle", title: "Node 后端桥接", color: .orange)
                    StatusRow(symbol: "arrow.triangle.2.circlepath", title: "Windows 功能对齐", color: .secondary)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.vertical, 6)
            }

            Spacer()
        }
        .padding(32)
        .navigationTitle(section.title)
    }
}

private struct StatusRow: View {
    let symbol: String
    let title: String
    let color: Color

    var body: some View {
        Label(title, systemImage: symbol)
            .symbolRenderingMode(.hierarchical)
            .foregroundStyle(color)
    }
}
