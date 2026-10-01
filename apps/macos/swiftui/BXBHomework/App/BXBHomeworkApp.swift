import SwiftUI

@main
struct BXBHomeworkApp: App {
    @State private var backend = BackendConnectionModel()

    var body: some Scene {
        WindowGroup {
            AppShellView()
                .environment(backend)
                .task {
                    await backend.connect()
                }
        }
        .defaultSize(width: 1080, height: 700)

        Settings {
            SettingsView()
                .environment(backend)
        }
    }
}
