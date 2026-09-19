import SwiftUI

struct HomeworkView: View {
    @Environment(BackendConnectionModel.self) private var backend
    @State private var model = HomeworkViewModel()
    @State private var showingLogin = false

    var body: some View {
        @Bindable var model = model

        VStack(spacing: 0) {
            header
                .padding(.horizontal, 24)
                .padding(.vertical, 18)

            Divider()

            if backend.session?.ready != true {
                loginRequired
            } else {
                controls
                    .padding(.horizontal, 20)
                    .padding(.vertical, 12)

                Divider()
                homeworkBrowser
            }
        }
        .navigationTitle("作业")
        .sheet(isPresented: $showingLogin) {
            LoginView()
                .environment(backend)
        }
        .task(id: backend.session?.ready) {
            if backend.session?.ready == true {
                await model.loadCourses(using: backend)
            }
        }
        .onChange(of: model.selectedCourseID) {
            Task { await model.loadTasks(using: backend) }
        }
        .onChange(of: model.selectedFilter) {
            Task { await model.loadTasks(using: backend) }
        }
        .onChange(of: model.selectedTaskID) {
            Task { await model.loadSelectedTask(using: backend) }
        }
    }

    private var header: some View {
        HStack(spacing: 14) {
            Image(systemName: "checklist")
                .font(.system(size: 25, weight: .medium))
                .foregroundStyle(.tint)
                .frame(width: 48, height: 48)
                .background(.tint.opacity(0.12), in: RoundedRectangle(cornerRadius: 12))
            VStack(alignment: .leading, spacing: 3) {
                Text("作业中心")
                    .font(.title2.bold())
                Text("选择课程和筛选条件，查看作业正文、参考内容与附件信息。")
                    .foregroundStyle(.secondary)
            }
            Spacer()
        }
    }

