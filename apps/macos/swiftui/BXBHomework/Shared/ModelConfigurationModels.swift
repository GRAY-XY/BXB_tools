import Foundation

@MainActor
protocol ModelAPIKeyStore {
    func load(role: String, providerID: String) throws -> String?
    func save(_ apiKey: String, role: String, providerID: String) throws
    func delete(role: String, providerID: String) throws
}

struct ModelProvider: Identifiable, Equatable {
    let id: String
    let name: String
    let type: String
    let baseURL: String
    let modelName: String
    let hasAPIKey: Bool
    let availableModels: [String]

    init(_ value: JSONValue) {
        id = value.firstString("id", "providerId")
        name = value.firstString("name", "providerName").isEmpty ? "默认提供商" : value.firstString("name", "providerName")
        type = value.firstString("type", "providerType").isEmpty ? "openai" : value.firstString("type", "providerType")
        baseURL = value.firstString("baseUrl", "apiBaseUrl")
        modelName = value.firstString("modelName", "model")
        hasAPIKey = value["hasApiKey"].boolValue ?? false
        availableModels = value["availableModels"].arrayValue.map(\.stringValue).filter { !$0.isEmpty }
    }
}

struct ModelProviderPreset: Identifiable {
    let id: String
    let name: String
    let baseURL: String
    let model: String
    static let all = [
        Self(id: "moonshot", name: "Moonshot", baseURL: "https://api.moonshot.cn/v1", model: "kimi-k2.5"),
        Self(id: "deepseek", name: "DeepSeek", baseURL: "https://api.deepseek.com/v1", model: "deepseek-chat"),
        Self(id: "openai", name: "OpenAI", baseURL: "https://api.openai.com/v1", model: "gpt-4o-mini"),
        Self(id: "qwen", name: "通义千问", baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1", model: "qwen-plus"),
        Self(id: "custom", name: "自定义 OpenAI 兼容", baseURL: "", model: ""),
    ]
}

struct ModelSetupCandidate: Equatable {
    var providerID: String
    var name: String
    var type: String
    var baseURL: String
    var modelName: String
    var providerJSON: JSONValue {
        .object(["id": .string(providerID), "name": .string(name), "type": .string(type),
                 "baseUrl": .string(baseURL), "modelName": .string(modelName)])
    }
    static func validEndpoint(_ value: String) -> Bool {
        guard let url = URL(string: value), ["http", "https"].contains(url.scheme?.lowercased() ?? ""),
              let host = url.host, !host.isEmpty, url.user == nil, url.password == nil,
              url.query == nil, url.fragment == nil else { return false }
        return true
    }
}

enum SetupConfigurationError: LocalizedError {
    case message(String)
    var errorDescription: String? { switch self { case .message(let text): text } }
}
