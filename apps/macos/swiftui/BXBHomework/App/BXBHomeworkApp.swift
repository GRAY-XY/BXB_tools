import SwiftUI

@main
struct BXBHomeworkApp: App {
    @State private var backend: BackendConnectionModel
    @State private var setup: AssistantSetupModel

    init() {
        let backend = BackendConnectionModel()
        _backend = State(initialValue: backend)
        let defaults = ProcessInfo.processInfo.environment["BXB_TEST_DEFAULTS_SUITE"].flatMap { UserDefaults(suiteName: $0) } ?? .standard
        _setup = State(initialValue: AssistantSetupModel(service: backend.modelConfiguration, defaults: defaults))
    }

    var body: some Scene {
        WindowGroup {
            AppShellView()
                .modifier(AssistantSetupPresenter())
                .environment(backend)
                .environment(setup)
                .task {
                    await backend.connect()
                    if backend.state == .connected { await setup.prepare() }
                }
                .onChange(of: backend.state) { _, state in
                    if state == .connected && !setup.prepared {
                        Task { await setup.prepare() }
                    }
                }
        }
        .defaultSize(width: 1080, height: 700)

        Settings {
            SettingsView()
                .modifier(AssistantSetupPresenter())
                .environment(backend)
                .environment(setup)
        }
    }
}
