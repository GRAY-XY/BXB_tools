import Foundation

@main
struct HomeworkParsingSmoke {
    static func main() throws {
        let courses = try decode(#"""
        {
          "courses": [
            {"id": "__all__", "name": "全部课程", "allSubjects": true},
            {"id": 42, "classId": "7", "name": "物理", "unSubmitCount": 2}
          ]
        }
        """#)
        let parsedCourses = HomeworkCourse.parseList(courses)
        precondition(parsedCourses.count == 2)
        precondition(parsedCourses[0].allSubjects)
        precondition(parsedCourses[1].subjectID == "42")
        precondition(parsedCourses[1].pendingCount == 2)

        let tasks = try decode(#"""
        {
          "pendingHomeworkList": [
            {"id": 9, "activityName": "实验报告", "courseName": "物理", "isParticipate": 0}
          ],
          "homeworkList": [
            {"id": 9, "activityName": "实验报告", "courseName": "物理"},
            {"id": "10", "activityName": "阅读", "courseName": "语文", "statusText": "已完成"}
          ]
        }
        """#)
        let parsedTasks = HomeworkTask.parseList(tasks)
        precondition(parsedTasks.count == 2)
        precondition(parsedTasks[0].status == "待处理")

        let detail = try decode(#"""
        {
          "taskId": 9,
          "taskSummary": {
            "activityName": "实验报告",
            "courseName": "物理",
            "isParticipate": false
          },
          "content": "记录实验结果。",
          "contentLength": 7,
          "contentTruncated": false,
          "attachments": [
            {"fileId": 88, "fileName": "要求.pdf", "fileExt": "pdf", "source": "task"}
          ]
        }
        """#)
        let parsedDetail = HomeworkDetail.parse(detail)
        precondition(parsedDetail.taskID == "9")
        precondition(parsedDetail.status == "待处理")
        precondition(parsedDetail.attachments.first?.name == "要求.pdf")

        print("homework-parsing=ok courses=\(parsedCourses.count) tasks=\(parsedTasks.count) attachments=\(parsedDetail.attachments.count)")
    }

    private static func decode(_ text: String) throws -> JSONValue {
        try JSONDecoder().decode(JSONValue.self, from: Data(text.utf8))
    }
}
