import SwiftUI

struct AppShellView: View {
    @Environment(BackendConnectionModel.self) private var backend
    @State private var selection: AppSection? = .overview

    var body: some View {
        NavigationSplitView {
            List(AppSection.allCases, selection: $selection) { section in
                Label(section.title, systemImage: section.symbolName)
                    .tag(section)
            }
            .navigationTitle("BXB Homework")
            .navigationSplitViewColumnWidth(min: 180, ideal: 220, max: 280)
        } detail: {
            switch selection {
            case .overview:
                OverviewView()
            case .homework:
                HomeworkView()
            case .workspace:
                WorkspaceView()
            case .some(let selection):
                FeaturePlaceholderView(section: selection)
            case .none:
                ContentUnavailableView(
                    "选择功能",
                    systemImage: "sidebar.left",
                    description: Text("从侧边栏选择一个功能区。")
                )
            }
        }
        .frame(minWidth: 900, minHeight: 600)
        .toolbar {
            ToolbarItem(placement: .status) {
                Label(backend.statusText, systemImage: backend.statusSymbol)
                    .foregroundStyle(.secondary)
            }
        }
    }
}

struct NativeSettingsView: View {
    @Environment(BackendConnectionModel.self) private var backend

    var body: some View {
        Form {
            LabeledContent("客户端", value: "SwiftUI 原生骨架")
            LabeledContent("后端", value: backend.statusText)
        }
        .formStyle(.grouped)
        .padding()
        .frame(width: 480, height: 220)
    }
}

#Preview {
    AppShellView()
        .environment(BackendConnectionModel())
}
