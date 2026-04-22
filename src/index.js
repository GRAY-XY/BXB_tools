import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod/v4";
import { BanxuebangClient } from "./banxuebang-client.js";
import { SessionStore } from "./session-store.js";

const server = new McpServer({
  name: "banxuebang-achievement-mcp",
  version: "0.1.0",
});

const client = new BanxuebangClient(new SessionStore());

function jsonResult(data) {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(data, null, 2),
      },
    ],
  };
}

server.registerTool(
  "list_terms",
  {
    description: "List the terms available in the current Banxuebang session.",
    inputSchema: {},
  },
  async () => jsonResult(await client.listTerms()),
);

server.registerTool(
  "list_courses",
  {
    description: "List the courses available in the current Banxuebang term and class context.",
    inputSchema: {},
  },
  async () => jsonResult(await client.listCourses()),
);

server.registerTool(
  "session_status",
  {
    description: "Show whether the Banxuebang session is ready and which term/class/subject are selected.",
    inputSchema: {},
  },
  async () => {
    const session = await client.getSession();
    return jsonResult(client.summarizeSession(session));
  },
);

server.registerTool(
  "interactive_login",
  {
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
  },
  async ({ headless, timeout_ms: timeoutMs }) => {
    const result = await client.interactiveLogin({
      headless: headless ?? false,
      timeoutMs: timeoutMs ?? 300000,
    });
    return jsonResult(result);
  },
);

server.registerTool(
  "login_in_browser",
  {
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
  },
  async ({ headless, timeout_ms: timeoutMs }) => {
    const result = await client.interactiveLogin({
      headless: headless ?? false,
      timeoutMs: timeoutMs ?? 300000,
    });
    return jsonResult(result);
  },
);

server.registerTool(
  "login_with_credentials",
  {
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
  },
  async ({ username, password, headless, timeout_ms: timeoutMs, agree_terms: agreeTerms }) =>
    jsonResult(
      await client.loginWithCredentials({
        username,
        password,
        headless: headless ?? false,
        timeoutMs: timeoutMs ?? 60000,
        agreeTerms: agreeTerms ?? true,
      }),
    ),
);

server.registerTool(
  "import_browser_storage",
  {
    description:
      "Import a Banxuebang browser localStorage dump. Expected keys include tokens, userInfo, curClass, currTermId, and curSubject.",
    inputSchema: {
      storage_json: z
        .string()
        .describe("A JSON object string containing browser localStorage values."),
    },
  },
  async ({ storage_json: storageJson }) => {
    const result = await client.importBrowserStorage(storageJson);
    return jsonResult(result);
  },
);

server.registerTool(
  "refresh_context",
  {
    description:
      "Refresh term/class/subject context from Banxuebang APIs using the current session token.",
    inputSchema: {},
  },
  async () => jsonResult(await client.refreshContext()),
);

server.registerTool(
  "set_current_term",
  {
    description: "Switch the current term by id or name and refresh the subject list for that term.",
    inputSchema: {
      term_id: z.union([z.string(), z.number()]).optional().describe("Target term id."),
      term_name: z.string().optional().describe("Target term name, for example 2025-2026下学期."),
    },
  },
  async ({ term_id: termId, term_name: termName }) => {
    if (termId !== undefined) {
      return jsonResult(await client.setCurrentTerm(termId));
    }

    if (termName) {
      return jsonResult(await client.setCurrentTermByName(termName));
    }

    throw new Error("Provide either term_id or term_name.");
  },
);

server.registerTool(
  "set_current_subject",
  {
    description: "Switch the current subject by id or course name for homework and achievement tools.",
    inputSchema: {
      subject_id: z.union([z.string(), z.number()]).optional().describe("Target subject id."),
      subject_name: z.string().optional().describe("Target course name, for example 国际公民素养."),
      class_id: z
        .union([z.string(), z.number()])
        .optional()
        .describe("Optional class id when the same subject id exists under multiple classes."),
    },
  },
  async ({ subject_id: subjectId, subject_name: subjectName, class_id: classId }) => {
    if (subjectId !== undefined) {
      return jsonResult(await client.setCurrentSubject(subjectId, classId));
    }

    if (subjectName) {
      return jsonResult(await client.setCurrentSubjectByName(subjectName, classId));
    }

    throw new Error("Provide either subject_id or subject_name.");
  },
);

server.registerTool(
  "list_homework",
  {
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
  },
  async ({ list_type: listType, page, size }) =>
    jsonResult(
      await client.listHomework({
        listType: listType ?? "all",
        page: page ?? 1,
        size: size ?? 10,
      }),
    ),
);

