import Foundation

enum AppSection: String, CaseIterable, Identifiable {
    case overview
    case homework
    case assistant
    case workspace
    case review
    case messages
    case settings

    var id: Self { self }

    var title: String {
        switch self {
        case .overview: "概览"
        case .homework: "作业"
        case .assistant: "助理"
        case .workspace: "文件"
        case .review: "草稿审核"
        case .messages: "私信"
        case .settings: "设置"
        }
    }

    var symbolName: String {
        switch self {
        case .overview: "rectangle.grid.2x2"
        case .homework: "checklist"
        case .assistant: "sparkles"
        case .workspace: "folder"
        case .review: "doc.text.magnifyingglass"
        case .messages: "bubble.left.and.bubble.right"
        case .settings: "gearshape"
        }
    }

    var summary: String {
        switch self {
        case .overview: "查看当前学期、课程与待办概况。"
        case .homework: "浏览待完成和全部作业，并阅读任务与附件。"
        case .assistant: "结合课程、作业和本地文件完成研究与草稿整理。"
        case .workspace: "管理导入文件、下载附件和助理生成的本地文件。"
        case .review: "在任何真实提交动作之前审核助理生成的草稿。"
        case .messages: "阅读联系人与消息线程；发送动作始终需要用户确认。"
        case .settings: "配置模型服务、登录状态、更新与本地数据。"
        }
    }
}
