import Foundation
import Security

struct SavedLoginCredential: Codable, Sendable {
    let username: String
    let password: String
}

enum KeychainCredentialStoreError: LocalizedError {
    case unexpectedData
    case security(OSStatus)

    var errorDescription: String? {
        switch self {
        case .unexpectedData:
            "钥匙串中的登录凭据格式无效。"
        case .security(let status):
            if let message = SecCopyErrorMessageString(status, nil) as String? {
                "钥匙串操作失败：\(message)"
            } else {
                "钥匙串操作失败（状态码 \(status)）。"
            }
        }
    }
}

struct KeychainCredentialStore {
    private let service = "com.grayxy.bxbhomework.macos.banxuebang"
    private let account = "default"

    func load() throws -> SavedLoginCredential? {
        var query = baseQuery
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne

        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound {
            return nil
        }
        guard status == errSecSuccess else {
            throw KeychainCredentialStoreError.security(status)
        }
        guard let data = result as? Data else {
            throw KeychainCredentialStoreError.unexpectedData
        }

        do {
            return try JSONDecoder().decode(SavedLoginCredential.self, from: data)
        } catch {
            throw KeychainCredentialStoreError.unexpectedData
        }
    }

    func save(_ credential: SavedLoginCredential) throws {
        let data = try JSONEncoder().encode(credential)
        let attributes: [String: Any] = [
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
        ]

        let updateStatus = SecItemUpdate(baseQuery as CFDictionary, attributes as CFDictionary)
        if updateStatus == errSecSuccess {
            return
        }
        guard updateStatus == errSecItemNotFound else {
            throw KeychainCredentialStoreError.security(updateStatus)
        }

        var item = baseQuery
        item.merge(attributes) { _, new in new }
        let addStatus = SecItemAdd(item as CFDictionary, nil)
        guard addStatus == errSecSuccess else {
            throw KeychainCredentialStoreError.security(addStatus)
        }
    }

    func delete() throws {
        let status = SecItemDelete(baseQuery as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw KeychainCredentialStoreError.security(status)
        }
    }

    private var baseQuery: [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
    }
}
