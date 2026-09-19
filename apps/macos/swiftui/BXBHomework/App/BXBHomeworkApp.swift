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
        .defaultSize(width: 1180, height: 760)

        Settings {
            NativeSettingsView()
                .environment(backend)
        }
    }
}
