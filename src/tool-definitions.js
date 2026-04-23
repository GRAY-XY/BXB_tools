import * as z from "zod/v4";

export function createToolDefinitions(client) {
  return [
    {
      name: "list_terms",
      description: "List the terms available in the current Banxuebang session.",
      inputSchema: {},
      execute: async () => client.listTerms(),
    },
    {
      name: "list_courses",
      description: "List the courses available in the current Banxuebang term and class context.",
      inputSchema: {},
      execute: async () => client.listCourses(),
    },
    {
      name: "session_status",
      description:
        "Show whether the Banxuebang session is ready and which term/class/subject are selected.",
      inputSchema: {},
      execute: async () => {
        const session = await client.getSession();
        return client.summarizeSession(session);
      },
    },
    {
      name: "interactive_login",
      description:
        "Launch a real browser for manual Banxuebang login, capture localStorage after login, and persist the session for later tools.",
      inputSchema: {
        headless: z.boolean().optional().describe("Defaults to false. Keep false for manual login."),
        timeout_ms: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("How long to wait for login completion. Default 300000."),
      },
      execute: async ({ headless, timeout_ms: timeoutMs }) =>
        client.interactiveLogin({
          headless: headless ?? false,
          timeoutMs: timeoutMs ?? 300000,
        }),
    },
    {
      name: "login_in_browser",
      description:
        "Launch a real browser for manual Banxuebang login, then capture localStorage and persist the session. This is a clearer alias for first-time login.",
      inputSchema: {
        headless: z.boolean().optional().describe("Defaults to false. Keep false for manual login."),
        timeout_ms: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("How long to wait for login completion. Default 300000."),
      },
      execute: async ({ headless, timeout_ms: timeoutMs }) =>
        client.interactiveLogin({
          headless: headless ?? false,
          timeoutMs: timeoutMs ?? 300000,
        }),
    },
    {
      name: "login_with_credentials",
      description:
        "Open the Banxuebang login page in a real browser, fill username/password, optionally tick the agreement checkbox, submit, and capture the resulting session.",
      inputSchema: {
        username: z.string().describe("Banxuebang account / login name."),
        password: z.string().describe("Banxuebang password."),
        headless: z
          .boolean()
          .optional()
          .describe("Defaults to false so the user can see the browser if anything unexpected appears."),
        timeout_ms: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("How long to wait for login success. Default 60000."),
        agree_terms: z
          .boolean()
          .optional()
          .describe("Whether to auto-tick the agreement checkbox before login. Default true."),
      },
      execute: async ({ username, password, headless, timeout_ms: timeoutMs, agree_terms: agreeTerms }) =>
        client.loginWithCredentials({
          username,
          password,
          headless: headless ?? false,
          timeoutMs: timeoutMs ?? 60000,
          agreeTerms: agreeTerms ?? true,
        }),
    },
    {
      name: "import_browser_storage",
      description:
        "Import a Banxuebang browser localStorage dump. Expected keys include tokens, userInfo, curClass, currTermId, and curSubject.",
      inputSchema: {
        storage_json: z
          .string()
          .describe("A JSON object string containing browser localStorage values."),
      },
      execute: async ({ storage_json: storageJson }) => client.importBrowserStorage(storageJson),
    },
    {
      name: "refresh_context",
      description:
        "Refresh term/class/subject context from Banxuebang APIs using the current session token.",
      inputSchema: {},
      execute: async () => client.refreshContext(),
    },
    {
      name: "set_current_term",
      description: "Switch the current term by id or name and refresh the subject list for that term.",
      inputSchema: {
        term_id: z.union([z.string(), z.number()]).optional().describe("Target term id."),
        term_name: z.string().optional().describe("Target term name, for example 2025-2026下学期."),
      },
      execute: async ({ term_id: termId, term_name: termName }) => {
        if (termId !== undefined) {
          return client.setCurrentTerm(termId);
        }

        if (termName) {
          return client.setCurrentTermByName(termName);
        }

        throw new Error("Provide either term_id or term_name.");
      },
    },
    {
      name: "set_current_subject",
      description: "Switch the current subject by id or course name for homework and achievement tools.",
      inputSchema: {
        subject_id: z.union([z.string(), z.number()]).optional().describe("Target subject id."),
        subject_name: z.string().optional().describe("Target course name, for example 国际公民素养."),
        class_id: z
          .union([z.string(), z.number()])
          .optional()
          .describe("Optional class id when the same subject id exists under multiple classes."),
      },
      execute: async ({ subject_id: subjectId, subject_name: subjectName, class_id: classId }) => {
        if (subjectId !== undefined) {
          return client.setCurrentSubject(subjectId, classId);
        }

        if (subjectName) {
          return client.setCurrentSubjectByName(subjectName, classId);
        }

        throw new Error("Provide either subject_id or subject_name.");
      },
    },
    {
      name: "list_homework",
      description:
        "Read the 学业 tab data behind achievement_list, including unsubmitted homework and homework pages.",
      inputSchema: {
        list_type: z
          .enum(["all", "latest", "pending"])
          .optional()
          .describe('Filter mode. "all" maps to 全部, "latest" to 最新, "pending" to 待处理.'),
        page: z.number().int().positive().optional().describe("Page number. Default 1."),
        size: z.number().int().positive().optional().describe("Page size. Default 10."),
      },
      execute: async ({ list_type: listType, page, size }) =>
        client.listHomework({
          listType: listType ?? "all",
          page: page ?? 1,
          size: size ?? 10,
        }),
    },
    {
      name: "list_tasks",
      description:
        "List tasks for the current subject. This is an alias of list_homework for AI clients that prefer task wording.",
      inputSchema: {
        term_id: z.union([z.string(), z.number()]).optional().describe("Optional term id override."),
        term_name: z.string().optional().describe("Optional term name override."),
        subject_id: z
          .union([z.string(), z.number()])
          .optional()
          .describe("Optional subject id override."),
        subject_name: z.string().optional().describe("Optional subject name override."),
        class_id: z
          .union([z.string(), z.number()])
          .optional()
          .describe("Optional class id override when multiple classes share a subject."),
        list_type: z
          .enum(["all", "latest", "pending"])
          .optional()
          .describe('Filter mode. "all" maps to 全部, "latest" to 最新, "pending" to 待处理.'),
        page: z.number().int().positive().optional().describe("Page number. Default 1."),
        size: z.number().int().positive().optional().describe("Page size. Default 10."),
      },
      execute: async ({
        term_id: termId,
        term_name: termName,
        subject_id: subjectId,
        subject_name: subjectName,
        class_id: classId,
        list_type: listType,
        page,
        size,
      }) =>
        client.listTasks({
          termId,
          termName,
          subjectId,
          subjectName,
          classId,
          listType: listType ?? "all",
          page: page ?? 1,
          size: size ?? 10,
        }),
    },
    {
      name: "get_achievement_overview",
      description:
        "Read the 成绩 tab data behind achievement_list, including average GPA level, score groups, transfer class options, and chart records.",
      inputSchema: {
        transfer_class_id: z
          .union([z.string(), z.number()])
          .optional()
          .describe("Optional transfer class record id to inspect. Defaults to the last record used by the page."),
      },
      execute: async ({ transfer_class_id: transferClassId }) =>
        client.getAchievementOverview({ transferClassId }),
    },
    {
      name: "get_current_subject_gpa",
      description: "Get the average GPA level for the current subject, plus the active transfer-class record.",
      inputSchema: {},
      execute: async () => client.getCurrentSubjectGpa(),
    },
    {
      name: "open_task",
      description:
        "Open a Banxuebang task by id and return its detail, attachments, and current submission state.",
      inputSchema: {
        task_id: z.union([z.string(), z.number()]).describe("Activity/task id."),
        include_other_submissions: z
          .boolean()
          .optional()
          .describe("Whether to include the submission status list of other students. Default false."),
      },
      execute: async ({ task_id: taskId, include_other_submissions: includeOtherSubmissions }) =>
        client.getTaskDetail(taskId, { includeOtherSubmissions: includeOtherSubmissions ?? false }),
    },
    {
      name: "read_task_content",
      description: "Read the text content of a task, including answer/reference text when available.",
      inputSchema: {
        task_id: z.union([z.string(), z.number()]).describe("Activity/task id."),
        max_chars: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Maximum number of characters to return per text field. Default 4000."),
      },
      execute: async ({ task_id: taskId, max_chars: maxChars }) =>
        client.readTaskContent(taskId, maxChars ?? 4000),
    },
    {
      name: "download_task_attachment",
      description: "Download an attachment from a task to the local workspace.",
      inputSchema: {
        task_id: z
          .union([z.string(), z.number()])
          .optional()
          .describe("Optional task id used to validate that the attachment belongs to the task."),
        file_id: z.union([z.string(), z.number()]).describe("Attachment file id."),
        directory: z
          .string()
          .optional()
          .describe("Optional destination directory. Default is ./.banxuebang/downloads"),
      },
      execute: async ({ task_id: taskId, file_id: fileId, directory }) =>
        client.downloadTaskAttachment({ taskId, fileId, directory }),
    },
    {
      name: "read_task_attachment",
      description:
        "Download a task attachment if needed and extract readable text from supported file types like txt, html, pdf, and docx.",
      inputSchema: {
        task_id: z
          .union([z.string(), z.number()])
          .optional()
          .describe("Optional task id used to validate that the attachment belongs to the task."),
        file_id: z.union([z.string(), z.number()]).describe("Attachment file id."),
        max_chars: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Maximum number of characters to return. Default 4000."),
        directory: z
          .string()
          .optional()
          .describe("Optional download directory. Default is ./.banxuebang/downloads"),
      },
      execute: async ({ task_id: taskId, file_id: fileId, max_chars: maxChars, directory }) =>
        client.readTaskAttachment({ taskId, fileId, maxChars, directory }),
    },
    {
      name: "upload_submission_file",
      description:
        "Upload a local file to Banxuebang's file system and return the submission file object used by homework submission.",
      inputSchema: {
        local_path: z.string().describe("Absolute or relative local file path."),
      },
      execute: async ({ local_path: localPath }) => client.uploadSubmissionFile(localPath),
    },
    {
      name: "submit_task_result",
      description:
        "Submit task content and/or attachments for a Banxuebang task. Prefer file_paths so the tool can upload files automatically.",
      inputSchema: {
        task_id: z.union([z.string(), z.number()]).describe("Activity/task id."),
        remark: z.string().optional().describe("Submission text content."),
        file_ids: z
          .array(z.union([z.string(), z.number()]))
          .optional()
          .describe("Optional already-uploaded file ids. Prefer file_paths instead."),
        file_paths: z
          .array(z.string())
          .optional()
          .describe("Optional local file paths to upload and include in the submission."),
        is_correct_work: z
          .number()
          .int()
          .optional()
          .describe("0 for normal submit, 1 for correction/revision."),
        submission_id: z
          .union([z.string(), z.number()])
          .optional()
          .describe("Optional existing submission record id for editing a prior submission."),
      },
      execute: async ({
        task_id: taskId,
        remark,
        file_ids: fileIds,
        file_paths: filePaths,
        is_correct_work: isCorrectWork,
        submission_id: submissionId,
      }) =>
        client.submitTaskResult({
          taskId,
          remark: remark ?? "",
          fileIds: fileIds ?? [],
          filePaths: filePaths ?? [],
          isCorrectWork: isCorrectWork ?? 0,
          submissionId,
        }),
    },
    {
      name: "browser_capture_achievement_page",
      description:
        "Use Playwright as a browser fallback: inject the saved session into localStorage, open achievement_list, and capture a screenshot and text preview.",
      inputSchema: {
        headless: z.boolean().optional().describe("Defaults to true."),
        screenshot_path: z
          .string()
          .optional()
          .describe("Optional output path. Default is ./artifacts/achievement-page.png"),
      },
      execute: async ({ headless, screenshot_path: screenshotPath }) =>
        client.browserCaptureAchievementPage({
          headless: headless ?? true,
          screenshotPath,
        }),
    },
    {
      name: "clear_session",
      description: "Delete the locally saved Banxuebang session file.",
      inputSchema: {},
      execute: async () => client.clearSession(),
    },
  ];
}

export async function executeTool(toolDefinitions, toolName, rawArgs = {}) {
  const tool = toolDefinitions.find((item) => item.name === toolName);
  if (!tool) {
    throw new Error(`Unknown tool "${toolName}".`);
  }

  const schema = z.object(tool.inputSchema || {});
  const args = schema.parse(rawArgs ?? {});
  return tool.execute(args);
}
