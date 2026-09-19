import Foundation

enum HomeworkFilter: String, CaseIterable, Identifiable {
    case all
    case pending

    var id: Self { self }

    var title: String {
        switch self {
        case .all: "全部作业"
        case .pending: "待处理"
        }
    }
}

struct HomeworkCourse: Identifiable, Hashable, Sendable {
    let id: String
    let subjectID: String
    let classID: String?
    let name: String
    let pendingCount: Int?
    let allSubjects: Bool

    static func parseList(_ value: JSONValue) -> [HomeworkCourse] {
        value["courses"].arrayValue.compactMap { item -> HomeworkCourse? in
            let subjectID = item.firstString("id", "courseId")
            let name = item.firstString("name", "cnName")
            guard !name.isEmpty else { return nil }
            let classID = item.firstString("classId").nilIfEmpty
            let allSubjects = item["allSubjects"].boolValue ?? (name == "全部课程")
            let stableID = allSubjects ? "__all_courses__" : "\(subjectID):\(classID ?? "")"
            return HomeworkCourse(
                id: stableID,
                subjectID: subjectID,
                classID: classID,
                name: name,
                pendingCount: item["unSubmitCount"].intValue,
                allSubjects: allSubjects
            )
        }
    }
}

struct HomeworkTask: Identifiable, Hashable, Sendable {
    let id: String
    let title: String
    let courseName: String
    let deadline: String
    let status: String

    static func parseList(_ value: JSONValue) -> [HomeworkTask] {
        let keys = [
            "pendingHomeworkList",
            "unsubmittedHomeworkList",
            "homeworkList",
            "tasks",
            "items",
            "records",
        ]
        var seen = Set<String>()
        var tasks: [HomeworkTask] = []

        for item in keys.flatMap({ value[$0].arrayValue }) {
            let id = item.firstString("task_id", "taskId", "id", "activityId")
            guard !id.isEmpty, seen.insert(id).inserted else { continue }
            let participation = item["isParticipate"].boolValue
            let fallbackStatus = participation == true ? "已完成" : participation == false ? "待处理" : ""
            tasks.append(HomeworkTask(
                id: id,
                title: item.firstString("name", "title", "activityName", "taskTitle").fallback("未命名作业"),
                courseName: item.firstString("course", "subjectName", "subject", "courseName"),
                deadline: item.firstString("deadline", "endTime", "endDate"),
                status: item.firstString("__statusText", "statusText", "score", "level", "scoreLevel", "scoreTypeName")
                    .fallback(fallbackStatus)
            ))
        }
        return tasks
    }
}

struct HomeworkAttachment: Identifiable, Hashable, Sendable {
    let id: String
    let name: String
    let source: String
    let fileExtension: String
    let size: String
    let createTime: String

    var sourceLabel: String {
        switch source {
        case "task": "作业附件"
        case "reference": "参考附件"
        case "my-submission": "我的提交"
        case "submitted": "其他提交"
        default: source.fallback("附件")
        }
    }

    var metadata: String {
        [
            sourceLabel,
            fileExtension.isEmpty ? nil : fileExtension,
            size.isEmpty ? nil : "\(size) bytes",
            createTime.isEmpty ? nil : createTime,
        ]
        .compactMap { $0 }
        .joined(separator: " · ")
    }
}

struct HomeworkDetail: Sendable {
    let taskID: String
    let title: String
    let courseName: String
    let deadline: String
    let releaseTime: String
    let creator: String
    let status: String
    let scoreType: String
    let content: String
    let answer: String
    let attachments: [HomeworkAttachment]
    let contentLength: Int?
    let answerLength: Int?
    let contentTruncated: Bool
    let answerTruncated: Bool

    static func parse(_ value: JSONValue) -> HomeworkDetail {
        let summary = value["taskSummary"]
        let taskID = value.firstString("taskId").fallback(summary.firstString("id"))
        let participation = summary["isParticipate"].boolValue
        let fallbackStatus = participation == true ? "已完成" : participation == false ? "待处理" : ""
        let attachments = value["attachments"].arrayValue.compactMap { item -> HomeworkAttachment? in
            let fileID = item.firstString("fileId", "correctFileId", "id")
            guard !fileID.isEmpty else { return nil }
            return HomeworkAttachment(
                id: fileID,
                name: item.firstString("name", "fileName", "filename", "originalFileName").fallback("未命名附件"),
                source: item.firstString("source"),
                fileExtension: item.firstString("fileExt", "ext"),
                size: item.firstString("fileSize", "size", "sizeBytes"),
                createTime: item.firstString("createTime", "uploaddate")
            )
        }

        return HomeworkDetail(
            taskID: taskID,
            title: summary.firstString("activityName", "title", "name").fallback("未命名作业"),
            courseName: summary.firstString("courseName").fallback(value["context"]["currentSubject"].firstString("name")),
            deadline: summary.firstString("endTime", "deadline", "endDate"),
            releaseTime: summary.firstString("releaseTime").fallback(value.firstString("releaseTime", "createTime")),
            creator: summary.firstString("createName").fallback(value.firstString("teacherName", "creatorName")),
            status: summary.firstString("__statusText", "statusText", "score", "scoreLevel").fallback(fallbackStatus),
            scoreType: summary.firstString("scoreTypeName", "scoreCategory", "homeworkType"),
            content: value.firstString("content", "readableText", "text", "taskText"),
            answer: value.firstString("answer", "answerText", "referenceAnswer"),
            attachments: attachments,
            contentLength: value["contentLength"].intValue,
            answerLength: value["answerLength"].intValue,
            contentTruncated: value["contentTruncated"].boolValue ?? false,
            answerTruncated: value["answerTruncated"].boolValue ?? false
        )
    }
}

private extension String {
    var nilIfEmpty: String? { isEmpty ? nil : self }

    func fallback(_ value: String) -> String {
        isEmpty ? value : self
    }
}
