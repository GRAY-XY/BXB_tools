import SwiftUI
import AppKit

@main
struct BXBHomeworkApp: App {
    @State private var backend: BackendConnectionModel
    @State private var setup: AssistantSetupModel
    @State private var updater: MacOSUpdateModel

    init() {
        let backend = BackendConnectionModel()
        _backend = State(initialValue: backend)
        let defaults = ProcessInfo.processInfo.environment["BXB_TEST_DEFAULTS_SUITE"].flatMap { UserDefaults(suiteName: $0) } ?? .standard
        _setup = State(initialValue: AssistantSetupModel(service: backend.modelConfiguration, defaults: defaults))
        _updater = State(initialValue: MacOSUpdateModel(invoke: { method, params in
            try await backend.invoke(method, params: params)
        }, openInstaller: { NSWorkspace.shared.open($0) }, quit: { NSApp.terminate(nil) }))
    }

    var body: some Scene {
        WindowGroup {
            AppShellView()
                .modifier(AssistantSetupPresenter())
                .environment(backend)
                .environment(setup)
                .environment(updater)
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
                .environment(updater)
        }
    }
}
