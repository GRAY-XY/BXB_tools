import Foundation
import Security

struct ModelAPIKeychainStore {
    private let service = "com.grayxy.bxbhomework.macos.model-api-key"

    func load(role: String, providerID: String) throws -> String? {
        var query = baseQuery(role: role, providerID: providerID)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne

        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess else {
            throw ModelAPIKeychainStoreError.security(status)
        }
        guard let data = result as? Data, let value = String(data: data, encoding: .utf8) else {
            throw ModelAPIKeychainStoreError.invalidData
        }
        return value
    }

    func save(_ apiKey: String, role: String, providerID: String) throws {
        let data = Data(apiKey.utf8)
        let attributes: [String: Any] = [
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
        ]
        let query = baseQuery(role: role, providerID: providerID)
        let updateStatus = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
        if updateStatus == errSecSuccess { return }
        guard updateStatus == errSecItemNotFound else {
            throw ModelAPIKeychainStoreError.security(updateStatus)
        }
        var item = query
        item.merge(attributes) { _, new in new }
        let addStatus = SecItemAdd(item as CFDictionary, nil)
        guard addStatus == errSecSuccess else {
            throw ModelAPIKeychainStoreError.security(addStatus)
        }
    }

    func delete(role: String, providerID: String) throws {
        let status = SecItemDelete(baseQuery(role: role, providerID: providerID) as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw ModelAPIKeychainStoreError.security(status)
        }
    }

    private func baseQuery(role: String, providerID: String) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: "\(role):\(providerID)",
        ]
    }
}

private enum ModelAPIKeychainStoreError: LocalizedError {
    case invalidData
    case security(OSStatus)

    var errorDescription: String? {
        switch self {
        case .invalidData:
            "钥匙串中的模型 API Key 格式无效。"
        case .security(let status):
            if let message = SecCopyErrorMessageString(status, nil) as String? {
                "无法访问模型 API Key 钥匙串项：\(message)"
            } else {
                "无法访问模型 API Key 钥匙串项（状态码 \(status)）。"
            }
        }
    }
}
