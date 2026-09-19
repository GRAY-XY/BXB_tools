import Foundation
import Observation

@MainActor
@Observable
final class HomeworkViewModel {
    private(set) var courses: [HomeworkCourse] = []
    private(set) var tasks: [HomeworkTask] = []
    private(set) var detail: HomeworkDetail?
    private(set) var isLoadingCourses = false
    private(set) var isLoadingTasks = false
    private(set) var isLoadingDetail = false
    private(set) var errorMessage: String?

    var selectedCourseID = "__all_courses__"
    var selectedFilter: HomeworkFilter = .all
    var selectedTaskID: String?

    private var taskRequestID = UUID()
    private var detailRequestID = UUID()

    func loadCourses(using backend: BackendConnectionModel) async {
        guard backend.session?.ready == true else {
            courses = []
            tasks = []
            detail = nil
            return
        }

        isLoadingCourses = true
        errorMessage = nil
        defer { isLoadingCourses = false }
        do {
            let result = try await backend.callTool("list_courses")
            courses = HomeworkCourse.parseList(result)
            if !courses.contains(where: { $0.id == selectedCourseID }) {
                selectedCourseID = courses.first(where: \.allSubjects)?.id ?? courses.first?.id ?? "__all_courses__"
            }
            await loadTasks(using: backend)
        } catch {
            errorMessage = error.localizedDescription
            courses = []
            tasks = []
            detail = nil
        }
    }

    func loadTasks(using backend: BackendConnectionModel) async {
        guard backend.session?.ready == true else { return }
        let requestID = UUID()
        taskRequestID = requestID
        isLoadingTasks = true
        errorMessage = nil
        selectedTaskID = nil
        detail = nil

        var arguments: [String: JSONValue] = [
            "list_type": .string(selectedFilter.rawValue),
            "page": .number(1),
            "size": .number(100),
        ]
        if let course = courses.first(where: { $0.id == selectedCourseID }), !course.allSubjects {
            arguments["subject_name"] = .string(course.name)
            if !course.subjectID.isEmpty {
                arguments["subject_id"] = .string(course.subjectID)
            }
            if let classID = course.classID {
                arguments["class_id"] = .string(classID)
            }
        } else {
            arguments["subject_name"] = .string("全部课程")
        }

        do {
            let result = try await backend.callTool("list_tasks", arguments: arguments)
            guard taskRequestID == requestID else { return }
            tasks = HomeworkTask.parseList(result)
            isLoadingTasks = false
            await backend.refreshSession()
        } catch {
            guard taskRequestID == requestID else { return }
            isLoadingTasks = false
            tasks = []
            errorMessage = error.localizedDescription
        }
    }

    func loadSelectedTask(using backend: BackendConnectionModel) async {
        guard let selectedTaskID else {
            detail = nil
            return
        }
        let requestID = UUID()
        detailRequestID = requestID
        isLoadingDetail = true
        errorMessage = nil
        detail = nil

        do {
            let result = try await backend.callTool(
                "read_task_content",
                arguments: [
                    "task_id": .string(selectedTaskID),
                    "max_chars": .number(6_000),
                ]
            )
            guard detailRequestID == requestID else { return }
            detail = HomeworkDetail.parse(result)
            isLoadingDetail = false
        } catch {
            guard detailRequestID == requestID else { return }
            isLoadingDetail = false
            errorMessage = error.localizedDescription
        }
    }
}
