import Foundation

@main
struct AcademicContextSmoke {
    @MainActor
    static func main() async throws {
        let root = URL(filePath: FileManager.default.currentDirectoryPath)
        let client = NodeBackendClient(bridgeScriptOverride: root.appending(path: "apps/macos/swiftui/Runtime/AcademicContextFixture.js"))
        let backend = BackendConnectionModel(client: client)
        await backend.connect()
        await backend.loadTerms()
        precondition(backend.session?.currentTermName == "Term A")
        precondition(backend.pendingHomeworkCount == 4, "Must use the actual summary, not per-course 99")
        await backend.switchTerm(termID: "2")
        precondition(backend.session?.currentTermName == "Term B")
        precondition(backend.pendingHomeworkCount == 2)
        precondition(backend.academicContextReady)

        // A definite failure preserves the real old selection.
        _ = try await backend.invoke("fixture.failSwitch", params: ["mode": .string("rejected")])
        await backend.switchTerm(termID: "1")
        precondition(backend.session?.currentTermId == "2" && backend.termErrorMessage != nil)
        precondition(backend.academicContextReady)

        // A lost response after commit must recover the actual new selection.
        _ = try await backend.invoke("fixture.failSwitch", params: ["mode": .string("committed")])
        await backend.switchTerm(termID: "1")
        precondition(backend.session?.currentTermId == "1")
        precondition(backend.academicContextReady && !backend.isSwitchingTerm)

        // If even session recovery fails, don't offer stale academic data.
        _ = try await backend.invoke("fixture.failSwitch", params: ["mode": .string("unknown")])
        await backend.switchTerm(termID: "2")
        precondition(!backend.academicContextReady)
        _ = try await backend.invoke("fixture.recover")
        await backend.refreshSession()
        precondition(backend.session?.currentTermId == "2" && backend.academicContextReady)

        let model = HomeworkViewModel()
        await model.loadCourses(using: backend)
        precondition(model.tasks.first?.id == "task-2")
        _ = try await backend.invoke("fixture.hold", params: ["kind": .string("courses")])
        let oldLoad = Task { await model.loadCourses(using: backend) }
        _ = try await backend.invoke("fixture.awaitHeld", params: ["kind": .string("courses")])
        // The real UI cannot start a switch while an account read is pending.
        await backend.switchTerm(termID: "1")
        precondition(backend.session?.currentTermId == "2")
        // An external session refresh can still expose a new context.
        _ = try await backend.invoke("fixture.forceTerm", params: ["termId": .string("1")])
        await backend.refreshSession()
        model.invalidateContext()
        await model.loadCourses(using: backend)
        _ = try await backend.invoke("fixture.release", params: ["kind": .string("courses")])
        await oldLoad.value
        precondition(model.courses.last?.subjectID == "course-1")
        precondition(model.tasks.first?.id == "task-1")
        precondition(!model.isLoadingCourses)

        model.selectedTaskID = "task-1"
        _ = try await backend.invoke("fixture.hold", params: ["kind": .string("detail")])
        let oldDetail = Task { await model.loadSelectedTask(using: backend) }
        _ = try await backend.invoke("fixture.awaitHeld", params: ["kind": .string("detail")])
        model.selectedTaskID = nil
        await model.loadSelectedTask(using: backend)
        _ = try await backend.invoke("fixture.release", params: ["kind": .string("detail")])
        await oldDetail.value
        precondition(model.detail == nil && !model.isLoadingDetail, "Deselection must discard the late detail")
        let drafts = DraftViewModel()
        drafts.selectedDraftID = "draft-1"
        await drafts.loadSelectedDraft(using: backend)
        await drafts.prepareSubmission(using: backend)
        precondition(drafts.submissionPreview != nil)
        drafts.editableText = "Unsaved local edits"
        drafts.editableSummary = "Unsaved summary"
        drafts.invalidateDeliveryPreview()
        precondition(drafts.submissionPreview == nil && drafts.privateMessagePreview == nil)
        precondition(drafts.editableText == "Unsaved local edits" && drafts.editableSummary == "Unsaved summary")
        _ = try await backend.invoke("fixture.forceTerm", params: ["termId": .string("2")])
        await model.loadCourses(using: backend)
        precondition(backend.session?.currentTermId == "2", "Adopt a server-changed term before displaying its courses")
        model.invalidateContext()
        await model.loadCourses(using: backend)
        precondition(model.courses.last?.subjectID == "course-2" && backend.pendingHomeworkCount == 2)
        print("academic-context=ok switch failure recovery pending-count stale-courses stale-detail activity-guard preserve-draft-edits server-context-change")
    }
}
