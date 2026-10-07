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
    private(set) var attachmentDownloadStates: [String: HomeworkAttachmentDownloadState] = [:]

    var selectedCourseID = "__all_courses__"
    var selectedFilter: HomeworkFilter = .all
    var selectedTaskID: String?

    private var courseRequestID = UUID()
    private var taskRequestID = UUID()
    private var detailRequestID = UUID()

    func loadCourses(using backend: BackendConnectionModel) async {
        guard backend.academicContextReady else { invalidateContext(); return }
        let requestID = UUID()
        let context = backend.contextKey
        courseRequestID = requestID
        isLoadingCourses = true
        errorMessage = nil
        defer { if courseRequestID == requestID && context == backend.contextKey { isLoadingCourses = false } }
        do {
            let result = try await backend.callTool("list_courses")
            guard courseRequestID == requestID, context == backend.contextKey else { return }
            courses = HomeworkCourse.parseList(result)
            if !courses.contains(where: { $0.id == selectedCourseID }) {
                selectedCourseID = courses.first(where: \.allSubjects)?.id ?? courses.first?.id ?? "__all_courses__"
            }
            await loadTasks(using: backend)
        } catch {
            guard courseRequestID == requestID, context == backend.contextKey else { return }
            errorMessage = error.localizedDescription
            courses = []
            tasks = []
            detail = nil
        }
    }

    func loadTasks(using backend: BackendConnectionModel) async {
        guard backend.academicContextReady else { return }
        let context = backend.contextKey
        let requestID = UUID()
        taskRequestID = requestID
        isLoadingTasks = true
        errorMessage = nil
        selectedTaskID = nil
        detailRequestID = UUID()
        isLoadingDetail = false
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
            guard taskRequestID == requestID, context == backend.contextKey else { return }
            tasks = HomeworkTask.parseList(result)
            isLoadingTasks = false
            await backend.refreshSession()
        } catch {
            guard taskRequestID == requestID, context == backend.contextKey else { return }
            isLoadingTasks = false
            tasks = []
            errorMessage = error.localizedDescription
        }
    }

    func loadSelectedTask(using backend: BackendConnectionModel) async {
        let requestID = UUID()
        detailRequestID = requestID
        let context = backend.contextKey
        guard backend.academicContextReady, let selectedTaskID else {
            detail = nil
            isLoadingDetail = false
            return
        }
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
            guard detailRequestID == requestID, context == backend.contextKey, self.selectedTaskID == selectedTaskID else { return }
            detail = HomeworkDetail.parse(result)
            isLoadingDetail = false
        } catch {
            guard detailRequestID == requestID, context == backend.contextKey, self.selectedTaskID == selectedTaskID else { return }
            isLoadingDetail = false
            errorMessage = error.localizedDescription
        }
    }

    func attachmentDownloadState(for attachment: HomeworkAttachment) -> HomeworkAttachmentDownloadState? {
        guard let selectedTaskID else { return nil }
        return attachmentDownloadStates[downloadKey(taskID: selectedTaskID, fileID: attachment.id)]
    }

    func downloadAttachment(_ attachment: HomeworkAttachment, using backend: BackendConnectionModel) async {
        guard let taskID = selectedTaskID, detail?.taskID == taskID else { return }
        let context = backend.contextKey
        let key = downloadKey(taskID: taskID, fileID: attachment.id)
        guard attachmentDownloadStates[key] != .downloading else { return }
        attachmentDownloadStates[key] = .downloading

        do {
            let result = try await backend.callTool(
                "download_task_attachment",
                arguments: [
                    "task_id": .string(taskID),
                    "file_id": .string(attachment.id),
                ]
            )
            guard let downloaded = HomeworkAttachmentDownload.parse(result) else {
                throw BackendBridgeError.protocolFailure("下载结果缺少文件名或保存路径。")
            }
            guard context == backend.contextKey else { return }
            attachmentDownloadStates[key] = .downloaded(downloaded)
        } catch {
            guard context == backend.contextKey else { return }
            attachmentDownloadStates[key] = .failed(error.localizedDescription)
        }
    }

    func invalidateContext() {
        courseRequestID = UUID()
        taskRequestID = UUID()
        detailRequestID = UUID()
        courses = []
        tasks = []
        detail = nil
        selectedCourseID = "__all_courses__"
        selectedTaskID = nil
        attachmentDownloadStates = [:]
        isLoadingCourses = false
        isLoadingTasks = false
        isLoadingDetail = false
        errorMessage = nil
    }

    private func downloadKey(taskID: String, fileID: String) -> String {
        "\(taskID)::\(fileID)"
    }
}