    private var loginRequired: some View {
        ContentUnavailableView {
            Label("需要登录办学帮", systemImage: "person.crop.circle.badge.exclamationmark")
        } description: {
            Text("登录后才能读取课程和作业。")
        } actions: {
            Button("登录办学帮") {
                showingLogin = true
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var controls: some View {
        HStack(spacing: 12) {
            Picker("课程", selection: Binding(
                get: { model.selectedCourseID },
                set: { model.selectedCourseID = $0 }
            )) {
                ForEach(model.courses) { course in
                    Text(courseLabel(course)).tag(course.id)
                }
            }
            .frame(maxWidth: 320)
            .disabled(model.isLoadingCourses || model.courses.isEmpty)

            Picker("筛选", selection: Binding(
                get: { model.selectedFilter },
                set: { model.selectedFilter = $0 }
            )) {
                ForEach(HomeworkFilter.allCases) { filter in
                    Text(filter.title).tag(filter)
                }
            }
            .pickerStyle(.segmented)
            .frame(width: 210)

            Spacer()

            if model.isLoadingCourses || model.isLoadingTasks {
                ProgressView()
                    .controlSize(.small)
            }

            Button {
                Task { await model.loadCourses(using: backend) }
            } label: {
                Label("刷新", systemImage: "arrow.clockwise")
            }
            .disabled(model.isLoadingCourses || model.isLoadingTasks)
        }
    }

    private var homeworkBrowser: some View {
        HSplitView {
            taskList
                .frame(minWidth: 300, idealWidth: 360, maxWidth: 460)
            detailPane
                .frame(minWidth: 440, maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    private var taskList: some View {
        VStack(spacing: 0) {
            HStack {
                Text("作业")
                    .font(.headline)
                Spacer()
                Text("\(model.tasks.count) 项")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)

            Divider()

            if model.isLoadingTasks && model.tasks.isEmpty {
                ProgressView("正在读取作业…")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if let error = model.errorMessage, model.tasks.isEmpty {
                ContentUnavailableView(
                    "无法读取作业",
                    systemImage: "exclamationmark.triangle",
                    description: Text(error)
                )
            } else if model.tasks.isEmpty {
                ContentUnavailableView(
                    "暂无作业",
                    systemImage: "checkmark.circle",
                    description: Text("当前课程和筛选条件下没有作业。")
                )
            } else {
                List(model.tasks, selection: Binding(
                    get: { model.selectedTaskID },
                    set: { model.selectedTaskID = $0 }
                )) { task in
                    HomeworkTaskRow(task: task)
                        .tag(task.id)
                }
                .listStyle(.sidebar)
            }
        }
    }

    @ViewBuilder
    private var detailPane: some View {
        if model.isLoadingDetail {
            ProgressView("正在读取作业详情…")
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if let detail = model.detail {
            HomeworkDetailView(detail: detail)
        } else if let error = model.errorMessage, model.selectedTaskID != nil {
            ContentUnavailableView(
                "无法读取详情",
                systemImage: "exclamationmark.triangle",
                description: Text(error)
            )
        } else {
            ContentUnavailableView(
                "选择一项作业",
                systemImage: "doc.text.magnifyingglass",
                description: Text("从左侧列表选择作业以读取详情。")
            )
        }
    }

    private func courseLabel(_ course: HomeworkCourse) -> String {
        guard let pendingCount = course.pendingCount, pendingCount > 0 else { return course.name }
        return "\(course.name)（待处理 \(pendingCount)）"
    }
}

private struct HomeworkTaskRow: View {
    let task: HomeworkTask

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(task.title)
                .fontWeight(.semibold)
                .lineLimit(2)
            if !task.courseName.isEmpty {
                Text(task.courseName)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            HStack(spacing: 8) {
                if !task.deadline.isEmpty {
                    Label(task.deadline, systemImage: "calendar")
                        .lineLimit(1)
                }
                Spacer(minLength: 0)
                if !task.status.isEmpty {
                    Text(task.status)
                        .padding(.horizontal, 7)
                        .padding(.vertical, 2)
                        .background(.quaternary, in: Capsule())
                }
            }
            .font(.caption2)
            .foregroundStyle(.secondary)
        }
        .padding(.vertical, 5)
    }
}

private struct HomeworkDetailView: View {
    let detail: HomeworkDetail

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                VStack(alignment: .leading, spacing: 5) {
                    Text(detail.title)
                        .font(.title2.bold())
                        .textSelection(.enabled)
                    if !detail.courseName.isEmpty {
                        Text(detail.courseName)
                            .foregroundStyle(.secondary)
                    }
                }

                GroupBox("基本信息") {
                    Grid(alignment: .leading, horizontalSpacing: 18, verticalSpacing: 9) {
                        metadataRow("截止时间", detail.deadline)
                        metadataRow("发布时间", detail.releaseTime)
                        metadataRow("发布人", detail.creator)
                        metadataRow("状态", detail.status)
                        metadataRow("评分方式", detail.scoreType)
                        metadataRow("Task ID", detail.taskID)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.vertical, 5)
                }

                textSection("作业内容", text: detail.content, emptyText: "暂无可读取正文。")

                GroupBox("附件") {
                    if detail.attachments.isEmpty {
                        Text("暂无附件。")
                            .foregroundStyle(.secondary)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.vertical, 6)
                    } else {
                        VStack(spacing: 0) {
                            ForEach(Array(detail.attachments.enumerated()), id: \.element.id) { index, attachment in
                                if index > 0 { Divider() }
                                HStack(spacing: 12) {
                                    Image(systemName: "paperclip")
                                        .foregroundStyle(.tint)
                                    VStack(alignment: .leading, spacing: 3) {
                                        Text(attachment.name)
                                            .fontWeight(.semibold)
                                        Text(attachment.metadata)
                                            .font(.caption)
                                            .foregroundStyle(.secondary)
                                    }
                                    Spacer()
                                }
                                .padding(.vertical, 9)
                            }
                        }
                    }
                }

                if !detail.answer.isEmpty {
                    textSection("参考内容 / 答案", text: detail.answer, emptyText: "")
                }

                GroupBox("读取状态") {
                    Grid(alignment: .leading, horizontalSpacing: 18, verticalSpacing: 9) {
                        metadataRow("作业正文字数", detail.contentLength.map(String.init) ?? "—")
                        metadataRow("参考内容字数", detail.answerLength.map(String.init) ?? "—")
                        metadataRow("正文是否截断", detail.contentTruncated ? "是" : "否")
                        metadataRow("参考是否截断", detail.answerTruncated ? "是" : "否")
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.vertical, 5)
                }
            }
            .padding(20)
            .frame(maxWidth: 820, alignment: .leading)
        }
    }

    private func metadataRow(_ label: String, _ value: String) -> some View {
        GridRow {
            Text(label)
                .foregroundStyle(.secondary)
            Text(value.isEmpty ? "—" : value)
                .textSelection(.enabled)
        }
    }

    private func textSection(_ title: String, text: String, emptyText: String) -> some View {
        GroupBox(title) {
            Text(text.isEmpty ? emptyText : text)
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.vertical, 6)
        }
    }
}
