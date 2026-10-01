import SwiftUI

/// Switches split panes to a vertically scrollable layout when the detail column is narrow.
struct AdaptiveSplitView<Primary: View, Secondary: View>: View {
    let breakpoint: CGFloat
    let primaryMinHeight: CGFloat
    let secondaryMinHeight: CGFloat
    @ViewBuilder let primary: () -> Primary
    @ViewBuilder let secondary: () -> Secondary

    init(
        breakpoint: CGFloat = 760,
        primaryMinHeight: CGFloat = 180,
        secondaryMinHeight: CGFloat = 320,
        @ViewBuilder primary: @escaping () -> Primary,
        @ViewBuilder secondary: @escaping () -> Secondary
    ) {
        self.breakpoint = breakpoint
        self.primaryMinHeight = primaryMinHeight
        self.secondaryMinHeight = secondaryMinHeight
        self.primary = primary
        self.secondary = secondary
    }

    var body: some View {
        GeometryReader { proxy in
            if proxy.size.width < breakpoint {
                VStack(spacing: 0) {
                    primary()
                        .frame(minHeight: primaryMinHeight, maxHeight: 300)
                    Divider()
                    secondary()
                        .frame(minHeight: secondaryMinHeight, maxHeight: .infinity)
                }
            } else {
                HSplitView {
                    primary()
                    secondary()
                }
            }
        }
    }
}

struct AppShellView: View {
    @Environment(BackendConnectionModel.self) private var backend
    @State private var selection: AppSection? = .overview
    @State private var pendingWorkspaceRelativePath: String?

    var body: some View {
        NavigationSplitView {
            List(AppSection.allCases, selection: $selection) { section in
                Label(section.title, systemImage: section.symbolName)
                    .tag(section)
            }
            .navigationTitle("BXB Homework")
            .navigationSplitViewColumnWidth(min: 156, ideal: 204, max: 260)
        } detail: {
            switch selection {
            case .overview:
                OverviewView()
            case .homework:
                HomeworkView { relativePath in
                    pendingWorkspaceRelativePath = relativePath
                    selection = .workspace
                }
            case .assistant:
                AssistantView()
            case .workspace:
                WorkspaceView(selectingRelativePath: pendingWorkspaceRelativePath) {
                    pendingWorkspaceRelativePath = nil
                }
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
        .frame(minWidth: 760, minHeight: 500)
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