server.registerTool(
  "list_tasks",
  {
    description:
      "List tasks for the current subject. This is an alias of list_homework for AI clients that prefer task wording.",
    inputSchema: {
      list_type: z
        .enum(["all", "latest", "pending"])
        .optional()
        .describe('Filter mode. "all" maps to 全部, "latest" to 最新, "pending" to 待处理.'),
      page: z.number().int().positive().optional().describe("Page number. Default 1."),
      size: z.number().int().positive().optional().describe("Page size. Default 10."),
    },
  },
  async ({ list_type: listType, page, size }) =>
    jsonResult(
      await client.listTasks({
        listType: listType ?? "all",
        page: page ?? 1,
        size: size ?? 10,
      }),
    ),
);

server.registerTool(
  "get_achievement_overview",
  {
    description:
      "Read the 成绩 tab data behind achievement_list, including average GPA level, score groups, transfer class options, and chart records.",
    inputSchema: {
      transfer_class_id: z
        .union([z.string(), z.number()])
        .optional()
        .describe("Optional transfer class record id to inspect. Defaults to the last record used by the page."),
    },
  },
  async ({ transfer_class_id: transferClassId }) =>
    jsonResult(await client.getAchievementOverview({ transferClassId })),
);

server.registerTool(
  "get_current_subject_gpa",
  {
    description: "Get the average GPA level for the current subject, plus the active transfer-class record.",
    inputSchema: {},
  },
  async () => jsonResult(await client.getCurrentSubjectGpa()),
);

server.registerTool(
  "open_task",
  {
    description:
      "Open a Banxuebang task by id and return its detail, attachments, and current submission state.",
    inputSchema: {
      task_id: z.union([z.string(), z.number()]).describe("Activity/task id."),
    },
  },
  async ({ task_id: taskId }) => jsonResult(await client.getTaskDetail(taskId)),
);

server.registerTool(
  "read_task_content",
  {
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
  },
  async ({ task_id: taskId, max_chars: maxChars }) =>
    jsonResult(await client.readTaskContent(taskId, maxChars ?? 4000)),
);

server.registerTool(
  "download_task_attachment",
  {
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
  },
  async ({ task_id: taskId, file_id: fileId, directory }) =>
    jsonResult(await client.downloadTaskAttachment({ taskId, fileId, directory })),
);

server.registerTool(
  "read_task_attachment",
  {
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
  },
  async ({ task_id: taskId, file_id: fileId, max_chars: maxChars, directory }) =>
    jsonResult(await client.readTaskAttachment({ taskId, fileId, maxChars, directory })),
);

server.registerTool(
  "upload_submission_file",
  {
    description:
      "Upload a local file to Banxuebang's file system and return the submission file object used by homework submission.",
    inputSchema: {
      local_path: z.string().describe("Absolute or relative local file path."),
    },
  },
  async ({ local_path: localPath }) => jsonResult(await client.uploadSubmissionFile(localPath)),
);

server.registerTool(
  "submit_task_result",
  {
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
  },
  async ({
    task_id: taskId,
    remark,
    file_ids: fileIds,
    file_paths: filePaths,
    is_correct_work: isCorrectWork,
    submission_id: submissionId,
  }) =>
    jsonResult(
      await client.submitTaskResult({
        taskId,
        remark: remark ?? "",
        fileIds: fileIds ?? [],
        filePaths: filePaths ?? [],
        isCorrectWork: isCorrectWork ?? 0,
        submissionId,
      }),
    ),
);

server.registerTool(
  "browser_capture_achievement_page",
  {
    description:
      "Use Playwright as a browser fallback: inject the saved session into localStorage, open achievement_list, and capture a screenshot and text preview.",
    inputSchema: {
      headless: z.boolean().optional().describe("Defaults to true."),
      screenshot_path: z
        .string()
        .optional()
        .describe("Optional output path. Default is ./artifacts/achievement-page.png"),
    },
  },
  async ({ headless, screenshot_path: screenshotPath }) =>
    jsonResult(
      await client.browserCaptureAchievementPage({
        headless: headless ?? true,
        screenshotPath,
      }),
    ),
);

server.registerTool(
  "clear_session",
  {
    description: "Delete the locally saved Banxuebang session file.",
    inputSchema: {},
  },
  async () => jsonResult(await client.clearSession()),
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("banxuebang-achievement-mcp running on stdio");
}

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});
