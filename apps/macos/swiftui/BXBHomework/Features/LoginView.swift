import SwiftUI

struct LoginView: View {
    @Environment(BackendConnectionModel.self) private var backend
    @Environment(\.dismiss) private var dismiss

    @State private var username = ""
    @State private var password = ""
    @State private var rememberCredential = false
    @State private var agreeTerms = false
    @State private var isLoggingIn = false
    @State private var didLoadSavedCredential = false
    @State private var message: String?
    @State private var loginCompleted = false

    private let credentialStore = KeychainCredentialStore()

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            HStack(spacing: 14) {
                Image(systemName: "person.badge.key.fill")
                    .font(.system(size: 28))
                    .foregroundStyle(.tint)
                    .frame(width: 48, height: 48)
                    .background(.tint.opacity(0.12), in: RoundedRectangle(cornerRadius: 12))

                VStack(alignment: .leading, spacing: 3) {
                    Text("登录办学帮")
                        .font(.title2.bold())
                    Text("登录由本机后端完成，账号密码不会写入项目配置或应用日志。")
                        .font(.callout)
                        .foregroundStyle(.secondary)
                }
            }

            Form {
                TextField("账号", text: $username)
                    .textContentType(.username)
                    .disabled(isLoggingIn || loginCompleted)

                SecureField("密码", text: $password)
                    .textContentType(.password)
                    .disabled(isLoggingIn || loginCompleted)

                Toggle("使用 macOS 钥匙串保存账号和密码", isOn: $rememberCredential)
                    .disabled(isLoggingIn || loginCompleted)

                Toggle("我同意办学帮登录页的用户协议和隐私政策", isOn: $agreeTerms)
                    .disabled(isLoggingIn || loginCompleted)
            }
            .formStyle(.grouped)

            if let message {
                Label(message, systemImage: loginCompleted ? "checkmark.circle.fill" : "exclamationmark.triangle.fill")
                    .font(.callout)
                    .foregroundStyle(loginCompleted ? Color.orange : Color.red)
                    .textSelection(.enabled)
            }

            HStack {
                Spacer()
                Button("取消") {
                    dismiss()
                }
                .keyboardShortcut(.cancelAction)
                .disabled(isLoggingIn)

                Button(loginCompleted ? "完成" : "登录") {
                    if loginCompleted {
                        dismiss()
                    } else {
                        Task { await logIn() }
                    }
                }
                .keyboardShortcut(.defaultAction)
                .disabled(!loginCompleted && !canLogIn)
            }
        }
        .padding(24)
        .frame(width: 520)
        .task {
            loadSavedCredentialOnce()
        }
    }

    private var canLogIn: Bool {
        !isLoggingIn
            && !username.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && !password.isEmpty
            && agreeTerms
    }

    @MainActor
    private func loadSavedCredentialOnce() {
        guard !didLoadSavedCredential else { return }
        didLoadSavedCredential = true
        do {
            guard let credential = try credentialStore.load() else { return }
            username = credential.username
            password = credential.password
            rememberCredential = true
        } catch {
            message = error.localizedDescription
        }
    }

    @MainActor
    private func logIn() async {
        guard canLogIn else { return }
        let normalizedUsername = username.trimmingCharacters(in: .whitespacesAndNewlines)
        isLoggingIn = true
        message = nil

        do {
            try await backend.login(
                username: normalizedUsername,
                password: password,
                agreeTerms: agreeTerms
            )

            do {
                if rememberCredential {
                    try credentialStore.save(SavedLoginCredential(
                        username: normalizedUsername,
                        password: password
                    ))
                } else {
                    try credentialStore.delete()
                }
                password = ""
                dismiss()
            } catch {
                password = ""
                loginCompleted = true
                message = "登录成功，但凭据未能更新：\(error.localizedDescription)"
            }
        } catch {
            password = ""
            message = error.localizedDescription
        }

        isLoggingIn = false
    }
}
