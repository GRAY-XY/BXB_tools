import Foundation

@main
struct LoginKeychainSmoke {
    static func main() throws {
        let suite = "com.grayxy.bxbhomework.fixture-login-" + UUID().uuidString
        setenv("BXB_TEST_KEYCHAIN_SERVICE", suite, 1)
        defer { unsetenv("BXB_TEST_KEYCHAIN_SERVICE") }
        let fixture = KeychainCredentialStore(service: suite + ".login-credentials")
        let other = KeychainCredentialStore(service: suite + ".other")
        defer { try? fixture.delete(); try? other.delete() }
        try fixture.save(SavedLoginCredential(username: "fixture-user", password: "fixture-login-password"))
        let loaded = try KeychainCredentialStore().load()
        precondition(loaded?.username == "fixture-user" && loaded?.password == "fixture-login-password",
                     "test environment must use the dedicated login service")
        let unrelated = try other.load()
        precondition(unrelated == nil, "another Keychain service must not see fixture credentials")
        try fixture.delete()
        let removed = try KeychainCredentialStore().load()
        precondition(removed == nil)
        print("login-keychain=ok isolated-test-service roundtrip cleanup")
    }
}
