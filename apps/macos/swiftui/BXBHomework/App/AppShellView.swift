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
            case .assistant:
                AssistantView()
            case .workspace:
                WorkspaceView()
            case .review:
                DraftReviewView()
            case .messages:
                MessagesView()
            case .settings:
                SettingsView()
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
        .preferredColorScheme(backend.themePreference == "dark" ? .dark : backend.themePreference == "light" ? .light : nil)
        .toolbar {
            ToolbarItem(placement: .status) {
                Label(backend.statusText, systemImage: backend.statusSymbol)
                    .foregroundStyle(.secondary)
            }
        }
    }
}

#Preview {
    AppShellView()
        .environment(BackendConnectionModel())
}
