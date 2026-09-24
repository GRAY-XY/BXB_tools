import Foundation

// MARK: - 私信线程视图状态

enum MessagesPhase: Equatable {
    case normal
    case loading
    case empty(reason: String)
    case error(message: String)
}

// MARK: - 私信联系人

struct PrivateContact: Identifiable, Sendable {
    /// 稳定的会话标识（classId + peerId 组合），用于选择与草稿隔离
    let id: String
    let classId: String
    let className: String?
    let peerName: String
    let peerType: String?
    let courseName: String?
    let unreadCount: Int
    let lastContent: String

    /// 后端 get_private_message_thread / send_private_message_text 要求回传完整联系人对象
    let raw: JSONValue

    var subtitle: String {
        courseName ?? className ?? ""
    }

    static func parseList(_ value: JSONValue) -> [PrivateContact] {
        value["contacts"].arrayValue.compactMap { parse($0) }
    }

    static func parse(_ item: JSONValue) -> PrivateContact? {
        let classId = item.firstString("classId")
        let peerId = item.firstString("peerId")
        let backendId = item.firstString("id")
        let stableID = [classId, peerId]
            .filter { !$0.isEmpty }
            .joined(separator: "_")
        guard !stableID.isEmpty || !backendId.isEmpty else { return nil }

        return PrivateContact(
            id: stableID.isEmpty ? backendId : stableID,
            classId: classId,
            className: item["className"].stringValue.nilIfEmpty,
            peerName: item.firstString("peerName").fallback("未知联系人"),
            peerType: item["peerType"].stringValue.nilIfEmpty,
            courseName: item["courseName"].stringValue.nilIfEmpty,
            unreadCount: item["unreadNum"].intValue ?? 0,
            lastContent: item.firstString("lastContent"),
            raw: item
        )
    }
}

// MARK: - 私信消息（严格只读的纯数据）

struct PrivateMessage: Identifiable, Sendable {
    let id: String
    let senderId: String
    let senderName: String
    /// "S" 表示学生；当前用户始终是学生身份
    let senderType: String?
    let content: String
    /// "T" 为文本，其他类型以占位形式展示
    let contentType: String
    let isRevoked: Bool
    let createdAt: Date?

    var isText: Bool { contentType == "T" }

    /// 非文本或已撤回消息的安全占位文案
    var placeholderText: String {
        if isRevoked { return "消息已撤回" }
        switch contentType {
        case "I": return "[图片消息]"
        case "F": return "[文件消息]"
        case "A": return "[语音消息]"
        default: return "[非文本消息]"
        }
    }

    static func parseList(_ value: JSONValue) -> [PrivateMessage] {
        value["messages"].arrayValue.compactMap { parse($0) }
    }

    static func parse(_ item: JSONValue) -> PrivateMessage? {
        let id = item.firstString("id")
        guard !id.isEmpty else { return nil }

        let revocation = item["revocation"].intValue ?? 0
        return PrivateMessage(
            id: id,
            senderId: item.firstString("senderId"),
            senderName: item.firstString("senderName"),
            senderType: item["senderType"].stringValue.nilIfEmpty,
            content: item.firstString("content"),
            contentType: item.firstString("contentType").fallback("T"),
            isRevoked: revocation != 0,
            createdAt: MessageDateParser.parse(item["createTime"])
        )
    }
}

// MARK: - 服务端时间容错解析

enum MessageDateParser {
    /// 办学帮接口的 createTime 可能是毫秒时间戳（数字/纯数字字符串）或格式化字符串
    static func parse(_ value: JSONValue) -> Date? {
        switch value {
        case .number(let number):
            return parseTimestamp(number)
        case .string(let text):
            let trimmed = text.trimmingCharacters(in: .whitespaces)
            guard !trimmed.isEmpty else { return nil }
            if let number = Double(trimmed) {
                return parseTimestamp(number)
            }
            return parseFormatted(trimmed)
        default:
            return nil
        }
    }

    private static func parseTimestamp(_ number: Double) -> Date? {
        // 秒级时间戳（10 位）与毫秒级时间戳（13 位）兼容
        if number > 1_000_000_000_000 {
            return Date(timeIntervalSince1970: number / 1000)
        }
        if number > 1_000_000_000 {
            return Date(timeIntervalSince1970: number)
        }
        return nil
    }

    private static func parseFormatted(_ text: String) -> Date? {
        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = iso.date(from: text) { return date }
        iso.formatOptions = [.withInternetDateTime]
        if let date = iso.date(from: text) { return date }

        let patterns = [
            "yyyy-MM-dd HH:mm:ss",
            "yyyy-MM-dd'T'HH:mm:ss",
            "yyyy-MM-dd HH:mm",
            "yyyy/MM/dd HH:mm:ss",
        ]
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(identifier: "Asia/Shanghai")
        for pattern in patterns {
            formatter.dateFormat = pattern
            if let date = formatter.date(from: text) { return date }
        }
        return nil
    }
}

// MARK: - 文件内字符串容错辅助（与其他 Features 模型文件保持一致的 fileprivate 扩展）

private extension String {
    var nilIfEmpty: String? { isEmpty ? nil : self }

    func fallback(_ value: String) -> String {
        isEmpty ? value : self
    }
}

