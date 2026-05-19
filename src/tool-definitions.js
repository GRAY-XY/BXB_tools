import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import * as z from "zod/v4";

const MAX_SNIPPET_TIMEOUT_MS = 15000;
const MAX_SNIPPET_OUTPUT_CHARS = 12000;

function clampPositiveInt(value, fallback, max) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.min(parsed, max);
}

function trimOutput(text, maxChars = MAX_SNIPPET_OUTPUT_CHARS) {
  const value = String(text || "");
  if (value.length <= maxChars) {
    return { text: value, truncated: false, totalChars: value.length };
  }
  return {
    text: value.slice(0, maxChars),
    truncated: true,
    totalChars: value.length,
  };
}

async function runPythonSnippet({ code, stdin = "", timeoutMs = 5000 } = {}) {
  const effectiveTimeout = clampPositiveInt(timeoutMs, 5000, MAX_SNIPPET_TIMEOUT_MS);
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "bxb-python-"));
  const scriptPath = path.join(tempDir, "snippet.py");
  const startedAt = Date.now();

  await writeFile(scriptPath, code, "utf8");

  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const child = spawn("python", [scriptPath], {
      cwd: tempDir,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, effectiveTimeout);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", async (error) => {
      clearTimeout(timer);
      await rm(tempDir, { recursive: true, force: true });
      reject(error);
    });
    child.on("close", async (exitCode, signal) => {
      clearTimeout(timer);
      await rm(tempDir, { recursive: true, force: true });
      const stdoutPreview = trimOutput(stdout);
      const stderrPreview = trimOutput(stderr);
      resolve({
        command: "python",
        exitCode,
        signal,
        timedOut,
        timeoutMs: effectiveTimeout,
        durationMs: Date.now() - startedAt,
        stdout: stdoutPreview.text,
        stdoutTruncated: stdoutPreview.truncated,
        stdoutTotalChars: stdoutPreview.totalChars,
        stderr: stderrPreview.text,
        stderrTruncated: stderrPreview.truncated,
        stderrTotalChars: stderrPreview.totalChars,
        note: "This helper is time-limited but not a full security sandbox. Use only for short calculations or data transformations.",
      });
    });

    if (stdin) {
      child.stdin.write(stdin);
    }
    child.stdin.end();
  });
}

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
      description:
        'Switch the current subject by id or course name for homework and achievement tools. Use subject_name "全部课程" to aggregate homework across all courses.',
      inputSchema: {
        subject_id: z.union([z.string(), z.number()]).optional().describe("Target subject id."),
        subject_name: z
          .string()
          .optional()
          .describe('Target course name, for example 国际公民素养. Use "全部课程" for all courses.'),
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
        'List tasks for the current subject or all courses. Use subject_name "全部课程" to aggregate all current-term courses.',
      inputSchema: {
        term_id: z.union([z.string(), z.number()]).optional().describe("Optional term id override."),
        term_name: z.string().optional().describe("Optional term name override."),
        subject_id: z
          .union([z.string(), z.number()])
          .optional()
          .describe("Optional subject id override."),
        subject_name: z.string().optional().describe('Optional subject name override. Use "全部课程" for all courses.'),
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
      name: "list_private_message_contacts",
      description: "List Banxuebang private-message contacts for the current student.",
      inputSchema: {},
      execute: async () => client.listPrivateMessageContacts(),
    },
    {
      name: "get_private_message_thread",
      description: "Read private-message thread content for a selected contact.",
      inputSchema: {
        contact: z.any().describe("Contact object returned by list_private_message_contacts."),
        size: z.number().int().positive().optional().describe("Page size. Default 20."),
        end_time: z.string().optional().describe("Optional endTime cursor for older messages."),
      },
      execute: async ({ contact, size, end_time: endTime }) =>
        client.getPrivateMessageThread(contact, { size: size ?? 20, endTime: endTime ?? "" }),
    },
    {
      name: "send_private_message_text",
      description:
        "Send a text private message to a selected Banxuebang contact. This must only be called after direct user action in the UI.",
      inputSchema: {
        contact: z.any().describe("Contact object returned by list_private_message_contacts."),
        content: z.string().describe("Text message content to send."),
      },
      execute: async ({ contact, content }) => client.sendPrivateMessageText(contact, content),
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
          .describe("Optional destination directory. Default is the local workspace."),
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
          .describe("Optional download directory. Default is the local workspace."),
      },
      execute: async ({ task_id: taskId, file_id: fileId, max_chars: maxChars, directory }) =>
        client.readTaskAttachment({ taskId, fileId, maxChars, directory }),
    },
    {
      name: "list_workspace_files",
      description: "List files in the local workspace where user uploads and assistant-created/downloaded files are stored.",
      inputSchema: {
        query: z.string().optional().describe("Optional filename or relative-path search text."),
        max_files: z.number().int().positive().optional().describe("Maximum number of files to return. Default 200."),
      },
      execute: async ({ query, max_files: maxFiles }) =>
        client.listWorkspaceFiles({ query: query ?? "", maxFiles: maxFiles ?? 200 }),
    },
    {
      name: "read_workspace_file",
      description:
        "Read a workspace file by relative path or filename. Supports text, PDF, and DOCX when the file type is readable.",
      inputSchema: {
        file: z.string().describe("Workspace relative path or filename."),
        max_chars: z.number().int().positive().optional().describe("Maximum characters to return. Default 8000."),
      },
      execute: async ({ file, max_chars: maxChars }) =>
        client.readWorkspaceFile({ file, maxChars: maxChars ?? 8000 }),
    },
    {
      name: "rename_workspace_file",
      description:
        "Rename a workspace file by relative path or filename. If the new name has no extension, the original extension is kept.",
      inputSchema: {
        file: z.string().describe("Workspace relative path or filename."),
        new_name: z.string().describe("New file name. Must not include a folder path."),
      },
      execute: async ({ file, new_name: newName }) =>
        client.renameWorkspaceFile({ file, newName }),
    },
    {
      name: "write_workspace_text_file",
      description: "Create a local text or Markdown file in the workspace. This does not upload anything.",
      inputSchema: {
        file_name: z.string().describe("File name to create in the workspace."),
        content: z.string().describe("Text content to save."),
        overwrite: z.boolean().optional().describe("Whether to overwrite an existing file. Default false."),
      },
      execute: async ({ file_name: fileName, content, overwrite }) =>
        client.writeWorkspaceTextFile({ fileName, content, overwrite: overwrite ?? false }),
    },
    {
      name: "extract_pdf_text",
      description:
        "Extract readable text from a local PDF file. Use paths returned by download_task_attachment when possible.",
      inputSchema: {
        local_path: z.string().describe("Absolute or relative path to a local PDF file."),
        max_chars: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Maximum number of characters to return. Default 6000."),
      },
      execute: async ({ local_path: localPath, max_chars: maxChars }) => {
        const result = await client.readLocalAttachment(localPath, maxChars ?? 6000);
        if (result.extension !== ".pdf") {
          throw new Error(`extract_pdf_text expected a .pdf file, got "${result.extension}".`);
        }
        return result;
      },
    },
    {
      name: "extract_docx_text",
      description:
        "Extract readable text from a local DOCX file. Use paths returned by download_task_attachment when possible.",
      inputSchema: {
        local_path: z.string().describe("Absolute or relative path to a local DOCX file."),
        max_chars: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Maximum number of characters to return. Default 6000."),
      },
      execute: async ({ local_path: localPath, max_chars: maxChars }) => {
        const result = await client.readLocalAttachment(localPath, maxChars ?? 6000);
        if (result.extension !== ".docx") {
          throw new Error(`extract_docx_text expected a .docx file, got "${result.extension}".`);
        }
        return result;
      },
    },
    {
      name: "run_python_snippet",
      description:
        "Run a short Python snippet for calculations or small data transformations. Time-limited and output-limited; not a full sandbox.",
      inputSchema: {
        code: z.string().describe("Python code to run. Keep it short and deterministic."),
        stdin: z.string().optional().describe("Optional stdin text passed to the Python process."),
        timeout_ms: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Timeout in milliseconds. Default 5000, maximum 15000."),
      },
      execute: async ({ code, stdin, timeout_ms: timeoutMs }) =>
        runPythonSnippet({ code, stdin: stdin ?? "", timeoutMs: timeoutMs ?? 5000 }),
    },
    {
      name: "web_search",
      description:
        "Search the web through the local Playwright browser. Defaults to Bing and does not require a search API key.",
      inputSchema: {
        query: z.string().describe("Search query."),
        max_results: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Maximum number of results to return. Default 5, maximum 10."),
        engine: z.enum(["bing"]).optional().describe("Search engine. Defaults to bing."),
        timeout_ms: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Browser timeout in milliseconds. Default 20000, maximum 45000."),
      },
      execute: async ({ query, max_results: maxResults, engine, timeout_ms: timeoutMs }) =>
        client.webSearch({
          query,
          maxResults: maxResults ?? 5,
          engine: engine ?? "bing",
          timeoutMs: timeoutMs ?? 20000,
        }),
    },
    {
      name: "read_web_page",
      description:
        "Open an http(s) web page through the local Playwright browser and return readable body text.",
      inputSchema: {
        url: z.string().describe("HTTP or HTTPS URL to read."),
        max_chars: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Maximum number of body-text characters to return. Default 8000, maximum 30000."),
        timeout_ms: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Browser timeout in milliseconds. Default 20000, maximum 45000."),
      },
      execute: async ({ url, max_chars: maxChars, timeout_ms: timeoutMs }) =>
        client.readWebPage({
          url,
          maxChars: maxChars ?? 8000,
          timeoutMs: timeoutMs ?? 20000,
        }),
    },
    {
      name: "collect_task_submission_context",
      description:
        "Collect the task text, attachments, extracted attachment text, and missing-information signals needed before drafting a submission.",
      inputSchema: {
        task_id: z.union([z.string(), z.number()]).describe("Activity/task id."),
        max_chars: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Maximum number of characters to keep for each text field. Default 4000."),
        max_attachments: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Maximum number of attachments to read. Default 6."),
      },
      execute: async ({ task_id: taskId, max_chars: maxChars, max_attachments: maxAttachments }) =>
        client.collectTaskSubmissionContext(taskId, {
          maxChars: maxChars ?? 4000,
          maxAttachments: maxAttachments ?? 6,
        }),
    },
    {
      name: "draft_task_submission",
      description:
        "Save an agent-written draft for later human review. This does not upload files or submit the task.",
      inputSchema: {
        task_id: z.union([z.string(), z.number()]).describe("Activity/task id."),
        subject_name: z.string().optional().describe("Course name."),
        task_title: z.string().optional().describe("Task title."),
        draft_text: z.string().describe("The draft submission text created by the agent."),
        summary: z.string().optional().describe("Short summary of what the draft tries to do."),
        evidence: z
          .array(z.any())
          .optional()
          .describe("Optional evidence objects or snippets used to justify the draft."),
        warnings: z
          .array(z.string())
          .optional()
          .describe("Optional warnings about uncertainty or partial information."),
        missing_info: z
          .array(z.string())
          .optional()
          .describe("Optional missing-information items that still block or weaken the answer."),
        needs_user_input: z
          .boolean()
          .optional()
          .describe("Whether the agent believes more user input is needed before submission."),
      },
      execute: async ({
        task_id: taskId,
        subject_name: subjectName,
        task_title: taskTitle,
        draft_text: draftText,
        summary,
        evidence,
        warnings,
        missing_info: missingInfo,
        needs_user_input: needsUserInput,
      }) =>
        client.draftTaskSubmission({
          taskId,
          subjectName,
          taskTitle,
          draftText,
          summary,
          evidence: evidence ?? [],
          warnings: warnings ?? [],
          missingInfo: missingInfo ?? [],
          needsUserInput: needsUserInput ?? false,
        }),
    },
    {
      name: "list_submission_drafts",
      description: "List locally archived submission drafts and their review status.",
      inputSchema: {
        status: z
          .enum(["pending_review", "approved", "rejected", "submitted"])
          .optional()
          .describe("Optional status filter."),
      },
      execute: async ({ status }) => client.listSubmissionDrafts({ status }),
    },
    {
      name: "get_submission_draft",
      description: "Read a saved submission draft for review.",
      inputSchema: {
        draft_id: z.string().describe("Draft id returned by draft_task_submission."),
      },
      execute: async ({ draft_id: draftId }) => client.getSubmissionDraft(draftId),
    },
    {
      name: "approve_submission_draft",
      description: "Mark a saved submission draft as approved after human review.",
      inputSchema: {
        draft_id: z.string().describe("Draft id returned by draft_task_submission."),
        review_note: z.string().optional().describe("Optional reviewer note."),
      },
      execute: async ({ draft_id: draftId, review_note: reviewNote }) =>
        client.approveSubmissionDraft(draftId, { reviewNote }),
    },
    {
      name: "reject_submission_draft",
      description: "Mark a saved submission draft as rejected after human review.",
      inputSchema: {
        draft_id: z.string().describe("Draft id returned by draft_task_submission."),
        review_note: z.string().optional().describe("Optional reviewer note."),
      },
      execute: async ({ draft_id: draftId, review_note: reviewNote }) =>
        client.rejectSubmissionDraft(draftId, { reviewNote }),
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
