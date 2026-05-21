import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { marked } from "marked";
import "./styles.css";

const pages = [
  ["home", "主页"],
  ["agent", "助手"],
  ["homework", "作业"],
  ["workspace", "工作区"],
  ["messages", "私信"],
  ["drafts", "草稿"],
  ["settings", "设置"],
];

const quickPrompts = [
  "列出课程",
  "列出所有课程作业",
  "列出待处理作业",
  "查看成绩概览",
];

const fallbackSystemPrompt =
  "你是伴学邦桌面助手。需要真实数据时必须调用工具，不要猜测。需要联网资料时先调用 web_search；需要阅读某个搜索结果时再调用 read_web_page。用户提到工作区文件时，先调用 list_workspace_files 定位文件，再按需调用 read_workspace_file；需要整理文件名时可调用 rename_workspace_file。不要上传、提交或删除任何内容。处理作业草稿时先调用 collect_task_submission_context；信息不足就说明缺什么；信息足够才调用 draft_task_submission 保存草稿等待用户审核。";

const allCoursesName = "全部课程";
const imageAttachmentExtensions = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".avif"]);

function md(text) {
  return { __html: marked.parse(text || "", { breaks: true, gfm: true }) };
}

function JsonBlock({ data }) {
  return <pre className="json-block">{JSON.stringify(data, null, 2)}</pre>;
}

function getTermId(term) {
  return term?.id || term?.term_id || term?.termId;
}

function getTermName(term) {
  return term?.name || term?.termName || term?.title;
}

function formatConversationTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString([], { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function formatMessageTime(value) {
  if (!value) return "";
  const date = new Date(String(value).replaceAll("-", "/"));
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString([], { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function formatFileSize(value) {
  const size = Number(value || 0);
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function privateMessageContent(message) {
  if (!message) return "";
  if (message.revocation) return "消息已撤回";
  if (message.contentType === "P") return "[图片]";
  if (message.contentType === "A") return "[附件]";
  return message.content || "";
}

function extractTaskRows(result) {
  const directRows = result?.items || result?.records || result?.rows || result?.data?.records;
  if (Array.isArray(directRows)) {
    return directRows;
  }

  const pending = Array.isArray(result?.unsubmittedHomeworkList)
    ? result.unsubmittedHomeworkList.map((task) => ({ ...task, __statusText: "未提交" }))
    : [];
  const homework = Array.isArray(result?.homeworkList)
    ? result.homeworkList.map((task) => ({ ...task, __statusText: task.scoreLevel || task.score || "已提交/已记录" }))
    : [];
  return [...pending, ...homework];
}

function getTaskId(task) {
  return task?.task_id || task?.taskId || task?.id || task?.activityId;
}

function getTaskCourse(task, session) {
  return task?.course || task?.subjectName || task?.subject || task?.courseName || session?.currentSubject?.name || "-";
}

function getTaskTitle(task) {
  return task?.name || task?.title || task?.activityName || "-";
}

function getTaskDeadline(task) {
  return task?.deadline || task?.endTime || "-";
}

function getTaskStatus(task) {
  return task?.__statusText || task?.score || task?.level || task?.scoreLevel || task?.scoreTypeName || "-";
}

function getDetailTitle(detail) {
  return detail?.taskSummary?.activityName || detail?.taskSummary?.title || detail?.taskSummary?.name || `任务 ${detail?.taskId || ""}`;
}

function getDetailCourse(detail) {
  return detail?.taskSummary?.courseName || detail?.context?.currentSubject?.name || "-";
}

function getDetailStatus(detail) {
  const summary = detail?.taskSummary || {};
  if (summary.scoreTypeName) return summary.scoreTypeName;
  if (summary.correction) return "订正中";
  if (summary.isParticipate === false) return "未参与";
  return "-";
}

function getAttachmentKey(attachment, index = 0) {
  return String(attachment?.fileId || attachment?.fileName || attachment?.name || `attachment-${index}`);
}

function getAttachmentExtension(attachment) {
  const explicit = attachment?.fileExt || attachment?.ext || attachment?.extension;
  if (explicit) {
    const normalized = String(explicit).trim().toLowerCase();
    return normalized.startsWith(".") ? normalized : `.${normalized}`;
  }
  const fileName = String(attachment?.fileName || attachment?.name || "");
  const match = fileName.match(/\.[^.]+$/);
  return match ? match[0].toLowerCase() : "";
}

function isImageAttachment(attachment) {
  const extension = getAttachmentExtension(attachment);
  const type = String(attachment?.fileType || attachment?.contentType || attachment?.mimeType || "").toLowerCase();
  const category = String(attachment?.category || "").toLowerCase();
  return category === "1" || category === "image" || category === "图片" || type.startsWith("image/") || imageAttachmentExtensions.has(extension);
}

function isWorkspaceImageFile(file) {
  return isImageAttachment(file);
}

function formatDraftStatus(status) {
  const normalized = String(status || "").trim();
  if (normalized === "pending_review") return "待审核";
  if (normalized === "approved") return "已通过";
  if (normalized === "rejected") return "已驳回";
  return normalized || "未知状态";
}

function draftStatusClass(status) {
  const normalized = String(status || "").trim();
  if (normalized === "approved") return "approved";
  if (normalized === "rejected") return "rejected";
  if (normalized === "pending_review") return "pending";
  return "unknown";
}

function draftTitle(draft) {
  return draft?.taskTitle || (draft?.taskId ? `任务 ${draft.taskId}` : "未命名草稿");
}

function normalizeList(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => item !== null && item !== undefined && String(item).trim() !== "");
}

function renderDraftListItem(item, index) {
  if (typeof item === "string" || typeof item === "number") {
    return <span>{String(item)}</span>;
  }
  if (item && typeof item === "object") {
    const title = item.title || item.name || item.fileName || item.source || item.type || `条目 ${index + 1}`;
    const text = item.text || item.content || item.snippet || item.summary || item.value || "";
    return (
      <>
        <strong>{String(title)}</strong>
        {text && <span>{String(text)}</span>}
      </>
    );
  }
  return <span>{String(item)}</span>;
}

function DraftPreview({
  draft,
  draftEditText = "",
  draftDirty = false,
  draftSaving = false,
  onDraftTextChange,
  onSaveDraft,
  onResetDraft,
}) {
  if (!draft) {
    return (
      <div className="draft-empty">
        <strong>选择一个草稿查看预览</strong>
        <span>这里会显示任务、课程、待提交正文、风险提示和参考证据。</span>
      </div>
    );
  }

  const missingInfo = normalizeList(draft.missingInfo);
  const warnings = normalizeList(draft.warnings);
  const evidence = normalizeList(draft.evidence);
  const hasReview = draft.reviewedAt || draft.reviewNote;

  return (
    <div className="draft-preview">
      <div className="draft-preview-head">
        <div>
          <span className={`draft-status ${draftStatusClass(draft.status)}`}>{formatDraftStatus(draft.status)}</span>
          <h2>{draftTitle(draft)}</h2>
        </div>
        <div className="draft-meta">
          <span>{draft.subjectName || "未知课程"}</span>
          <span>ID: {draft.taskId || "-"}</span>
        </div>
      </div>

      <div className="draft-facts">
        <div>
          <span>创建时间</span>
          <strong>{formatMessageTime(draft.createdAt) || "-"}</strong>
        </div>
        <div>
          <span>更新时间</span>
          <strong>{formatMessageTime(draft.updatedAt) || "-"}</strong>
        </div>
        <div>
          <span>需要补充</span>
          <strong>{draft.needsUserInput || missingInfo.length ? "是" : "否"}</strong>
        </div>
      </div>

      {draft.summary && (
        <section className="draft-section">
          <h3>草稿摘要</h3>
          <p>{draft.summary}</p>
        </section>
      )}

      <section className="draft-section primary">
        <div className="draft-section-head">
          <h3>待提交正文</h3>
          <div className="draft-edit-actions">
            <button type="button" onClick={onResetDraft} disabled={!draftDirty || draftSaving}>还原</button>
            <button type="button" className="primary" onClick={onSaveDraft} disabled={!draftDirty || draftSaving || !draftEditText.trim()}>
              {draftSaving ? "保存中" : "保存"}
            </button>
          </div>
        </div>
        <textarea
          className="draft-editor"
          value={draftEditText}
          onChange={(event) => onDraftTextChange?.(event.target.value)}
          placeholder="编辑待提交正文..."
          spellCheck={false}
        />
        <small className="draft-edit-hint">
          {draftDirty ? "有未保存修改。保存只会更新本地草稿，不会上传或提交。" : "保存只会更新本地草稿，不会上传或提交。"}
        </small>
      </section>

      {(missingInfo.length > 0 || warnings.length > 0) && (
        <section className="draft-section">
          <h3>提交前检查</h3>
          <div className="draft-alerts">
            {missingInfo.map((item, index) => (
              <div key={`missing-${index}`} className="draft-alert missing">
                <strong>缺少信息</strong>
                {renderDraftListItem(item, index)}
              </div>
            ))}
            {warnings.map((item, index) => (
              <div key={`warning-${index}`} className="draft-alert warning">
                <strong>注意</strong>
                {renderDraftListItem(item, index)}
              </div>
            ))}
          </div>
        </section>
      )}

      {evidence.length > 0 && (
        <section className="draft-section">
          <h3>参考依据</h3>
          <div className="draft-evidence-list">
            {evidence.map((item, index) => (
              <div key={index} className="draft-evidence">
                {renderDraftListItem(item, index)}
              </div>
            ))}
          </div>
        </section>
      )}

      {hasReview && (
        <section className="draft-section">
          <h3>审核记录</h3>
          <p>
            {draft.reviewedAt ? `审核时间：${formatMessageTime(draft.reviewedAt)}` : ""}
            {draft.reviewNote ? `\n备注：${draft.reviewNote}` : ""}
          </p>
        </section>
      )}
    </div>
  );
}

function isAllCourses(course) {
  const id = course?.id || course?.subject_id || course?.subjectId;
  const name = course?.name || course?.subjectName || course?.courseName || course?.title;
  return Boolean(course?.allSubjects || id === "__all_courses__" || name === allCoursesName);
}

function getCourseId(course) {
  return course?.id || course?.subject_id || course?.subjectId;
}

function getCourseName(course) {
  return course?.name || course?.subjectName || course?.courseName || course?.title;
}

function getCourseClassId(course) {
  return course?.classId || course?.class_id;
}

function getCourseOptionKey(course, index = 0) {
  return [
    getCourseId(course) || "",
    getCourseClassId(course) || "",
    getCourseName(course) || "",
    index,
  ].join("::");
}

function courseTaskArgs(course, listType = "all") {
  const args = {
    list_type: listType,
    page: 1,
    size: 30,
  };
  if (!course || isAllCourses(course)) {
    args.subject_name = allCoursesName;
    return args;
  }

  const subjectName = getCourseName(course);
  const subjectId = getCourseId(course);
  const classId = getCourseClassId(course);
  if (subjectName) {
    args.subject_name = subjectName;
  } else if (subjectId) {
    args.subject_id = subjectId;
  }
  if (classId) {
    args.class_id = classId;
  }
  return args;
}

function pendingTaskCount(session) {
  const subjects = Array.isArray(session?.availableSubjects) ? session.availableSubjects : [];
  const counts = subjects
    .map((subject) => Number(subject?.unSubmitCount))
    .filter((count) => Number.isFinite(count));
  if (counts.length) {
    return counts.reduce((sum, count) => sum + count, 0);
  }
  const current = Number(session?.currentSubject?.unSubmitCount);
  return Number.isFinite(current) ? current : null;
}

function appPathRows(appInfo) {
  if (!appInfo) return [];
  return [
    {
      key: "userDataRoot",
      title: "应用数据目录",
      description: "保存模型配置、助手对话记录和本应用的本地状态。",
      path: appInfo.userDataRoot,
    },
    {
      key: "dataRoot",
      title: "伴学邦数据目录",
      description: "保存伴学邦会话、工作区和草稿等业务数据。",
      path: appInfo.dataRoot,
    },
    {
      key: "workspaceDir",
      title: "工作区",
      description: "保存用户导入文件、下载的作业附件和助手生成的本地文件。",
      path: appInfo.workspaceDir,
    },
    {
      key: "draftDir",
      title: "草稿库",
      description: "保存待审核、已通过和已驳回的本地作业草稿。",
      path: appInfo.draftDir,
    },
    {
      key: "modelConfigPath",
      title: "模型配置文件",
      description: "保存 API Key、调用链接、模型名、Temperature 和系统提示词。",
      path: appInfo.modelConfigPath,
    },
    {
      key: "conversationsPath",
      title: "助手对话记录",
      description: "保存本地助手会话、标题和上下文压缩后的历史。",
      path: appInfo.conversationsPath,
    },
    {
      key: "payloadRoot",
      title: "程序负载目录",
      description: "保存打包随附的工具代码和运行依赖，通常不需要手动修改。",
      path: appInfo.payloadRoot,
    },
    {
      key: "browserRoot",
      title: "浏览器依赖目录",
      description: "保存 Playwright/Chromium 依赖，供登录、网页搜索和页面读取使用。",
      path: appInfo.browserDependency?.browserRoot,
    },
  ].filter((item) => item.path);
}

function SessionSummary({ session }) {
  if (!session?.ready) {
    return (
      <div className="session-summary empty">
        <strong>当前未登录</strong>
        <span>请先点击“浏览器登录”，登录后这里会显示账户、班级、学期和课程信息。</span>
      </div>
    );
  }

  const activeTerm = session.availableTerms?.find((term) => term.status) || session.availableTerms?.find((term) => term.id === session.currentTermId);
  const courseCount = Array.isArray(session.availableSubjects) ? session.availableSubjects.length : 0;
  const pendingCount = pendingTaskCount(session);
  const pendingLabel = pendingCount === undefined || pendingCount === null
    ? "暂无数据"
    : `${pendingCount} 项`;

  return (
    <div className="session-summary">
      <div className="summary-main">
        <div>
          <span>当前账户姓名</span>
          <strong>{session.user?.name || "已登录"}</strong>
        </div>
        <div>
          <span>待处理作业</span>
          <strong>{pendingLabel}</strong>
        </div>
      </div>
      <div className="summary-list">
        <div>
          <span>当前班级</span>
          <strong>{session.currentClass?.name || "未识别"}</strong>
        </div>
        <div>
          <span>当前学期</span>
          <strong>{activeTerm?.name || "未识别"}</strong>
        </div>
        <div>
          <span>本学期课程</span>
          <strong>{courseCount ? `${courseCount} 门` : "暂无数据"}</strong>
        </div>
        <div>
          <span>作业筛选</span>
          <strong>在作业页选择</strong>
        </div>
      </div>
      <p>为了安全，这里不会显示登录令牌、会话文件路径、邮箱或其他技术字段。</p>
    </div>
  );
}

function AttachmentCard({ attachment, index, preview, previewState, onRetryImagePreview }) {
  const title = attachment.fileName || attachment.name || `附件 ${index + 1}`;
  const image = isImageAttachment(attachment);
  const meta = [
    image ? "图片" : attachment.category || attachment.fileExt || "文件",
    attachment.fileSize ? formatFileSize(attachment.fileSize) : "",
    attachment.source || "",
  ].filter(Boolean).join(" · ");

  return (
    <div className={image ? "task-attachment image" : "task-attachment"}>
      <div className="task-attachment-main">
        <strong title={title}>{title}</strong>
        <span>{meta}</span>
        {attachment.fileId && <small>ID: {attachment.fileId}</small>}
      </div>
      {image && (
        <div className="task-image-preview">
          {previewState?.loading && <div className="task-image-placeholder">正在加载图片...</div>}
          {preview?.dataUrl && <img src={preview.dataUrl} alt={title} loading="lazy" />}
          {previewState?.error && (
            <div className="task-image-error">
              <span>{previewState.error}</span>
              <button type="button" onClick={() => onRetryImagePreview?.(attachment, index)}>重试</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function TaskDetailView({ detail, imagePreviews = {}, imagePreviewStates = {}, onRetryImagePreview }) {
  if (!detail) {
    return (
      <div className="task-detail-empty">
        <strong>选择左侧作业查看详情</strong>
        <span>这里会显示作业标题、课程、截止时间、正文、参考内容和附件。</span>
      </div>
    );
  }

  const attachments = Array.isArray(detail.attachments) ? detail.attachments : [];
  const content = String(detail.content || "").trim();
  const answer = String(detail.answer || "").trim();

  return (
    <div className="task-detail-readable">
      <div className="task-detail-head">
        <span>任务详情</span>
        <h2>{getDetailTitle(detail)}</h2>
      </div>

      <div className="task-detail-facts">
        <div>
          <span>任务 ID</span>
          <strong>{detail.taskId || "-"}</strong>
        </div>
        <div>
          <span>课程</span>
          <strong>{getDetailCourse(detail)}</strong>
        </div>
        <div>
          <span>截止时间</span>
          <strong>{detail.taskSummary?.endTime || "-"}</strong>
        </div>
        <div>
          <span>状态/评分项</span>
          <strong>{getDetailStatus(detail)}</strong>
        </div>
      </div>

      <section className="task-readable-section">
        <h3>作业正文</h3>
        {content ? (
          <>
            <p>{content}</p>
            {detail.contentTruncated && <em>正文较长，当前只显示前 {detail.content?.length || 0} 个字符。</em>}
          </>
        ) : (
          <div className="task-muted">暂无可读取正文。</div>
        )}
      </section>

      {answer && (
        <section className="task-readable-section">
          <h3>参考内容</h3>
          <p>{answer}</p>
          {detail.answerTruncated && <em>参考内容较长，当前只显示前 {detail.answer?.length || 0} 个字符。</em>}
        </section>
      )}

      <section className="task-readable-section">
        <h3>附件</h3>
        {attachments.length ? (
          <div className="task-attachments">
            {attachments.map((attachment, index) => (
              <AttachmentCard
                key={`${attachment.fileId || attachment.name}-${index}`}
                attachment={attachment}
                index={index}
                preview={imagePreviews[getAttachmentKey(attachment, index)]}
                previewState={imagePreviewStates[getAttachmentKey(attachment, index)]}
                onRetryImagePreview={onRetryImagePreview}
              />
            ))}
          </div>
        ) : (
          <div className="task-muted">没有附件。</div>
        )}
      </section>
    </div>
  );
}

function App() {
  const [page, setPage] = useState("home");
  const [theme, setTheme] = useState(() => localStorage.getItem("bxb-theme") || "light");
  const [status, setStatus] = useState("Ready");
  const [session, setSession] = useState(null);
  const [terms, setTerms] = useState([]);
  const [sessionMenuOpen, setSessionMenuOpen] = useState(false);
  const [appInfo, setAppInfo] = useState(null);
  const [conversations, setConversations] = useState([]);
  const [activeConversationId, setActiveConversationId] = useState("");
  const [conversationMenuOpen, setConversationMenuOpen] = useState(false);
  const [renamingConversationId, setRenamingConversationId] = useState("");
  const [renameValue, setRenameValue] = useState("");
  const [messages, setMessages] = useState([]);
  const [steps, setSteps] = useState([]);
  const [input, setInput] = useState("");
  const [running, setRunning] = useState(false);
  const [startedAt, setStartedAt] = useState(0);
  const [elapsed, setElapsed] = useState("0.0s");
  const [usage, setUsage] = useState(null);
  const [usageCache, setUsageCache] = useState({});
  const [tasks, setTasks] = useState([]);
  const [taskDetail, setTaskDetail] = useState(null);
  const [taskImagePreviews, setTaskImagePreviews] = useState({});
  const [taskImagePreviewStates, setTaskImagePreviewStates] = useState({});
  const [homeworkCourses, setHomeworkCourses] = useState([]);
  const [homeworkCourseKey, setHomeworkCourseKey] = useState("");
  const [homeworkListType, setHomeworkListType] = useState("all");
  const [homeworkCourseLoading, setHomeworkCourseLoading] = useState(false);
  const [workspaceFiles, setWorkspaceFiles] = useState([]);
  const [selectedWorkspaceFile, setSelectedWorkspaceFile] = useState(null);
  const [workspacePreview, setWorkspacePreview] = useState(null);
  const [workspaceQuery, setWorkspaceQuery] = useState("");
  const [workspaceLoading, setWorkspaceLoading] = useState(false);
  const [privateContacts, setPrivateContacts] = useState([]);
  const [selectedPrivateContact, setSelectedPrivateContact] = useState(null);
  const [privateThread, setPrivateThread] = useState([]);
  const [privateText, setPrivateText] = useState("");
  const [privateLoading, setPrivateLoading] = useState(false);
  const [drafts, setDrafts] = useState([]);
  const [selectedDraft, setSelectedDraft] = useState(null);
  const [draftStatusFilter, setDraftStatusFilter] = useState("pending_review");
  const [draftEditText, setDraftEditText] = useState("");
  const [draftSaving, setDraftSaving] = useState(false);
  const [draftCreateCourses, setDraftCreateCourses] = useState([]);
  const [draftCreateCourseKey, setDraftCreateCourseKey] = useState("");
  const [draftCreateTasks, setDraftCreateTasks] = useState([]);
  const [draftCreateTaskId, setDraftCreateTaskId] = useState("");
  const [draftCreateSummary, setDraftCreateSummary] = useState("");
  const [draftCreateText, setDraftCreateText] = useState("");
  const [draftCreateLoading, setDraftCreateLoading] = useState(false);
  const [draftCreateOpen, setDraftCreateOpen] = useState(false);
  const [modelConfig, setModelConfig] = useState({
    apiKey: "",
    baseUrl: "",
    modelName: "",
    contextLength: 0,
    chatTemperature: 0.2,
    compactTemperature: 0.1,
    maxToolRounds: 6,
    systemPrompt: fallbackSystemPrompt,
    defaultSystemPrompt: fallbackSystemPrompt,
  });
  const [modelResult, setModelResult] = useState(null);
  const [modelOptions, setModelOptions] = useState([]);
  const [modelOptionsLoading, setModelOptionsLoading] = useState(false);
  const [updateResult, setUpdateResult] = useState(null);
  const [updateLoading, setUpdateLoading] = useState(false);
  const chatEndRef = useRef(null);
  const stepsEndRef = useRef(null);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("bxb-theme", theme);
  }, [theme]);

  useEffect(() => {
    window.bxb.getAppInfo().then(setAppInfo).catch((error) => setStatus(error.message));
    window.bxb.loadModelConfig().then(setModelConfig).catch((error) => setStatus(error.message));
    loadConversations();
    refreshSession();
  }, []);

  useEffect(() => {
    const off = window.bxb.onAgentProgress(({ step }) => {
      setSteps((current) => [...current, step]);
    });
    return off;
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  useEffect(() => {
    stepsEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [steps]);

  useEffect(() => {
    if (!running) {
      return undefined;
    }
    const timer = setInterval(() => {
      setElapsed(`${((performance.now() - startedAt) / 1000).toFixed(1)}s`);
    }, 200);
    return () => clearInterval(timer);
  }, [running, startedAt]);

  useEffect(() => {
    if (page === "messages" && !privateContacts.length && !privateLoading) {
      loadPrivateContacts();
    }
    if (page === "workspace" && !workspaceFiles.length && !workspaceLoading) {
      loadWorkspaceFiles();
    }
  }, [page]);

  useEffect(() => {
    const attachments = Array.isArray(taskDetail?.attachments) ? taskDetail.attachments : [];
    const imageAttachments = attachments
      .map((attachment, index) => ({ attachment, index }))
      .filter(({ attachment }) => isImageAttachment(attachment));

    setTaskImagePreviews({});
    setTaskImagePreviewStates({});

    if (!taskDetail?.taskId || !imageAttachments.length) {
      return undefined;
    }

    let canceled = false;
    for (const { attachment, index } of imageAttachments) {
      loadTaskImagePreview(attachment, index, { silent: true, isCanceled: () => canceled });
    }

    return () => {
      canceled = true;
    };
  }, [taskDetail?.taskId]);

  const contextUsed = useMemo(() => {
    const cachedUsage = activeConversationId ? usageCache[activeConversationId] : null;
    const promptTokens = usage?.prompt_tokens || usage?.promptTokens || cachedUsage?.prompt_tokens || cachedUsage?.promptTokens || 0;
    if (promptTokens) {
      return promptTokens;
    }
    const text = messages
      .map((item) => item.text)
      .join("\n");
    return Math.ceil(text.length / 4);
  }, [activeConversationId, messages, usage, usageCache]);

  const contextMax = Number(modelConfig.contextLength || 0) || 1000000;
  const contextPercent = Math.min(100, Math.round((contextUsed / contextMax) * 100));
  const draftDirty = Boolean(selectedDraft && draftEditText !== (selectedDraft.draftText || ""));
  const draftCreateCourse = useMemo(
    () => draftCreateCourses.find((course, index) => getCourseOptionKey(course, index) === draftCreateCourseKey) || null,
    [draftCreateCourses, draftCreateCourseKey],
  );
  const draftCreateTask = useMemo(
    () => draftCreateTasks.find((task) => String(getTaskId(task) || "") === draftCreateTaskId) || null,
    [draftCreateTasks, draftCreateTaskId],
  );
  const homeworkCourse = useMemo(
    () => homeworkCourses.find((course, index) => getCourseOptionKey(course, index) === homeworkCourseKey) || null,
    [homeworkCourses, homeworkCourseKey],
  );

  async function refreshSession() {
    try {
      const result = await window.bxb.getSession();
      setSession(result);
      setStatus(result?.ready ? `当前用户：${result?.user?.name || "已登录"}` : "未登录");
    } catch (error) {
      setStatus(error.message);
    }
  }

  async function callTool(name, args = {}) {
    setStatus(`调用 ${name}...`);
    try {
      const result = await window.bxb.callTool(name, args);
      setStatus(`${name} 完成`);
      return result;
    } catch (error) {
      setStatus(error.message);
      throw error;
    }
  }

  function applyConversationState(state) {
    setConversations(state?.conversations || []);
    const nextActiveId = state?.activeId || "";
    setActiveConversationId(nextActiveId);
    setMessages(state?.activeConversation?.messages || []);
  }

  async function loadConversations() {
    try {
      applyConversationState(await window.bxb.listConversations());
    } catch (error) {
      setStatus(error.message);
    }
  }

  async function browserLogin() {
    await callTool("login_in_browser", {});
    await refreshSession();
  }

  async function toggleSessionMenu() {
    if (!session?.ready) {
      setStatus("请先登录后再切换学期");
      return;
    }
    const nextOpen = !sessionMenuOpen;
    setSessionMenuOpen(nextOpen);
    if (nextOpen) {
      await loadSessionChoices();
    }
  }

  async function loadSessionChoices() {
    const termResult = await callTool("list_terms", {});
    const termRows = termResult?.terms || termResult?.items || termResult?.records || session?.availableTerms || [];
    setTerms(Array.isArray(termRows) ? termRows : []);
  }

  async function switchTerm(term) {
    const termName = getTermName(term);
    const termId = getTermId(term);
    if (!termName && !termId) {
      setStatus("无法识别学期名称或 ID");
      return;
    }
    await callTool("set_current_term", termName ? { term_name: termName } : { term_id: termId });
    const nextSession = await window.bxb.getSession();
    setSession(nextSession);
    const termResult = await callTool("list_terms", {});
    const termRows = termResult?.terms || termResult?.items || termResult?.records || nextSession?.availableTerms || [];
    const currentTermId = nextSession?.currentTermId;
    const currentTermName = nextSession?.currentTermName || nextSession?.availableTerms?.find((item) => item?.id === currentTermId)?.name;
    setTerms(Array.isArray(termRows) ? termRows.map((item) => ({
      ...item,
      status: currentTermId ? getTermId(item) === currentTermId : getTermName(item) === currentTermName,
    })) : []);
    setHomeworkCourses([]);
    setHomeworkCourseKey("");
    setTasks([]);
    setTaskDetail(null);
    setStatus(`已切换学期：${termName || termId}`);
  }

  async function loadHomeworkCourses(options = {}) {
    if (!options.keepLoading) {
      setHomeworkCourseLoading(true);
    }
    try {
      const result = await callTool("list_courses", {});
      const rows = result?.courses || result?.items || result?.records || session?.availableSubjects || [];
      const nextCourses = Array.isArray(rows) ? rows : [];
      const allIndex = nextCourses.findIndex((course) => isAllCourses(course));
      const withAll = allIndex >= 0
        ? nextCourses
        : [{ id: "__all_courses__", name: allCoursesName, allSubjects: true }, ...nextCourses];
      const currentCourse = withAll.find((course, index) => getCourseOptionKey(course, index) === homeworkCourseKey);
      const nextCourse = currentCourse || withAll.find((course) => isAllCourses(course)) || withAll[0] || null;
      const nextIndex = nextCourse ? withAll.indexOf(nextCourse) : -1;
      const nextKey = nextCourse ? getCourseOptionKey(nextCourse, nextIndex) : "";
      setHomeworkCourses(withAll);
      setHomeworkCourseKey(nextKey);
      return { courses: withAll, course: nextCourse, key: nextKey };
    } finally {
      if (!options.keepLoading) {
        setHomeworkCourseLoading(false);
      }
    }
  }

  async function loadTasks(listType = "all", course = homeworkCourse) {
    setHomeworkListType(listType);
    let targetCourse = course;
    if (!targetCourse && !homeworkCourses.length) {
      const loaded = await loadHomeworkCourses({ keepLoading: true });
      targetCourse = loaded.course;
    }
    const result = await callTool("list_tasks", courseTaskArgs(targetCourse, listType));
    setTasks(extractTaskRows(result));
    setTaskDetail(null);
    await refreshSession();
    setPage("homework");
  }

  async function handleHomeworkCourseChange(nextKey) {
    setHomeworkCourseKey(nextKey);
    setTaskDetail(null);
    const nextCourse = homeworkCourses.find((course, index) => getCourseOptionKey(course, index) === nextKey);
    await loadTasks(homeworkListType, nextCourse);
  }

  async function openTask(taskId) {
    if (!taskId) return;
    const result = await callTool("read_task_content", { task_id: String(taskId), max_chars: 6000 });
    setTaskDetail(result);
  }

  async function loadTaskImagePreview(attachment, index = 0, options = {}) {
    const fileId = attachment?.fileId;
    const taskId = taskDetail?.taskId;
    const key = getAttachmentKey(attachment, index);
    if (!fileId || !taskId) return;

    setTaskImagePreviewStates((current) => ({
      ...current,
      [key]: { loading: true, error: "" },
    }));

    try {
      const downloaded = await window.bxb.callTool("download_task_attachment", {
        task_id: String(taskId),
        file_id: String(fileId),
      });
      const preview = await window.bxb.getWorkspaceImageDataUrl(downloaded.path);
      if (options.isCanceled?.()) return;
      setTaskImagePreviews((current) => ({ ...current, [key]: preview }));
      setTaskImagePreviewStates((current) => ({ ...current, [key]: { loading: false, error: "" } }));
      if (!options.silent) {
        setStatus(`已加载图片：${preview.fileName}`);
      }
    } catch (error) {
      if (options.isCanceled?.()) return;
      setTaskImagePreviewStates((current) => ({
        ...current,
        [key]: { loading: false, error: error.message || String(error) },
      }));
    }
  }

  async function loadWorkspaceFiles(query = workspaceQuery) {
    setWorkspaceLoading(true);
    try {
      const result = await callTool("list_workspace_files", { query, max_files: 300 });
      setWorkspaceFiles(Array.isArray(result?.files) ? result.files : []);
      setStatus(`工作区 ${result?.count || 0} 个文件`);
    } finally {
      setWorkspaceLoading(false);
    }
  }

  async function importWorkspaceFiles() {
    setWorkspaceLoading(true);
    try {
      const result = await window.bxb.importWorkspaceFiles();
      if (!result?.canceled) {
        setStatus(`已导入 ${result?.imported?.length || 0} 个文件`);
      }
      await loadWorkspaceFiles();
    } catch (error) {
      setStatus(error.message);
    } finally {
      setWorkspaceLoading(false);
    }
  }

  async function openWorkspaceFile(file) {
    setSelectedWorkspaceFile(file);
    setWorkspacePreview({ loading: true, file });
    try {
      if (isWorkspaceImageFile(file)) {
        const image = await window.bxb.getWorkspaceImageDataUrl(file.path);
        setWorkspacePreview({ file, image });
        setStatus(`已预览图片：${image.fileName}`);
        return;
      }
      const result = await callTool("read_workspace_file", {
        file: file.relativePath || file.name,
        max_chars: 8000,
      });
      setWorkspacePreview(result);
    } catch (error) {
      setWorkspacePreview({ error: error.message, file });
    }
  }

  async function renameWorkspaceFile(file) {
    if (!file) return;
    const nextName = prompt("新的文件名", file.name);
    if (!nextName || nextName === file.name) return;
    await callTool("rename_workspace_file", {
      file: file.relativePath || file.name,
      new_name: nextName,
    });
    setWorkspacePreview(null);
    setSelectedWorkspaceFile(null);
    await loadWorkspaceFiles();
  }

  async function openWorkspaceFolder() {
    try {
      await window.bxb.openWorkspaceFolder();
    } catch (error) {
      setStatus(error.message);
    }
  }

  async function openAppPath(key) {
    try {
      await window.bxb.openAppPath(key);
      setStatus("已打开路径");
    } catch (error) {
      setStatus(error.message);
    }
  }

  async function loadPrivateContacts() {
    setPrivateLoading(true);
    try {
      const result = await callTool("list_private_message_contacts", {});
      const contacts = Array.isArray(result?.contacts) ? result.contacts : [];
      setPrivateContacts(contacts);
      setPage("messages");
      if (!selectedPrivateContact && contacts.length) {
        await openPrivateContact(contacts[0]);
      }
    } finally {
      setPrivateLoading(false);
    }
  }

  async function openPrivateContact(contact) {
    if (!contact) return;
    setPrivateLoading(true);
    try {
      setSelectedPrivateContact(contact);
      const result = await callTool("get_private_message_thread", { contact, size: 30 });
      setPrivateThread(Array.isArray(result?.messages) ? result.messages : []);
    } finally {
      setPrivateLoading(false);
    }
  }

  async function sendPrivateText() {
    const content = privateText.trim();
    if (!selectedPrivateContact || !content) return;
    setPrivateLoading(true);
    try {
      await callTool("send_private_message_text", { contact: selectedPrivateContact, content });
      setPrivateText("");
      await openPrivateContact(selectedPrivateContact);
      const result = await callTool("list_private_message_contacts", {});
      setPrivateContacts(Array.isArray(result?.contacts) ? result.contacts : []);
      setStatus("私信已发送");
    } finally {
      setPrivateLoading(false);
    }
  }

  async function loadDraftCreateTasks(course = draftCreateCourse, options = {}) {
    if (!course) {
      setDraftCreateTasks([]);
      setDraftCreateTaskId("");
      return;
    }

    if (!options.keepLoading) {
      setDraftCreateLoading(true);
    }

    try {
      const subjectName = getCourseName(course);
      const subjectId = getCourseId(course);
      const classId = getCourseClassId(course);
      const args = {
        list_type: "all",
        page: 1,
        size: 100,
      };

      if (subjectName) {
        args.subject_name = subjectName;
      } else if (subjectId) {
        args.subject_id = subjectId;
      }
      if (classId) {
        args.class_id = classId;
      }

      const result = await callTool("list_tasks", args);
      const rows = extractTaskRows(result).filter((task) => getTaskId(task));
      setDraftCreateTasks(rows);
      setDraftCreateTaskId(rows.length ? String(getTaskId(rows[0]) || "") : "");
      await refreshSession();
      setStatus(rows.length ? `已加载 ${rows.length} 个 task` : "这个课程暂无 task");
    } finally {
      if (!options.keepLoading) {
        setDraftCreateLoading(false);
      }
    }
  }

  async function loadDraftCreateCourses() {
    setDraftCreateLoading(true);
    try {
      const result = await callTool("list_courses", {});
      const rows = result?.courses || result?.items || result?.records || session?.availableSubjects || [];
      const nextCourses = Array.isArray(rows) ? rows.filter((course) => !isAllCourses(course)) : [];
      setDraftCreateCourses(nextCourses);

      const currentCourse = nextCourses.find((course, index) => getCourseOptionKey(course, index) === draftCreateCourseKey);
      const nextCourse = currentCourse || nextCourses[0] || null;
      const nextIndex = nextCourse ? nextCourses.indexOf(nextCourse) : -1;
      const nextKey = nextCourse ? getCourseOptionKey(nextCourse, nextIndex) : "";
      setDraftCreateCourseKey(nextKey);
      setDraftCreateTasks([]);
      setDraftCreateTaskId("");

      if (nextCourse) {
        await loadDraftCreateTasks(nextCourse, { keepLoading: true });
      } else {
        setStatus("暂无可创建草稿的课程");
      }
    } finally {
      setDraftCreateLoading(false);
    }
  }

  async function handleDraftCreateCourseChange(nextKey) {
    setDraftCreateCourseKey(nextKey);
    setDraftCreateTasks([]);
    setDraftCreateTaskId("");
    const nextCourse = draftCreateCourses.find((course, index) => getCourseOptionKey(course, index) === nextKey);
    if (nextCourse) {
      await loadDraftCreateTasks(nextCourse);
    }
  }

  async function openDraftCreator() {
    setDraftCreateOpen(true);
    try {
      if (!draftCreateCourses.length) {
        await loadDraftCreateCourses();
      }
    } catch (error) {
      setStatus(error.message);
    }
  }

  function closeDraftCreator() {
    setDraftCreateOpen(false);
  }

  async function createManualDraft() {
    const draftText = draftCreateText.trim();
    if (!draftCreateCourse) {
      setStatus("请先选择课程");
      return;
    }
    if (!draftCreateTask) {
      setStatus("请先选择 task");
      return;
    }
    if (!draftText) {
      setStatus("请先填写草稿正文");
      return;
    }

    setDraftCreateLoading(true);
    try {
      const result = await callTool("draft_task_submission", {
        task_id: String(getTaskId(draftCreateTask)),
        subject_name: getCourseName(draftCreateCourse) || "",
        task_title: getTaskTitle(draftCreateTask),
        draft_text: draftText,
        summary: draftCreateSummary.trim() || "用户手动创建草稿",
        evidence: [],
        warnings: [],
        missing_info: [],
        needs_user_input: false,
      });
      const createdDraft = result?.draft || result;
      const createdDraftId = createdDraft?.draftId || result?.draftId;
      setDraftCreateSummary("");
      setDraftCreateText("");
      setDraftCreateOpen(false);
      await loadDrafts("pending_review");
      if (createdDraftId) {
        await openDraft(createdDraftId);
      }
      setStatus("草稿已创建，状态为待审核");
    } finally {
      setDraftCreateLoading(false);
    }
  }

  async function loadDrafts(statusFilter = "pending_review") {
    setDraftStatusFilter(statusFilter);
    const result = await callTool("list_submission_drafts", { status: statusFilter });
    setDrafts(result?.drafts || []);
    setPage("drafts");
  }

  async function openDraft(draftId) {
    const result = await callTool("get_submission_draft", { draft_id: draftId });
    const draft = result?.draft || result;
    setSelectedDraft(draft);
    setDraftEditText(draft?.draftText || "");
  }

  async function saveDraftEdits() {
    if (!selectedDraft?.draftId || !draftEditText.trim()) return;
    setDraftSaving(true);
    try {
      const result = await callTool("update_submission_draft", {
        draft_id: selectedDraft.draftId,
        draft_text: draftEditText,
      });
      const updated = result?.draft || result;
      setSelectedDraft(updated);
      setDraftEditText(updated?.draftText || "");
      await loadDrafts(draftStatusFilter);
      setStatus("草稿已保存");
    } finally {
      setDraftSaving(false);
    }
  }

  async function approveDraft() {
    if (!selectedDraft?.draftId) return;
    await callTool("approve_submission_draft", { draft_id: selectedDraft.draftId, review_note: "UI approved" });
    setSelectedDraft(null);
    setDraftEditText("");
    await loadDrafts("pending_review");
  }

  async function rejectDraft() {
    if (!selectedDraft?.draftId) return;
    await callTool("reject_submission_draft", { draft_id: selectedDraft.draftId, review_note: "UI rejected" });
    setSelectedDraft(null);
    setDraftEditText("");
    await loadDrafts("pending_review");
  }

  async function deleteDraft() {
    if (!selectedDraft?.draftId) return;
    const confirmed = confirm(`删除草稿“${draftTitle(selectedDraft)}”？这只会删除本地草稿文件，不会影响伴学邦。`);
    if (!confirmed) return;
    await callTool("delete_submission_draft", { draft_id: selectedDraft.draftId });
    setSelectedDraft(null);
    setDraftEditText("");
    await loadDrafts(draftStatusFilter);
    setStatus("草稿已删除");
  }

  async function sendAgent(text = input) {
    const trimmed = text.trim();
    if (!trimmed || running) return;
    if (trimmed === "/compact") {
      await compactChat();
      return;
    }
    setInput("");
    setMessages((current) => [...current, { role: "user", text: trimmed }]);
    setSteps([]);
    setUsage(null);
    setRunning(true);
    setStartedAt(performance.now());
    const requestId = crypto.randomUUID();
    try {
      const result = await window.bxb.chat({ text: trimmed, requestId, conversationId: activeConversationId });
      setMessages((current) => [...current, { role: "assistant", text: result.message }]);
      setSteps(result.steps || []);
      setUsage(result.usage || null);
      if (result.usage && activeConversationId) {
        setUsageCache((current) => ({ ...current, [activeConversationId]: result.usage }));
      }
      if (result.conversation) {
        await loadConversations();
      }
      setStatus("助手已完成");
    } catch (error) {
      setMessages((current) => [...current, { role: "assistant", text: `执行失败：${error.message}` }]);
      setStatus(error.message);
    } finally {
      setRunning(false);
    }
  }

  async function newChat() {
    applyConversationState(await window.bxb.createConversation({ title: "新对话" }));
    setConversationMenuOpen(false);
    setSteps([]);
    setUsage(null);
    setElapsed("0.0s");
    setStatus("已开始新对话");
  }

  async function selectChat(conversationId) {
    if (running) return;
    applyConversationState(await window.bxb.selectConversation(conversationId));
    setConversationMenuOpen(false);
    setSteps([]);
    setUsage(usageCache[conversationId] || null);
    setElapsed("0.0s");
    setStatus("已切换对话");
  }

  async function renameChat(conversationId, currentTitle) {
    setRenamingConversationId(conversationId);
    setRenameValue(currentTitle || "新对话");
  }

  async function saveRename(conversationId) {
    const title = renameValue.trim();
    if (!title) {
      setStatus("对话名称不能为空");
      return;
    }
    applyConversationState(await window.bxb.renameConversation(conversationId, title));
    setRenamingConversationId("");
    setRenameValue("");
    setStatus("对话已重命名");
  }

  function cancelRename() {
    setRenamingConversationId("");
    setRenameValue("");
  }

  async function deleteChat(conversationId) {
    if (!window.confirm("确定删除这个对话吗？此操作只删除本机保存的对话记录。")) return;
    applyConversationState(await window.bxb.deleteConversation(conversationId));
    setConversationMenuOpen(false);
    setSteps([]);
    setUsage(null);
    setElapsed("0.0s");
    setStatus("对话已删除");
  }

  async function compactChat() {
    setInput("");
    setSteps([]);
    setUsage(null);
    setRunning(true);
    setStartedAt(performance.now());
    try {
      const result = await window.bxb.compactChat({ conversationId: activeConversationId });
      const summaryText = [
        "已压缩上下文，保留近期对话和关键任务信息。",
        "",
        result.summary,
      ].join("\n");
      setMessages([{ role: "assistant", text: summaryText }]);
      setUsage(result.usage || null);
      if (result.usage && activeConversationId) {
        setUsageCache((current) => ({ ...current, [activeConversationId]: result.usage }));
      }
      await loadConversations();
      setStatus(`上下文已压缩：${result.previousTurns} 条历史 -> ${result.keptTurns} 条`);
    } catch (error) {
      setMessages((current) => [...current, { role: "assistant", text: `压缩失败：${error.message}` }]);
      setStatus(error.message);
    } finally {
      setRunning(false);
    }
  }

  async function saveConfig() {
    const saved = await window.bxb.saveModelConfig(modelConfig);
    setModelConfig(saved);
    setStatus("模型配置已保存");
  }

  async function clearConfig() {
    const cleared = await window.bxb.clearModelConfig();
    setModelConfig(cleared);
    setModelResult(null);
    setModelOptions([]);
    setStatus("模型配置已清除");
  }

  function restoreDefaultPrompt() {
    setModelConfig((current) => ({
      ...current,
      systemPrompt: current.defaultSystemPrompt || fallbackSystemPrompt,
    }));
    setStatus("已恢复默认提示词，点击保存设置后生效");
  }

  async function testConfig() {
    try {
      const result = await window.bxb.testModelConfig(modelConfig);
      setModelResult(result);
      setStatus(result.message);
    } catch (error) {
      setModelResult({ ok: false, message: error.message });
      setStatus(error.message);
    }
  }

  async function loadModelOptions() {
    setModelOptionsLoading(true);
    try {
      const result = await window.bxb.listModelOptions(modelConfig);
      const ids = Array.isArray(result?.modelIds) ? result.modelIds : [];
      setModelOptions(ids);
      setModelResult(null);
      if (!modelConfig.modelName && ids.length) {
        setModelConfig((current) => ({ ...current, modelName: ids[0] }));
      }
      setStatus(result.message || `已读取 ${ids.length} 个模型`);
    } catch (error) {
      setStatus(error.message);
    } finally {
      setModelOptionsLoading(false);
    }
  }

  async function checkUpdates() {
    setUpdateLoading(true);
    try {
      const result = await window.bxb.checkForUpdates();
      setUpdateResult(result);
      setStatus(result.message || (result.hasUpdate ? "发现新版本" : "已是最新版本"));
    } catch (error) {
      const fallback = {
        ok: false,
        message: error.message,
        releasesUrl: "https://github.com/GRAY-XY/BXB_tools/releases",
      };
      setUpdateResult(fallback);
      setStatus(error.message);
    } finally {
      setUpdateLoading(false);
    }
  }

  async function openUpdateLink(url) {
    try {
      await window.bxb.openUpdateUrl(url || updateResult?.releasesUrl || "https://github.com/GRAY-XY/BXB_tools/releases");
      setStatus("已打开更新链接");
    } catch (error) {
      setStatus(error.message);
    }
  }

  async function openPage(key) {
    setPage(key);
    if (key === "homework") {
      try {
        if (!homeworkCourses.length) {
          await loadHomeworkCourses();
        }
      } catch (error) {
        setStatus(error.message);
      }
      return;
    }
    if (key !== "drafts") {
      return;
    }

    try {
      if (!drafts.length) {
        await loadDrafts(draftStatusFilter);
      }
    } catch (error) {
      setStatus(error.message);
    }
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">BXB</div>
          <div>
            <div className="brand-title">BXB Homework</div>
            <div className="brand-subtitle">Agent workspace</div>
          </div>
        </div>
        <nav>
          {pages.map(([key, label]) => (
            <button key={key} className={page === key ? "nav active" : "nav"} onClick={() => openPage(key)}>
              {label}
            </button>
          ))}
        </nav>
        <div className="session-switcher">
          {sessionMenuOpen && (
            <div className="session-menu">
              <div className="session-menu-section">
                <div className="session-menu-title">切换学期</div>
                {terms.length === 0 ? (
                  <div className="session-empty">暂无学期数据</div>
                ) : (
                  terms.map((term, index) => {
                    const name = getTermName(term) || `学期 ${index + 1}`;
                    const id = getTermId(term);
                    const currentTermId = session?.currentTermId;
                    const currentTermName = session?.currentTermName || session?.availableTerms?.find((item) => getTermId(item) === currentTermId)?.name;
                    const active = currentTermId ? id === currentTermId : name === currentTermName;
                    return (
                      <button key={`${id || name}-${index}`} className={active ? "session-menu-item active" : "session-menu-item"} onClick={() => switchTerm(term)}>
                        <span>{name}</span>
                        {active && <b>当前</b>}
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          )}
          <button className={sessionMenuOpen ? "sidebar-card open" : "sidebar-card"} onClick={toggleSessionMenu}>
            <div className="eyebrow">Session</div>
            <strong>{session?.ready ? session?.user?.name || "已登录" : "未登录"}</strong>
            <span>{session?.currentTermName || "选择学期"}</span>
          </button>
        </div>
      </aside>

      <main className="content">
        {page === "home" && (
          <section>
            <PageTitle title="Banxuebang Homework" subtitle="Electron + React desktop shell, powered by existing local tools." />
            <div className="metrics">
              <Metric label="UI Runtime" value="Electron" />
              <Metric label="Agent" value="LLM + Tools" />
              <Metric label="Session" value={session?.ready ? "Ready" : "Login required"} />
            </div>
            <div className="grid two">
              <div className="card">
                <h2>登录</h2>
                <p>使用现有 Playwright 登录流程。登录状态保存在本机应用数据目录，不会上传到仓库。</p>
                <button className="primary" onClick={browserLogin}>浏览器登录</button>
                <button onClick={refreshSession}>刷新会话</button>
              </div>
              <div className="card">
                <h2>当前会话</h2>
                <SessionSummary session={session} />
              </div>
            </div>
          </section>
        )}

        {page === "agent" && (
          <section className="agent-page">
            <PageTitle title="Agent Assistant" subtitle="工具调用、工作过程和 Markdown 渲染在同一页面。" />
            <div className="agent-toolbar card">
              <div className="conversation-menu-wrap">
                <button
                  className={conversationMenuOpen ? "conversation-toggle active" : "conversation-toggle"}
                  onClick={() => setConversationMenuOpen((open) => !open)}
                  disabled={running}
                >
                  对话
                </button>
                {conversationMenuOpen && (
                  <div className="conversation-menu">
                    <div className="conversation-head">
                      <div>
                        <span>Conversations</span>
                        <h2>对话</h2>
                      </div>
                      <button className="primary conversation-new" onClick={newChat} disabled={running}>新建</button>
                    </div>
                    <div className="conversation-list">
                      {!conversations.length && <div className="conversation-empty">暂无对话</div>}
                      {conversations.map((conversation) => (
                        <div
                          key={conversation.id}
                          className={conversation.id === activeConversationId ? "conversation-item active" : "conversation-item"}
                        >
                          {renamingConversationId === conversation.id ? (
                            <div className="conversation-rename">
                              <input
                                autoFocus
                                value={renameValue}
                                onChange={(event) => setRenameValue(event.target.value)}
                                onKeyDown={(event) => {
                                  if (event.key === "Enter") saveRename(conversation.id);
                                  if (event.key === "Escape") cancelRename();
                                }}
                              />
                              <button className="primary" onClick={() => saveRename(conversation.id)}>保存</button>
                              <button onClick={cancelRename}>取消</button>
                            </div>
                          ) : (
                            <>
                              <button className="conversation-main" onClick={() => selectChat(conversation.id)} disabled={running}>
                                <span className="conversation-dot" />
                                <span className="conversation-text">
                                  <strong>{conversation.title || "新对话"}</strong>
                                  <small>{formatConversationTime(conversation.updatedAt)} · {conversation.messageCount || 0} 条消息</small>
                                </span>
                              </button>
                              <div className="conversation-actions">
                                <button title="重命名" onClick={() => renameChat(conversation.id, conversation.title)} disabled={running}>改名</button>
                                <button title="删除" onClick={() => deleteChat(conversation.id)} disabled={running}>删除</button>
                              </div>
                            </>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              {quickPrompts.map((prompt) => (
                <button key={prompt} onClick={() => sendAgent(prompt)}>{prompt}</button>
              ))}
              <button onClick={newChat}>新对话</button>
              <div className="context-meter">
                <span>上下文 {contextUsed} / {contextMax}</span>
                <div><i style={{ width: `${contextPercent}%` }} /></div>
              </div>
            </div>
            <div className="agent-layout">
              <div className="chat card">
                <div className="messages">
                  {messages.map((message, index) => (
                    <article key={index} className={`message ${message.role}`}>
                      <div className="message-label">{message.role === "user" ? "你" : "助手"}</div>
                      <div className="message-body" dangerouslySetInnerHTML={md(message.text)} />
                    </article>
                  ))}
                  <div ref={chatEndRef} />
                </div>
                <form className="composer" onSubmit={(event) => { event.preventDefault(); sendAgent(); }}>
                  <input value={input} onChange={(event) => setInput(event.target.value)} placeholder="输入：列出课程、打开任务、帮我写某个作业草稿，或 /compact 压缩上下文..." />
                  <button className="primary" disabled={running}>{running ? "执行中" : "发送"}</button>
                </form>
              </div>
              <div className="steps card">
                <div className="steps-head">
                  <h2>{running ? `Worked for ${elapsed}` : "工作过程"}</h2>
                </div>
                {steps.map((step, index) => (
                  <details key={index} open={index === steps.length - 1}>
                    <summary>{step.title}</summary>
                    {step.detail && <pre>{step.detail}</pre>}
                  </details>
                ))}
                <div ref={stepsEndRef} />
              </div>
            </div>
          </section>
        )}

        {page === "homework" && (
          <section>
            <PageTitle title="作业中心" subtitle="选择科目后查看作业；不会要求用户切换全局当前科目。" />
            <div className="card toolbar homework-toolbar">
              <label>科目
                <select
                  value={homeworkCourseKey}
                  onChange={(event) => handleHomeworkCourseChange(event.target.value)}
                  disabled={homeworkCourseLoading}
                >
                  {!homeworkCourses.length && <option value="">选择科目</option>}
                  {homeworkCourses.map((course, index) => {
                    const key = getCourseOptionKey(course, index);
                    return (
                      <option key={key} value={key}>
                        {isAllCourses(course) ? allCoursesName : getCourseName(course) || `课程 ${index + 1}`}
                      </option>
                    );
                  })}
                </select>
              </label>
              <button onClick={() => loadHomeworkCourses()} disabled={homeworkCourseLoading}>
                {homeworkCourseLoading ? "加载中" : "刷新科目"}
              </button>
              <button className="primary" onClick={() => loadTasks("all")}>刷新作业</button>
              <button onClick={() => loadTasks("pending")}>待处理作业</button>
            </div>
            <div className="grid two wide-left">
              <div className="card table-card">
                <table>
                  <thead><tr><th>ID</th><th>课程</th><th>任务</th><th>截止</th><th>成绩</th></tr></thead>
                  <tbody>
                    {!tasks.length && (
                      <tr>
                        <td colSpan="5" className="empty-cell">暂无作业数据，选择科目后点击刷新作业或待处理作业。</td>
                      </tr>
                    )}
                    {tasks.map((task, index) => {
                      const id = getTaskId(task);
                      return (
                        <tr key={index} onClick={() => openTask(id)}>
                          <td>{id}</td>
                          <td>{getTaskCourse(task, session)}</td>
                          <td>{getTaskTitle(task)}</td>
                          <td>{getTaskDeadline(task)}</td>
                          <td>{getTaskStatus(task)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="card task-detail-card">
                <TaskDetailView
                  detail={taskDetail}
                  imagePreviews={taskImagePreviews}
                  imagePreviewStates={taskImagePreviewStates}
                  onRetryImagePreview={loadTaskImagePreview}
                />
              </div>
            </div>
          </section>
        )}

        {page === "workspace" && (
          <section className="workspace-page">
            <PageTitle title="工作区" subtitle="本地文件区：用户导入、助手下载和助手创建的文件都放在这里。" />
            <div className="card toolbar workspace-toolbar">
              <button className="primary" onClick={importWorkspaceFiles} disabled={workspaceLoading}>导入文件</button>
              <button onClick={() => loadWorkspaceFiles()} disabled={workspaceLoading}>{workspaceLoading ? "刷新中" : "刷新"}</button>
              <button onClick={openWorkspaceFolder}>打开文件夹</button>
              <input
                value={workspaceQuery}
                onChange={(event) => setWorkspaceQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") loadWorkspaceFiles(event.currentTarget.value);
                }}
                placeholder="搜索文件名..."
              />
            </div>
            <div className="workspace-layout">
              <div className="card workspace-files">
                <div className="workspace-path">{appInfo?.workspaceDir || "工作区目录加载中"}</div>
                {!workspaceFiles.length && <div className="session-empty">暂无文件，点击“导入文件”添加 PDF、DOCX、图片或文本。</div>}
                {workspaceFiles.map((file) => (
                  <button
                    key={file.relativePath}
                    className={selectedWorkspaceFile?.relativePath === file.relativePath ? "workspace-file active" : "workspace-file"}
                    onClick={() => openWorkspaceFile(file)}
                  >
                    <span className={`file-badge ${file.category || "file"}`}>{(file.extension || "file").replace(".", "") || "file"}</span>
                    <span className="workspace-file-main">
                      <strong>{file.name}</strong>
                      <small>{file.relativePath} · {formatFileSize(file.size)} · {formatMessageTime(file.modifiedAt)}</small>
                    </span>
                  </button>
                ))}
              </div>
              <div className="card workspace-preview">
                <div className="workspace-preview-head">
                  <h2>{selectedWorkspaceFile?.name || "文件预览"}</h2>
                  <button onClick={() => renameWorkspaceFile(selectedWorkspaceFile)} disabled={!selectedWorkspaceFile}>重命名</button>
                </div>
                {workspacePreview?.loading && <div className="session-empty">正在读取文件...</div>}
                {workspacePreview?.error && <div className="status error">{workspacePreview.error}</div>}
                {!workspacePreview && <div className="session-empty">选择一个文件查看可读取文本。助手也可以通过文件名读取和重命名工作区文件。</div>}
                {workspacePreview?.image?.dataUrl && (
                  <div className="workspace-image-preview">
                    <img src={workspacePreview.image.dataUrl} alt={workspacePreview.image.fileName || selectedWorkspaceFile?.name || "工作区图片"} />
                    <small>{workspacePreview.image.fileName} · {formatFileSize(workspacePreview.image.sizeBytes)}</small>
                  </div>
                )}
                {workspacePreview?.file?.text && (
                  <pre className="workspace-text">{workspacePreview.file.text}</pre>
                )}
                {workspacePreview?.file && !workspacePreview.image && !workspacePreview.file.text && !workspacePreview.loading && !workspacePreview.error && (
                  <JsonBlock data={workspacePreview.file} />
                )}
              </div>
            </div>
          </section>
        )}

        {page === "messages" && (
          <section className="private-page">
            <PageTitle title="私信" subtitle="读取并发送伴学邦私信，发送只会在你点击按钮后执行。" />
            <div className="card toolbar">
              <button className="primary" onClick={loadPrivateContacts} disabled={privateLoading}>
                {privateLoading ? "刷新中" : "刷新私信"}
              </button>
              <span className="muted">当前只支持文本私信；图片和附件会显示占位。</span>
            </div>
            <div className="private-layout">
              <div className="card private-contacts">
                <h2>联系人</h2>
                <div className="private-contact-list">
                  {!privateContacts.length && <div className="session-empty">暂无私信联系人，点击刷新私信。</div>}
                  {privateContacts.map((contact) => (
                    <button
                      key={contact.id || `${contact.classId}-${contact.peerId}`}
                      className={selectedPrivateContact?.id === contact.id ? "private-contact active" : "private-contact"}
                      onClick={() => openPrivateContact(contact)}
                    >
                      <span className="private-avatar">{(contact.peerName || "?").slice(0, 1)}</span>
                      <span className="private-contact-main">
                        <strong>{contact.peerName || "未知联系人"}</strong>
                        <small>{contact.courseName || contact.className || "私信"}</small>
                        <em>{contact.lastContent || "暂无内容"}</em>
                      </span>
                      {contact.unreadNum > 0 && <b>{contact.unreadNum}</b>}
                    </button>
                  ))}
                </div>
              </div>
              <div className="card private-thread">
                {selectedPrivateContact ? (
                  <>
                    <div className="private-thread-head">
                      <div>
                        <h2>{selectedPrivateContact.peerName || "未知联系人"}</h2>
                        <span>{selectedPrivateContact.courseName || selectedPrivateContact.className || "私信会话"}</span>
                      </div>
                      <button onClick={() => openPrivateContact(selectedPrivateContact)} disabled={privateLoading}>刷新</button>
                    </div>
                    <div className="private-message-list">
                      {!privateThread.length && <div className="session-empty">暂无消息。</div>}
                      {privateThread.map((message) => {
                        const own = message.senderType === "S" || message.senderId === session?.user?.id;
                        return (
                          <article key={message.id} className={own ? "private-message own" : "private-message"}>
                            <div className="private-message-meta">
                              <span>{message.senderName || (own ? "我" : selectedPrivateContact.peerName)}</span>
                              <time>{formatMessageTime(message.createTime)}</time>
                              {own && <i>{message.readFlag ? "已读" : "未读"}</i>}
                            </div>
                            <div>{privateMessageContent(message)}</div>
                          </article>
                        );
                      })}
                    </div>
                    <form className="private-composer" onSubmit={(event) => { event.preventDefault(); sendPrivateText(); }}>
                      <textarea
                        value={privateText}
                        onChange={(event) => setPrivateText(event.target.value)}
                        placeholder="输入私信内容，点击发送..."
                        rows={3}
                      />
                      <button className="primary" disabled={privateLoading || !privateText.trim()}>发送</button>
                    </form>
                  </>
                ) : (
                  <div className="session-empty">选择一个联系人查看私信。</div>
                )}
              </div>
            </div>
          </section>
        )}

        {page === "drafts" && (
          <section className="review-page">
            <PageTitle title="草稿" subtitle="创建、查看和审核本地草稿；这里只保存本地内容，不做上传提交。" />
            <div className="card toolbar">
              <button className="primary" onClick={openDraftCreator}>新建草稿</button>
              <button className="primary" onClick={() => loadDrafts("pending_review")}>刷新待审核</button>
              <button onClick={() => loadDrafts("all")}>全部草稿</button>
              <button onClick={saveDraftEdits} disabled={!draftDirty || draftSaving || !draftEditText.trim()}>
                {draftSaving ? "保存中" : "保存修改"}
              </button>
              <button onClick={approveDraft} disabled={!selectedDraft}>通过</button>
              <button onClick={rejectDraft} disabled={!selectedDraft}>驳回</button>
              <button className="danger" onClick={deleteDraft} disabled={!selectedDraft}>删除草稿</button>
            </div>
            {draftCreateOpen ? (
              <div className="draft-create-only">
                <div className="card draft-create-card form">
                  <div className="draft-create-head">
                    <h2>创建草稿</h2>
                    <div className="draft-create-head-actions">
                      <button type="button" onClick={loadDraftCreateCourses} disabled={draftCreateLoading}>
                        {draftCreateLoading ? "加载中" : "刷新课程"}
                      </button>
                      <button type="button" onClick={closeDraftCreator} disabled={draftCreateLoading}>取消</button>
                    </div>
                  </div>
                  <label>课程
                    <select
                      value={draftCreateCourseKey}
                      onChange={(event) => handleDraftCreateCourseChange(event.target.value)}
                      disabled={draftCreateLoading}
                    >
                      <option value="">选择课程</option>
                      {draftCreateCourses.map((course, index) => {
                        const key = getCourseOptionKey(course, index);
                        return (
                          <option key={key} value={key}>
                            {getCourseName(course) || `课程 ${index + 1}`}
                          </option>
                        );
                      })}
                    </select>
                  </label>
                  <label>Task
                    <select
                      value={draftCreateTaskId}
                      onChange={(event) => setDraftCreateTaskId(event.target.value)}
                      disabled={draftCreateLoading || !draftCreateCourse}
                    >
                      <option value="">选择 task</option>
                      {draftCreateTasks.map((task, index) => {
                        const taskId = String(getTaskId(task) || "");
                        return (
                          <option key={`${taskId || "task"}-${index}`} value={taskId}>
                            {getTaskTitle(task)} · {getTaskStatus(task)}
                          </option>
                        );
                      })}
                    </select>
                  </label>
                  <label>摘要
                    <input
                      value={draftCreateSummary}
                      onChange={(event) => setDraftCreateSummary(event.target.value)}
                      placeholder="可选，例如：手动整理的初稿"
                    />
                  </label>
                  <label>草稿正文
                    <textarea
                      className="draft-create-text"
                      value={draftCreateText}
                      onChange={(event) => setDraftCreateText(event.target.value)}
                      placeholder="输入要保存到本地草稿的正文..."
                      spellCheck={false}
                    />
                  </label>
                  <div className="draft-create-actions">
                    <button
                      type="button"
                      onClick={() => loadDraftCreateTasks(draftCreateCourse)}
                      disabled={draftCreateLoading || !draftCreateCourse}
                    >
                      刷新 task
                    </button>
                    <button
                      type="button"
                      className="primary"
                      onClick={createManualDraft}
                      disabled={draftCreateLoading || !draftCreateCourse || !draftCreateTask || !draftCreateText.trim()}
                    >
                      创建草稿
                    </button>
                  </div>
                  <small className="draft-create-hint">新建草稿默认保存为待审核，只写入本地草稿库。创建完成后会回到草稿列表和详情。</small>
                </div>
              </div>
            ) : (
              <div className="review-layout">
                <div className="card draft-list">
                  <h2>草稿列表</h2>
                  {!drafts.length && <div className="session-empty">暂无草稿。可以让助手生成，也可以在上方手动创建。</div>}
                  {drafts.map((draft) => (
                    <button
                      key={draft.draftId}
                      className={selectedDraft?.draftId === draft.draftId ? "draft-list-item active" : "draft-list-item"}
                      onClick={() => openDraft(draft.draftId)}
                    >
                      <span className={`draft-status ${draftStatusClass(draft.status)}`}>{formatDraftStatus(draft.status)}</span>
                      <strong>{draftTitle(draft)}</strong>
                      <small>{draft.subjectName || "未知课程"} · {formatMessageTime(draft.updatedAt) || "无更新时间"}</small>
                      {(draft.missingInfoCount > 0 || draft.warningCount > 0 || draft.needsUserInput) && (
                        <em>
                          {draft.needsUserInput ? "需要补充信息" : ""}
                          {draft.missingInfoCount > 0 ? ` · 缺少 ${draft.missingInfoCount} 项` : ""}
                          {draft.warningCount > 0 ? ` · 注意 ${draft.warningCount} 项` : ""}
                        </em>
                      )}
                    </button>
                  ))}
                </div>
                <div className="card draft-preview-card">
                <DraftPreview
                  draft={selectedDraft}
                  draftEditText={draftEditText}
                  draftDirty={draftDirty}
                  draftSaving={draftSaving}
                  onDraftTextChange={setDraftEditText}
                  onSaveDraft={saveDraftEdits}
                  onResetDraft={() => setDraftEditText(selectedDraft?.draftText || "")}
                />
                </div>
              </div>
            )}
          </section>
        )}

        {page === "settings" && (
          <section>
            <PageTitle title="设置" subtitle="模型、界面、Agent 和软件更新。" />
            <div className="settings-layout">
              <div className="card form settings-card-wide">
                <h2>模型配置</h2>
                <label>API Key<input type="password" value={modelConfig.apiKey || ""} onChange={(event) => setModelConfig({ ...modelConfig, apiKey: event.target.value })} /></label>
                <label>调用链接<input value={modelConfig.baseUrl || ""} onChange={(event) => setModelConfig({ ...modelConfig, baseUrl: event.target.value })} placeholder="https://api.example.com/v1" /></label>
                <label>模型名称
                  <div className="model-picker">
                    {modelOptions.length > 0 ? (
                      <select
                        value={modelConfig.modelName || ""}
                        onChange={(event) => setModelConfig({ ...modelConfig, modelName: event.target.value })}
                      >
                        <option value="">选择模型</option>
                        {modelConfig.modelName && !modelOptions.includes(modelConfig.modelName) && (
                          <option value={modelConfig.modelName}>{modelConfig.modelName}（当前）</option>
                        )}
                        {modelOptions.map((modelId) => (
                          <option key={modelId} value={modelId}>{modelId}</option>
                        ))}
                      </select>
                    ) : (
                      <input
                        value={modelConfig.modelName || ""}
                        onChange={(event) => setModelConfig({ ...modelConfig, modelName: event.target.value })}
                        placeholder="手动输入，或先读取模型列表后选择"
                      />
                    )}
                    <button type="button" onClick={loadModelOptions} disabled={modelOptionsLoading || !modelConfig.baseUrl}>
                      {modelOptionsLoading ? "读取中" : "读取模型"}
                    </button>
                  </div>
                </label>
                <label>上下文长度<input value={modelConfig.contextLength || ""} onChange={(event) => setModelConfig({ ...modelConfig, contextLength: event.target.value })} /></label>
                <div className="temperature-grid">
                  <label>助手对话 Temperature
                    <input
                      type="number"
                      min="0"
                      max="2"
                      step="0.1"
                      value={modelConfig.chatTemperature ?? 0.2}
                      onChange={(event) => setModelConfig({ ...modelConfig, chatTemperature: event.target.value })}
                    />
                  </label>
                  <label>压缩上下文 Temperature
                    <input
                      type="number"
                      min="0"
                      max="2"
                      step="0.1"
                      value={modelConfig.compactTemperature ?? 0.1}
                      onChange={(event) => setModelConfig({ ...modelConfig, compactTemperature: event.target.value })}
                    />
                  </label>
                </div>
                <div className="toolbar">
                  <button className="primary" onClick={saveConfig}>保存配置</button>
                  <button onClick={testConfig}>测试连通性</button>
                  <button onClick={clearConfig}>清除配置</button>
                </div>
                {modelResult && <JsonBlock data={modelResult} />}
              </div>
              <div className="card update-card">
                <div className="update-head">
                  <div>
                    <h2>软件更新</h2>
                    <p>Windows 预览版</p>
                  </div>
                  <span className="update-version">v{appInfo?.version || "unknown"}</span>
                </div>
                <div className="update-facts">
                  <div>
                    <span>当前版本</span>
                    <strong>{appInfo?.version || "读取中"}</strong>
                  </div>
                  <div>
                    <span>最新版本</span>
                    <strong>{updateResult?.latestVersion || "-"}</strong>
                  </div>
                  <div>
                    <span>状态</span>
                    <strong>
                      {updateLoading
                        ? "检查中"
                        : updateResult?.hasUpdate
                          ? "有新版本"
                          : updateResult
                            ? updateResult.ok
                              ? "已是最新"
                              : "检查失败"
                            : "未检查"}
                    </strong>
                  </div>
                </div>
                {updateResult?.latestTitle && (
                  <div className={updateResult.hasUpdate ? "update-result available" : "update-result"}>
                    <strong>{updateResult.latestTitle}</strong>
                    <span>{updateResult.publishedAt ? `发布时间：${formatMessageTime(updateResult.publishedAt)}` : ""}</span>
                    {updateResult.installerAsset && (
                      <span>
                        安装包：{updateResult.installerAsset.name}
                        {updateResult.installerAsset.size ? ` · ${formatFileSize(updateResult.installerAsset.size)}` : ""}
                      </span>
                    )}
                  </div>
                )}
                {updateResult && !updateResult.ok && (
                  <div className="status error">{updateResult.message || "暂时无法检查更新。"}</div>
                )}
                <div className="toolbar">
                  <button className="primary" onClick={checkUpdates} disabled={updateLoading}>
                    {updateLoading ? "检查中" : "检查更新"}
                  </button>
                  <button onClick={() => openUpdateLink(updateResult?.latestUrl || updateResult?.releasesUrl)}>
                    打开 Release 页面
                  </button>
                  {updateResult?.installerAsset?.downloadUrl && (
                    <button onClick={() => openUpdateLink(updateResult.installerAsset.downloadUrl)}>
                      下载安装包
                    </button>
                  )}
                </div>
              </div>
              <div className="card form">
                <label>主题
                  <select value={theme} onChange={(event) => setTheme(event.target.value)}>
                    <option value="light">浅色</option>
                    <option value="dark">深色</option>
                  </select>
                </label>
                <label>最大工具轮次<input value={modelConfig.maxToolRounds || 6} onChange={(event) => setModelConfig({ ...modelConfig, maxToolRounds: event.target.value })} /></label>
                <label>AI 系统提示词
                  <textarea
                    value={modelConfig.systemPrompt || ""}
                    onChange={(event) => setModelConfig({ ...modelConfig, systemPrompt: event.target.value })}
                    rows={7}
                  />
                </label>
                <div className="toolbar">
                  <button className="primary" onClick={saveConfig}>保存设置</button>
                  <button onClick={restoreDefaultPrompt}>恢复默认提示词</button>
                  <button onClick={() => openUpdateLink("https://github.com/GRAY-XY/BXB_tools")}>打开 GitHub</button>
                </div>
              </div>
              <div className="card path-card settings-card-wide">
                <h2>路径</h2>
                <div className="path-list">
                  {appPathRows(appInfo).map((item) => (
                    <div key={item.key} className="path-item">
                      <div>
                        <strong>{item.title}</strong>
                        <span>{item.description}</span>
                        <code>{item.path}</code>
                      </div>
                      <button type="button" onClick={() => openAppPath(item.key)}>打开路径</button>
                    </div>
                  ))}
                  {!appInfo && <div className="session-empty">路径信息加载中。</div>}
                </div>
              </div>
            </div>
          </section>
        )}
      </main>

      <footer>{status}</footer>
    </div>
  );
}

function PageTitle({ title, subtitle }) {
  return (
    <header className="page-title">
      <h1>{title}</h1>
      <p>{subtitle}</p>
    </header>
  );
}

function Metric({ label, value }) {
  return (
    <div className="metric card">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
