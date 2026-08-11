import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { marked } from "marked";
import katex from "katex";
import "katex/dist/katex.min.css";
import "./styles.css";

const pages = [
  ["home", "主页"],
  ["agent", "助手"],
  ["homework", "作业"],
  ["workspace", "工作区"],
  ["messages", "私信"],
  ["drafts", "草稿"],
  ["review", "复习"],
  ["settings", "设置"],
];

const featureToggleRows = [
  ["autoDetect", "自动识别作业"],
  ["autoComplete", "AI 自动完成（实验）"],
  ["knowledgeReview", "知识点复习"],
  ["gpaAlert", "GPA 预警"],
  ["reminder", "未交作业提醒"],
  ["autoSubmit", "自动提交（实验）"],
  ["ocr", "图片 OCR"],
  ["notifications", "桌面通知"],
];

const quickPrompts = [
  "列出课程",
  "列出所有课程作业",
  "列出待处理作业",
  "查看成绩概览",
];

const fallbackSystemPrompt =
  "你是伴学邦桌面助手。需要真实数据时必须调用工具，不要猜测。需要联网资料时先调用 web_search；需要阅读某个搜索结果时再调用 read_web_page。用户提到工作区文件时，先调用 list_workspace_files 定位文件，再按需调用 read_workspace_file；需要整理文件名时可调用 rename_workspace_file。不要上传、提交、私信或删除任何内容。处理作业草稿时先调用 collect_task_submission_context；信息不足就说明缺什么；信息足够才调用 draft_task_submission 保存草稿等待用户审核。如果作业已过期且可能无法补交，可以在草稿提示字段中建议用户私信老师，但只能保存草稿等待用户审核。给出或保存草稿正文时，draft_text 必须是纯文本正文，不要使用 Markdown 标题、列表、表格、代码块、加粗、引用或其他 Markdown 格式；如果需要给用户说明保存状态，可以在助手回复里用 Markdown，但草稿正文内容本身必须保持纯文本。";

const allCoursesName = "全部课程";
const imageAttachmentExtensions = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".avif"]);

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderMath(source, displayMode = false) {
  try {
    return katex.renderToString(source, {
      displayMode,
      throwOnError: false,
      strict: false,
      output: "html",
    });
  } catch {
    return displayMode ? `<pre>${escapeHtml(source)}</pre>` : escapeHtml(source);
  }
}

function markdownWithMath(text) {
  let source = String(text || "");
  const codeSlots = [];
  const mathSlots = [];

  const stashCode = (value) => {
    const token = `@@BXBCODE${codeSlots.length}@@`;
    codeSlots.push(value);
    return token;
  };
  const stashMath = (value, displayMode) => {
    const token = `@@BXBMATH${mathSlots.length}@@`;
    mathSlots.push(renderMath(value.trim(), displayMode));
    return token;
  };

  source = source
    .replace(/```[\s\S]*?```/g, stashCode)
    .replace(/`[^`\n]+`/g, stashCode);

  source = source
    .replace(/\\\[([\s\S]+?)\\\]/g, (_match, math) => stashMath(math, true))
    .replace(/\$\$([\s\S]+?)\$\$/g, (_match, math) => stashMath(math, true))
    .replace(/\\\(([\s\S]+?)\\\)/g, (_match, math) => stashMath(math, false))
    .replace(/(^|[^\\$])\$([^\n$]*?\S)\$/g, (_match, prefix, math) => `${prefix}${stashMath(math, false)}`);

  source = source.replace(/@@BXBCODE(\d+)@@/g, (_match, index) => codeSlots[Number(index)] || "");

  let html = marked.parse(source, { breaks: true, gfm: true });
  html = html.replace(/@@BXBMATH(\d+)@@/g, (_match, index) => mathSlots[Number(index)] || "");
  return html;
}

function md(text) {
  return { __html: markdownWithMath(text) };
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

  const pendingTasks = Array.isArray(result?.pendingHomeworkList)
    ? result.pendingHomeworkList.map((task) => ({ ...task, __statusText: task.statusText || "待处理" }))
    : [];
  const pending = Array.isArray(result?.unsubmittedHomeworkList)
    ? result.unsubmittedHomeworkList.map((task) => ({ ...task, __statusText: task.statusText || "未提交" }))
    : [];
  const homework = Array.isArray(result?.homeworkList)
    ? result.homeworkList.map((task) => ({
        ...task,
        __statusText: task.statusText || (task.isParticipate === 0 ? "未提交" : task.scoreLevel || task.score || "已提交/已记录"),
      }))
    : [];
  const rowsById = new Map();
  for (const task of [...pendingTasks, ...pending, ...homework]) {
    const id = getTaskId(task);
    rowsById.set(id || `row-${rowsById.size}`, task);
  }
  return [...rowsById.values()];
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
  if (normalized === "submitted") return "已提交到作业";
  if (normalized === "sent_to_teacher") return "已私信老师";
  return normalized || "未知状态";
}

function draftStatusClass(status) {
  const normalized = String(status || "").trim();
  if (normalized === "approved") return "approved";
  if (normalized === "rejected") return "rejected";
  if (normalized === "submitted") return "submitted";
  if (normalized === "sent_to_teacher") return "sent";
  if (normalized === "pending_review") return "pending";
  return "unknown";
}

function draftTitle(draft) {
  return draft?.taskTitle || (draft?.taskId ? `任务 ${draft.taskId}` : "未命名草稿");
}

function isDraftDelivered(draft) {
  return draft?.status === "submitted" || draft?.status === "sent_to_teacher";
}

function privateContactKey(contact) {
  return [
    contact?.contactKey || "",
    contact?.id || "",
    contact?.classId || "",
    contact?.peerId || "",
    contact?.receiverId || "",
    contact?.senderId || "",
  ].join("|");
}

function privateContactLabel(contact) {
  if (!contact) return "未选择";
  const parts = [
    contact.peerName || contact.receiverName || contact.senderName || "未知联系人",
    contact.courseName || contact.className,
  ].filter(Boolean);
  return parts.join(" · ");
}

function pastedFilePrompt(files) {
  if (!files.length) return "";
  const rows = files.map((file) => {
    const detail = file.kind === "text"
      ? `${file.charCount || 0} 字的文本文件`
      : "图片文件";
    return `- ${file.relativePath || file.name}（${detail}）`;
  });
  return [
    "我在工作区中附带了以下文件。请先调用 list_workspace_files 定位，再按需读取并结合这些文件回答：",
    ...rows,
  ].join("\n");
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
  const isDelivered = isDraftDelivered(draft);
  const deliveryHistory = Array.isArray(draft.deliveryHistory) ? draft.deliveryHistory : [];

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
            <button type="button" onClick={onResetDraft} disabled={isDelivered || !draftDirty || draftSaving}>还原</button>
            <button type="button" className="primary" onClick={onSaveDraft} disabled={isDelivered || !draftDirty || draftSaving || !draftEditText.trim()}>
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
          readOnly={isDelivered}
        />
        <small className="draft-edit-hint">
          {isDelivered
            ? "这是已经交付过的正文记录。如需再次提交或私信，请新建草稿并重新审核。"
            : draftDirty
              ? "有未保存修改。保存只会更新本地草稿，不会上传或提交。"
              : "保存只会更新本地草稿，不会上传或提交。"}
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

      {draft.submittedAt && (
        <section className="draft-section">
          <h3>提交记录</h3>
          <p>
            {`提交时间：${formatMessageTime(draft.submittedAt) || draft.submittedAt}`}
            {draft.submission?.modeLabel ? `\n提交类型：${draft.submission.modeLabel}` : ""}
            {draft.submission?.submissionId ? `\n提交记录 ID：${draft.submission.submissionId}` : ""}
          </p>
        </section>
      )}

      {deliveryHistory.length > 0 && (
        <section className="draft-section">
          <h3>交付记录</h3>
          <div className="draft-delivery-list">
            {deliveryHistory.map((record, index) => (
              <div key={`${record.type || "delivery"}-${index}`} className={`draft-delivery ${record.status || ""}`}>
                <strong>
                  {record.type === "teacher_private_message" ? "私信老师" : "作业 Task"}
                  {record.status === "failed" ? "失败" : "成功"}
                </strong>
                <span>
                  {record.type === "teacher_private_message"
                    ? `${privateContactLabel(record.contact)} · ${record.sentCount ?? record.chunkCount ?? 0}/${record.chunkCount ?? 0} 条`
                    : `${record.modeLabel || "提交"} · ${record.submissionId || "无提交记录 ID"}`}
                </span>
                <small>
                  {formatMessageTime(record.sentAt || record.submittedAt || record.failedAt) || "-"}
                  {record.error ? ` · ${record.error}` : ""}
                </small>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function DraftSubmissionConfirmation({ preview, loading, onCancel, onConfirm, onSwitchToMessage }) {
  if (!preview) return null;
  const attachments = Array.isArray(preview.retainedAttachments) ? preview.retainedAttachments : [];

  return (
    <div className="draft-submit-confirm">
      <div className="draft-submit-head">
        <div>
          <span>提交确认</span>
          <h2>{preview.taskTitle || `任务 ${preview.taskId || ""}`}</h2>
        </div>
        <strong>{preview.modeLabel || "提交"}</strong>
      </div>

      <div className="draft-submit-facts">
        <div><span>目标课程</span><strong>{preview.subjectName || "未知课程"}</strong></div>
        <div><span>Task ID</span><strong>{preview.taskId || "-"}</strong></div>
        <div><span>提交位置</span><strong>{preview.destination || "伴学邦作业提交"}</strong></div>
        <div><span>提交类型</span><strong>{preview.modeLabel || "提交"}</strong></div>
      </div>

      {preview.note && <div className="draft-submit-notice">{preview.note}</div>}
      {!preview.canSubmit && <div className="draft-submit-error">{preview.reason || "当前无法提交。"}</div>}
      {preview.error && <div className="draft-submit-error">{preview.error}</div>}

      <section className="draft-section">
        <h3>即将提交的正文</h3>
        <pre className="draft-submit-text">{preview.draftText || ""}</pre>
      </section>

      <section className="draft-section">
        <h3>随提交保留的已有附件</h3>
        {attachments.length ? (
          <div className="draft-submit-files">
            {attachments.map((attachment, index) => (
              <div key={`${attachment.fileId || attachment.fileName}-${index}`}>
                <strong>{attachment.fileName || `附件 ${index + 1}`}</strong>
                <span>{attachment.fileSize ? formatFileSize(attachment.fileSize) : "大小未知"}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="muted">无附件。本次只提交上方正文。</p>
        )}
      </section>

      <div className="draft-submit-actions">
        <button type="button" onClick={onCancel} disabled={loading}>返回草稿</button>
        {(preview.suggestTeacherMessage || preview.error || !preview.canSubmit) && (
          <button type="button" onClick={onSwitchToMessage} disabled={loading}>改用私信老师</button>
        )}
        <button type="button" className="primary" onClick={onConfirm} disabled={loading || !preview.canSubmit}>
          {loading ? "提交中" : "确认并提交"}
        </button>
      </div>
      <small>点击“确认并提交”后会立即调用伴学邦提交或补交接口。</small>
    </div>
  );
}

function DraftPrivateMessageConfirmation({
  preview,
  selectedKey,
  loading,
  onSelectContact,
  onCancel,
  onConfirm,
}) {
  if (!preview) return null;
  const contacts = Array.isArray(preview.contacts) ? preview.contacts : [];
  const chunks = Array.isArray(preview.chunks) ? preview.chunks : [];
  const selectedContact = preview.selectedContact || contacts.find((contact) => privateContactKey(contact) === selectedKey) || null;

  return (
    <div className="draft-submit-confirm">
      <div className="draft-submit-head">
        <div>
          <span>私信确认</span>
          <h2>{preview.taskTitle || `任务 ${preview.taskId || ""}`}</h2>
        </div>
        <strong>私信老师</strong>
      </div>

      <div className="draft-submit-facts">
        <div><span>目标课程</span><strong>{preview.subjectName || "未知课程"}</strong></div>
        <div><span>Task ID</span><strong>{preview.taskId || "-"}</strong></div>
        <div><span>提交位置</span><strong>{preview.destination || "伴学邦私信老师"}</strong></div>
        <div><span>分条数量</span><strong>{chunks.length || 0} 条</strong></div>
      </div>

      {preview.note && <div className="draft-submit-notice">{preview.note}</div>}
      {preview.error && <div className="draft-submit-error">{preview.error}</div>}
      {!preview.canSend && <div className="draft-submit-notice">{preview.reason || "请选择联系人后再发送。"}</div>}

      <section className="draft-section">
        <h3>目标联系人</h3>
        <select
          value={selectedContact ? privateContactKey(selectedContact) : selectedKey || ""}
          onChange={(event) => onSelectContact?.(event.target.value)}
          disabled={loading}
        >
          <option value="">选择已有私信联系人</option>
          {contacts.map((contact) => {
            const key = privateContactKey(contact);
            const suffix = contact.recommended
              ? `（推荐${contact.matchReasons?.length ? `：${contact.matchReasons.join("、")}` : ""}）`
              : "";
            return (
              <option key={key} value={key}>
                {privateContactLabel(contact)}{suffix}
              </option>
            );
          })}
        </select>
      </section>

      <section className="draft-section">
        <h3>即将发送的分条内容</h3>
        <div className="draft-message-chunks">
          {chunks.map((chunk) => (
            <div key={chunk.index} className="draft-message-chunk">
              <strong>第 {chunk.index}/{chunk.total} 条 · {chunk.length} 字</strong>
              <pre className="draft-submit-text">{chunk.text}</pre>
            </div>
          ))}
        </div>
      </section>

      <div className="draft-submit-actions">
        <button type="button" onClick={onCancel} disabled={loading}>返回草稿</button>
        <button type="button" className="primary" onClick={onConfirm} disabled={loading || !preview.canSend}>
          {loading ? "发送中" : "确认并分条发送"}
        </button>
      </div>
      <small>确认后会逐条发送到所选已有私信联系人；任一条失败会停止后续发送。</small>
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

function formatUpdateStatus(state, result, loading) {
  if (state?.status === "downloading") return "下载中";
  if (state?.status === "verifying") return "校验中";
  if (state?.status === "ready_to_install") return "等待安装";
  if (state?.status === "installing") return "安装中";
  if (state?.status === "error") return "出错";
  if (loading || state?.status === "checking") return "检查中";
  if (result?.hasUpdate) return "有新版本";
  if (result) return result.ok ? "已是最新" : "检查失败";
  return "未检查";
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
      key: "updateDir",
      title: "更新缓存",
      description: "保存应用内下载的安装器、校验信息和待安装状态。",
      path: appInfo.updateDir,
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
  const [featureConfig, setFeatureConfig] = useState(null);
  const [alertSummary, setAlertSummary] = useState(null);
  const [reviewIndex, setReviewIndex] = useState(null);
  const [reviewSubject, setReviewSubject] = useState("");
  const [reviewNoteContent, setReviewNoteContent] = useState("");
  const [reviewLoading, setReviewLoading] = useState(false);
  const [summarizeLoading, setSummarizeLoading] = useState(false);
  const [autoModes, setAutoModes] = useState(null);
  const [conversations, setConversations] = useState([]);
  const [activeConversationId, setActiveConversationId] = useState("");
  const [conversationMenuOpen, setConversationMenuOpen] = useState(false);
  const [renamingConversationId, setRenamingConversationId] = useState("");
  const [renameValue, setRenameValue] = useState("");
  const [confirmingDeleteConversationId, setConfirmingDeleteConversationId] = useState("");
  const [messages, setMessages] = useState([]);
  const [steps, setSteps] = useState([]);
  const [input, setInput] = useState("");
  const [composerFiles, setComposerFiles] = useState([]);
  const [composerPasteLoading, setComposerPasteLoading] = useState(false);
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
  const [draftSubmitPreview, setDraftSubmitPreview] = useState(null);
  const [draftSubmitLoading, setDraftSubmitLoading] = useState(false);
  const [draftDeliveryTarget, setDraftDeliveryTarget] = useState("task");
  const [draftMessagePreview, setDraftMessagePreview] = useState(null);
  const [draftMessageLoading, setDraftMessageLoading] = useState(false);
  const [draftMessageContactKey, setDraftMessageContactKey] = useState("");
  const [draftDeleteConfirming, setDraftDeleteConfirming] = useState(false);
  const [modelConfig, setModelConfig] = useState({
    apiKey: "",
    baseUrl: "",
    modelName: "",
    contextLength: 0,
    chatTemperature: 0.2,
    compactTemperature: 0.1,
    longPasteThreshold: 4000,
    maxToolRounds: 6,
    systemPrompt: fallbackSystemPrompt,
    defaultSystemPrompt: fallbackSystemPrompt,
  });
  const [modelResult, setModelResult] = useState(null);
  const [modelOptions, setModelOptions] = useState([]);
  const [modelOptionsLoading, setModelOptionsLoading] = useState(false);
  const [updateResult, setUpdateResult] = useState(null);
  const [updateState, setUpdateState] = useState({ status: "idle", percent: 0, message: "" });
  const [updateLoading, setUpdateLoading] = useState(false);
  const chatEndRef = useRef(null);
  const stepsEndRef = useRef(null);
  const composerInputRef = useRef(null);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("bxb-theme", theme);
  }, [theme]);

  useEffect(() => {
    window.bxb.getAppInfo().then(setAppInfo).catch((error) => setStatus(error.message));
    window.bxb.loadModelConfig().then(setModelConfig).catch((error) => setStatus(error.message));
    window.bxb.getFeatureConfig().then(setFeatureConfig).catch(() => {});
    window.bxb.getAutoModes().then(setAutoModes).catch(() => {});
    loadAlerts();
    loadConversations();
    refreshSession();
  }, []);

  async function updateFeatureConfig(patch) {
    try {
      const next = await window.bxb.saveFeatureConfig(patch);
      setFeatureConfig(next);
      setStatus("功能开关已保存");
    } catch (error) {
      setStatus(`无法保存功能开关：${error.message}`);
    }
  }

  async function loadAlerts() {
    try {
      setAlertSummary(await window.bxb.getAlertSummary());
    } catch {
      setAlertSummary(null);
    }
  }

  async function refreshAlertsNow() {
    try {
      setAlertSummary(await window.bxb.refreshAlerts());
      setStatus("预警检查完成");
    } catch (error) {
      setStatus(`预警检查失败：${error.message}`);
    }
  }

  async function loadReviewNotes() {
    try {
      const index = await window.bxb.listReviewNotes();
      setReviewIndex(index);
      if (index?.subjects?.length) {
        setReviewSubject((current) => current || index.subjects[0].subject);
      }
    } catch {
      setReviewIndex(null);
    }
  }

  async function refreshKnowledgeNow() {
    try {
      setReviewLoading(true);
      const result = await window.bxb.runKnowledgeRefresh();
      setReviewLoading(false);
      if (!result.ok) {
        setStatus(result.reason || "知识点刷新失败");
        return;
      }
      setReviewIndex(result.index);
      setReviewSubject(result.index?.subjects?.[0]?.subject || "");
      setReviewNoteContent("");
      setStatus(`知识点整理完成，共 ${result.count} 条作业内容`);
    } catch (error) {
      setReviewLoading(false);
      setStatus(`知识点刷新失败：${error.message}`);
    }
  }

  async function openReviewNote(subject, note) {
    try {
      setReviewNoteContent(await window.bxb.getReviewNote(note.file));
    } catch (error) {
      setStatus(`无法读取笔记：${error.message}`);
    }
  }

  async function summarizeNotesNow() {
    try {
      setSummarizeLoading(true);
      const result = await window.bxb.summarizeReviewNotes();
      setSummarizeLoading(false);
      if (!result.ok) {
        setStatus(result.reason || "AI 总结失败");
        return;
      }
      setReviewIndex(await window.bxb.listReviewNotes());
      setStatus(`AI 总结完成，共 ${result.summaries.length} 个学科`);
    } catch (error) {
      setSummarizeLoading(false);
      setStatus(`AI 总结失败：${error.message}`);
    }
  }

  async function changeAutoMode(courseId, mode) {
    try {
      const result = await window.bxb.setAutoMode(courseId, mode);
      setAutoModes((current) => ({ ...current, modes: result.modes }));
      setStatus("提交模式已保存");
    } catch (error) {
      setStatus(`无法保存提交模式：${error.message}`);
    }
  }

  async function runAutoCompleteNow() {
    try {
      const result = await window.bxb.runAutoComplete();
      setStatus(result.generated ? `已自动生成 ${result.generated} 条作业草稿，请到草稿页审核。` : result.reason || "没有需要自动完成的作业。");
    } catch (error) {
      setStatus(`自动完成失败：${error.message}`);
    }
  }

  useEffect(() => {
    const off = window.bxb.onAgentProgress(({ step }) => {
      setSteps((current) => [...current, step]);
    });
    return off;
  }, []);

  useEffect(() => {
    window.bxb.getUpdateStatus?.().then(setUpdateState).catch(() => {});
    const off = window.bxb.onUpdateProgress?.((state) => {
      setUpdateState(state);
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
    if (page === "home") {
      loadAlerts();
    }
    if (page === "review" && !reviewIndex) {
      loadReviewNotes();
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
  const draftInteractionLocked = Boolean(draftSubmitPreview || draftMessagePreview) || draftSubmitLoading || draftMessageLoading;
  const draftMessageContacts = Array.isArray(draftMessagePreview?.contacts) ? draftMessagePreview.contacts : [];
  const selectedDraftMessageContact = useMemo(
    () => draftMessageContacts.find((contact) => privateContactKey(contact) === draftMessageContactKey) || null,
    [draftMessageContacts, draftMessageContactKey],
  );
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

  function focusComposerSoon() {
    window.setTimeout(() => composerInputRef.current?.focus(), 0);
  }

  function focusComposerNow() {
    composerInputRef.current?.focus({ preventScroll: true });
  }

  function handleComposerPointer(event) {
    if (event.target?.tagName !== "BUTTON") {
      focusComposerNow();
    }
  }

  function insertComposerText(text) {
    const textarea = composerInputRef.current;
    const start = textarea?.selectionStart ?? input.length;
    const end = textarea?.selectionEnd ?? input.length;
    setInput((current) => `${current.slice(0, start)}${text}${current.slice(end)}`);
    window.setTimeout(() => {
      textarea?.focus({ preventScroll: true });
      textarea?.setSelectionRange?.(start + text.length, start + text.length);
    }, 0);
  }

  async function handleComposerPaste(event) {
    const clipboard = event.clipboardData;
    if (!clipboard || composerPasteLoading || running) return;

    const directFiles = Array.from(clipboard.files || []);
    const itemFiles = directFiles.length
      ? []
      : Array.from(clipboard.items || []).map((item) => item.getAsFile?.()).filter(Boolean);
    const imageFiles = [...directFiles, ...itemFiles].filter((file) => String(file.type || "").startsWith("image/"));
    const pastedText = clipboard.getData("text/plain") || "";
    const threshold = Math.max(500, Number.parseInt(modelConfig.longPasteThreshold || 4000, 10) || 4000);
    const isLongText = !imageFiles.length && pastedText.length >= threshold;
    if (!imageFiles.length && !isLongText) return;

    event.preventDefault();
    setComposerPasteLoading(true);
    try {
      const items = [];
      for (const file of imageFiles) {
        items.push({
          kind: "image",
          name: file.name || "",
          mimeType: file.type || "",
          bytes: new Uint8Array(await file.arrayBuffer()),
        });
      }
      if (isLongText) {
        items.push({
          kind: "text",
          name: `pasted-text-${new Date().toISOString().replace(/[:.]/g, "-")}.txt`,
          text: pastedText,
        });
      } else if (pastedText && !imageFiles.length) {
        insertComposerText(pastedText);
      }

      const result = await window.bxb.saveWorkspacePastes(items);
      const saved = Array.isArray(result?.saved) ? result.saved : [];
      setComposerFiles((current) => [...current, ...saved.map((file) => ({ ...file, id: crypto.randomUUID() }))]);
      setStatus(`已将 ${saved.length} 个粘贴内容保存到工作区`);
    } catch (error) {
      setStatus(`无法处理粘贴内容：${error.message}`);
    } finally {
      setComposerPasteLoading(false);
      focusComposerSoon();
    }
  }

  function removeComposerFile(fileId) {
    setComposerFiles((current) => current.filter((file) => file.id !== fileId));
    focusComposerSoon();
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
    setDraftSubmitPreview(null);
    setDraftMessagePreview(null);
    setDraftMessageContactKey("");
    setDraftDeleteConfirming(false);
    setDraftDeliveryTarget(draft?.deliveryTarget || draft?.preferredTarget || "task");
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
    if (draftDirty) {
      setStatus("请先保存草稿修改，再通过审核");
      return;
    }
    const result = await callTool("approve_submission_draft", { draft_id: selectedDraft.draftId, review_note: "UI approved" });
    const updated = result?.draft || result;
    setSelectedDraft(updated);
    setDraftEditText(updated?.draftText || "");
    await loadDrafts("all");
    setStatus("草稿已通过，可以在确认内容后提交到伴学邦");
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
    if (!draftDeleteConfirming) {
      setDraftDeleteConfirming(true);
      setStatus(`再次点击确认删除草稿“${draftTitle(selectedDraft)}”`);
      return;
    }
    await callTool("delete_submission_draft", { draft_id: selectedDraft.draftId });
    setSelectedDraft(null);
    setDraftEditText("");
    setDraftDeleteConfirming(false);
    await loadDrafts(draftStatusFilter);
    setStatus("草稿已删除");
  }

  function cancelDraftDelete() {
    setDraftDeleteConfirming(false);
    setStatus("已取消删除草稿");
  }

  async function prepareDraftSubmit() {
    if (!selectedDraft?.draftId || selectedDraft.status !== "approved") return;
    if (draftDirty) {
      setStatus("请先保存草稿修改，再准备提交");
      return;
    }

    setDraftSubmitLoading(true);
    setDraftSubmitPreview(null);
    setDraftMessagePreview(null);
    try {
      const preview = await callTool("prepare_draft_submission", { draft_id: selectedDraft.draftId });
      setDraftSubmitPreview(preview);
      setStatus(preview?.canSubmit ? "请核对即将提交的内容" : preview?.reason || "当前无法提交");
    } catch (error) {
      setStatus(`无法准备提交：${error.message}`);
    } finally {
      setDraftSubmitLoading(false);
    }
  }

  async function confirmDraftSubmit() {
    if (!selectedDraft?.draftId || !draftSubmitPreview?.canSubmit || draftSubmitLoading) return;
    setDraftSubmitLoading(true);
    try {
      const result = await callTool("submit_approved_draft", {
        draft_id: selectedDraft.draftId,
        confirmation_token: draftSubmitPreview.confirmationToken,
      });
      const updated = result?.draft || {
        ...selectedDraft,
        status: "submitted",
        submittedAt: result?.submittedAt || new Date().toISOString(),
        submission: {
          modeLabel: result?.preview?.modeLabel || "提交",
          submissionId: result?.submission?.submissionId || null,
        },
      };
      setSelectedDraft(updated);
      setDraftEditText(updated?.draftText || "");
      setDraftSubmitPreview(null);
      await loadDrafts("all");
      setStatus(
        result?.localRecordError
          ? `${result?.preview?.modeLabel || "提交"}成功，但${result.localRecordError}`
          : `${result?.preview?.modeLabel || "提交"}成功，草稿已标记为已提交`,
      );
    } catch (error) {
      setDraftSubmitPreview((current) => current ? { ...current, error: error.message, suggestTeacherMessage: true } : current);
      setStatus(`无法提交：${error.message}`);
    } finally {
      setDraftSubmitLoading(false);
    }
  }

  function cancelDraftSubmit() {
    if (draftSubmitLoading) return;
    setDraftSubmitPreview(null);
    setStatus("已取消提交");
  }

  async function prepareDraftPrivateMessage(contact = null) {
    if (!selectedDraft?.draftId || selectedDraft.status !== "approved") return;
    if (draftDirty) {
      setStatus("请先保存草稿修改，再准备私信");
      return;
    }

    setDraftMessageLoading(true);
    setDraftSubmitPreview(null);
    try {
      const args = { draft_id: selectedDraft.draftId };
      if (contact) {
        args.contact = contact;
      }
      const preview = await callTool("prepare_draft_private_message", args);
      setDraftMessagePreview(preview);
      setDraftMessageContactKey(preview.selectedContact ? privateContactKey(preview.selectedContact) : "");
      setStatus(preview?.canSend ? "请核对即将私信的内容" : preview?.reason || "请选择私信联系人");
    } catch (error) {
      setDraftMessagePreview((current) => current ? { ...current, error: error.message } : current);
      setStatus(`无法准备私信：${error.message}`);
    } finally {
      setDraftMessageLoading(false);
    }
  }

  async function handleDraftMessageContactChange(nextKey) {
    setDraftMessageContactKey(nextKey);
    const contact = draftMessageContacts.find((item) => privateContactKey(item) === nextKey);
    if (contact) {
      await prepareDraftPrivateMessage(contact);
    }
  }

  async function confirmDraftPrivateMessage() {
    if (!selectedDraft?.draftId || !draftMessagePreview?.canSend || draftMessageLoading) return;
    const contact = selectedDraftMessageContact || draftMessagePreview.selectedContact;
    if (!contact) {
      setStatus("请先选择私信联系人");
      return;
    }

    setDraftMessageLoading(true);
    try {
      const result = await callTool("send_approved_draft_private_message", {
        draft_id: selectedDraft.draftId,
        contact,
        confirmation_token: draftMessagePreview.confirmationToken,
      });
      if (!result?.sent) {
        const updated = result?.draft || selectedDraft;
        setSelectedDraft(updated);
        setDraftEditText(updated?.draftText || "");
        setDraftMessagePreview((current) => current ? {
          ...current,
          error: `已发送 ${result?.sentCount || 0} 条后失败：${result?.error || "未知错误"}`,
          canSend: false,
        } : current);
        await loadDrafts("all");
        setStatus(`私信部分发送失败，草稿仍保持已通过：${result?.error || "未知错误"}`);
        return;
      }

      const updated = result?.draft || {
        ...selectedDraft,
        status: "sent_to_teacher",
        sentToTeacherAt: result?.sentAt || new Date().toISOString(),
      };
      setSelectedDraft(updated);
      setDraftEditText(updated?.draftText || "");
      setDraftMessagePreview(null);
      setDraftMessageContactKey("");
      await loadDrafts("all");
      setStatus(
        result?.localRecordError
          ? `私信已发送，但${result.localRecordError}`
          : "私信已发送，草稿已标记为已私信老师",
      );
    } catch (error) {
      setDraftMessagePreview((current) => current ? { ...current, error: error.message } : current);
      setStatus(`无法私信老师：${error.message}`);
    } finally {
      setDraftMessageLoading(false);
    }
  }

  function cancelDraftPrivateMessage() {
    if (draftMessageLoading) return;
    setDraftMessagePreview(null);
    setDraftMessageContactKey("");
    setStatus("已取消私信");
  }

  async function switchDraftSubmitToMessage() {
    if (draftSubmitLoading || draftMessageLoading) return;
    setDraftDeliveryTarget("teacher_private_message");
    setDraftSubmitPreview(null);
    await prepareDraftPrivateMessage();
  }

  async function prepareSelectedDraftDelivery() {
    if (draftDeliveryTarget === "teacher_private_message") {
      await prepareDraftPrivateMessage();
    } else {
      await prepareDraftSubmit();
    }
  }

  async function sendAgent(text = input) {
    const typedText = text.trim();
    const fileContext = pastedFilePrompt(composerFiles);
    const trimmed = [typedText, fileContext].filter(Boolean).join("\n\n");
    if (!trimmed || running) return;
    if (trimmed === "/compact") {
      await compactChat();
      return;
    }
    setInput("");
    setComposerFiles([]);
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
    setRenamingConversationId("");
    setRenameValue("");
    setConfirmingDeleteConversationId("");
    setInput("");
    setComposerFiles([]);
    setSteps([]);
    setUsage(null);
    setElapsed("0.0s");
    setStatus("已开始新对话");
    focusComposerSoon();
  }

  async function selectChat(conversationId) {
    if (running) return;
    applyConversationState(await window.bxb.selectConversation(conversationId));
    setConversationMenuOpen(false);
    setRenamingConversationId("");
    setRenameValue("");
    setConfirmingDeleteConversationId("");
    setInput("");
    setComposerFiles([]);
    setSteps([]);
    setUsage(usageCache[conversationId] || null);
    setElapsed("0.0s");
    setStatus("已切换对话");
    focusComposerSoon();
  }

  async function renameChat(conversationId, currentTitle) {
    setConfirmingDeleteConversationId("");
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

  function requestDeleteChat(conversationId) {
    setRenamingConversationId("");
    setRenameValue("");
    setConfirmingDeleteConversationId(conversationId);
  }

  async function confirmDeleteChat(conversationId) {
    applyConversationState(await window.bxb.deleteConversation(conversationId));
    setConversationMenuOpen(false);
    setConfirmingDeleteConversationId("");
    setInput("");
    setComposerFiles([]);
    setSteps([]);
    setUsage(null);
    setElapsed("0.0s");
    setStatus("对话已删除");
    focusComposerSoon();
  }

  function cancelDeleteChat() {
    setConfirmingDeleteConversationId("");
  }

  async function compactChat() {
    setInput("");
    setComposerFiles([]);
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
      setUpdateState(await window.bxb.getUpdateStatus());
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

  async function downloadAndInstallUpdate() {
    setUpdateLoading(true);
    try {
      const state = await window.bxb.downloadUpdate();
      setUpdateState(state);
      setStatus(state.message || "更新已下载");
    } catch (error) {
      setStatus(error.message);
    } finally {
      setUpdateLoading(false);
    }
  }

  async function cancelUpdateDownload() {
    try {
      const state = await window.bxb.cancelUpdateDownload();
      setUpdateState(state);
      setStatus(state.message || "下载已取消");
    } catch (error) {
      setStatus(error.message);
    }
  }

  async function installDownloadedUpdate() {
    try {
      const state = await window.bxb.installUpdate();
      setUpdateState(state);
      setStatus(state.message || "正在启动安装器");
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

  const updateStatusLabel = formatUpdateStatus(updateState, updateResult, updateLoading);
  const updateBusy = ["checking", "downloading", "verifying", "installing"].includes(updateState?.status) || updateLoading;
  const updateDownloadBusy = ["downloading", "verifying"].includes(updateState?.status);
  const updateCanDownload = Boolean(
    updateResult?.hasUpdate &&
    updateResult?.installerAsset?.downloadUrl &&
    updateResult?.sha256Asset?.downloadUrl &&
    !updateBusy
  );
  const updateReadyToInstall = updateState?.status === "ready_to_install";
  const updateProgress = Number.isFinite(Number(updateState?.percent)) ? Number(updateState.percent) : 0;

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
            <div className="card alert-card">
              <div className="alert-head">
                <h2>预警中心</h2>
                <button onClick={refreshAlertsNow}>立即检查</button>
              </div>
              {!alertSummary ? (
                <p className="muted">预警加载中…（需要登录后才会显示 GPA 与作业提醒）</p>
              ) : alertSummary.gpa.filter((item) => item.dangerous).length === 0 && alertSummary.reminders.length === 0 ? (
                <p className="muted">暂无预警。</p>
              ) : (
                <div className="alert-list">
                  {alertSummary.gpa
                    .filter((item) => item.dangerous)
                    .map((item) => (
                      <div key={item.subject} className="alert-item danger">
                        <strong>GPA 预警：{item.subject}</strong>
                        <span>当前等级 {item.level}，已达到危险线</span>
                      </div>
                    ))}
                  {alertSummary.reminders.map((item) => (
                    <div key={`${item.taskId}-${item.status}`} className={`alert-item ${item.status === "overdue" ? "danger" : "warn"}`}>
                      <strong>{item.status === "overdue" ? "逾期未交" : "即将截止"}：{item.title}</strong>
                      <span>
                        {item.subject} · {item.status === "overdue" ? "已过期" : `还剩约 ${item.hoursLeft} 小时`} · {formatMessageTime(item.endTime)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
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
                          {confirmingDeleteConversationId === conversation.id ? (
                            <div className="conversation-confirm-delete">
                              <span>删除这个对话？</span>
                              <button className="danger" onClick={() => confirmDeleteChat(conversation.id)} disabled={running}>确认删除</button>
                              <button onClick={cancelDeleteChat}>取消</button>
                            </div>
                          ) : renamingConversationId === conversation.id ? (
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
                                <button title="删除" onClick={() => requestDeleteChat(conversation.id)} disabled={running}>删除</button>
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
                <form
                  className="composer"
                  onPointerDown={handleComposerPointer}
                  onClick={handleComposerPointer}
                  onSubmit={(event) => { event.preventDefault(); sendAgent(); }}
                >
                  {composerFiles.length > 0 && (
                    <div className="composer-files">
                      {composerFiles.map((file) => (
                        <div key={file.id} className="composer-file">
                          <span>
                            <strong>{file.kind === "text" ? `粘贴文本 · ${file.charCount || 0} 字` : file.name}</strong>
                            <small>{file.relativePath || file.name}</small>
                          </span>
                          <button type="button" title="移除待发送文件" onClick={() => removeComposerFile(file.id)} disabled={running}>×</button>
                        </div>
                      ))}
                    </div>
                  )}
                  <textarea
                    ref={composerInputRef}
                    rows={1}
                    value={input}
                    onPointerDown={(event) => event.currentTarget.focus({ preventScroll: true })}
                    onMouseDown={(event) => event.currentTarget.focus({ preventScroll: true })}
                    onClick={(event) => event.currentTarget.focus({ preventScroll: true })}
                    onChange={(event) => setInput(event.target.value)}
                    onPaste={handleComposerPaste}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault();
                        sendAgent();
                      }
                    }}
                    placeholder={composerPasteLoading ? "正在保存粘贴内容到工作区..." : "输入消息，或粘贴图片/长文本..."}
                  />
                  <button className="primary" disabled={running || composerPasteLoading || (!input.trim() && !composerFiles.length)}>
                    {running ? "执行中" : composerPasteLoading ? "处理中" : "发送"}
                  </button>
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
            <PageTitle title="草稿" subtitle="创建和审核本地草稿；已通过草稿可在确认完整内容后提交到作业 Task 或私信老师。" />
            <div className="card toolbar">
              <button className="primary" onClick={openDraftCreator} disabled={draftInteractionLocked}>新建草稿</button>
              <button className="primary" onClick={() => loadDrafts("pending_review")} disabled={draftInteractionLocked}>待审核</button>
              <button onClick={() => loadDrafts("approved")} disabled={draftInteractionLocked}>已通过</button>
              <button onClick={() => loadDrafts("submitted")} disabled={draftInteractionLocked}>已提交作业</button>
              <button onClick={() => loadDrafts("sent_to_teacher")} disabled={draftInteractionLocked}>已私信老师</button>
              <button onClick={() => loadDrafts("all")} disabled={draftInteractionLocked}>全部草稿</button>
              <button onClick={saveDraftEdits} disabled={isDraftDelivered(selectedDraft) || draftInteractionLocked || !draftDirty || draftSaving || !draftEditText.trim()}>
                {draftSaving ? "保存中" : "保存修改"}
              </button>
              <button onClick={approveDraft} disabled={draftInteractionLocked || !selectedDraft || selectedDraft.status === "approved" || isDraftDelivered(selectedDraft)}>通过</button>
              <button onClick={rejectDraft} disabled={draftInteractionLocked || !selectedDraft || selectedDraft.status === "rejected" || isDraftDelivered(selectedDraft)}>驳回</button>
              {selectedDraft?.status === "approved" && (
                <div className="draft-target-control">
                  <select
                    value={draftDeliveryTarget}
                    onChange={(event) => setDraftDeliveryTarget(event.target.value)}
                    disabled={draftInteractionLocked || draftDirty}
                  >
                    <option value="task">提交到作业 Task</option>
                    <option value="teacher_private_message">私信老师</option>
                  </select>
                  <button className="primary" onClick={prepareSelectedDraftDelivery} disabled={draftInteractionLocked || draftDirty}>
                    {draftSubmitLoading || draftMessageLoading
                      ? "准备中"
                      : draftDeliveryTarget === "teacher_private_message"
                        ? "准备私信"
                        : "准备提交"}
                  </button>
                </div>
              )}
              <button className="danger" onClick={deleteDraft} disabled={draftInteractionLocked || !selectedDraft}>
                {draftDeleteConfirming ? "确认删除" : "删除草稿"}
              </button>
              {draftDeleteConfirming && (
                <button onClick={cancelDraftDelete} disabled={draftInteractionLocked}>取消删除</button>
              )}
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
                      disabled={draftInteractionLocked}
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
                {draftSubmitPreview ? (
                  <DraftSubmissionConfirmation
                    preview={draftSubmitPreview}
                    loading={draftSubmitLoading}
                    onCancel={cancelDraftSubmit}
                    onConfirm={confirmDraftSubmit}
                    onSwitchToMessage={switchDraftSubmitToMessage}
                  />
                ) : draftMessagePreview ? (
                  <DraftPrivateMessageConfirmation
                    preview={draftMessagePreview}
                    selectedKey={draftMessageContactKey}
                    loading={draftMessageLoading}
                    onSelectContact={handleDraftMessageContactChange}
                    onCancel={cancelDraftPrivateMessage}
                    onConfirm={confirmDraftPrivateMessage}
                  />
                ) : (
                  <DraftPreview
                    draft={selectedDraft}
                    draftEditText={draftEditText}
                    draftDirty={draftDirty}
                    draftSaving={draftSaving}
                    onDraftTextChange={setDraftEditText}
                    onSaveDraft={saveDraftEdits}
                    onResetDraft={() => setDraftEditText(selectedDraft?.draftText || "")}
                  />
                )}
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
                <h2>功能开关</h2>
                <div className="feature-grid">
                  {featureToggleRows.map(([key, label]) => (
                    <label key={key} className="feature-toggle">
                      <input
                        type="checkbox"
                        checked={!!featureConfig?.[key]}
                        disabled={!featureConfig}
                        onChange={(event) => updateFeatureConfig({ [key]: event.target.checked })}
                      />
                      <span>{label}</span>
                    </label>
                  ))}
                </div>
                <div className="feature-row">
                  <label>
                    GPA 预警阈值
                    <select
                      value={featureConfig?.gpaThreshold || "B"}
                      disabled={!featureConfig}
                      onChange={(event) => updateFeatureConfig({ gpaThreshold: event.target.value })}
                    >
                      <option value="A">低于 A 即预警</option>
                      <option value="B">B 及以下预警（默认）</option>
                      <option value="C">C 及以下预警</option>
                      <option value="D">D 及以下预警</option>
                    </select>
                  </label>
                  <label>
                    未交作业提醒提前量（小时，逗号分隔）
                    <input
                      value={(featureConfig?.remindLeadHours || [24, 6, 1]).join(",")}
                      disabled={!featureConfig}
                      onChange={(event) =>
                        updateFeatureConfig({
                          remindLeadHours: event.target.value
                            .split(",")
                            .map((item) => Number(item.trim()))
                            .filter((item) => Number.isFinite(item) && item > 0),
                        })
                      }
                    />
                  </label>
                  <label>
                    默认提交模式（未单独设置的课程）
                    <select
                      value={autoModes?.modes?._default || "review"}
                      disabled={!autoModes}
                      onChange={(event) => changeAutoMode("_default", event.target.value)}
                    >
                      <option value="draft">仅生成草稿</option>
                      <option value="review">审核后提交（默认）</option>
                      <option value="auto">自动生成并标记已审核（发出前仍需确认）</option>
                    </select>
                  </label>
                  <label>
                    AI 自动完成
                    <button type="button" onClick={runAutoCompleteNow} disabled={!featureConfig?.autoComplete}>
                      立即自动完成
                    </button>
                    <small className="muted">需先开启"AI 自动完成"开关并配置模型。</small>
                  </label>
                </div>
              </div>
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
                    <p>{appInfo?.updateChannel === "macOS preview" ? "macOS 预览版（暂不提供自动更新）" : "Windows 正式版"}</p>
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
                    <strong>{updateStatusLabel}</strong>
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
                    {updateResult.sha256Asset && <span>校验文件：{updateResult.sha256Asset.name}</span>}
                    {updateResult.latestNotes && <p>{updateResult.latestNotes}</p>}
                  </div>
                )}
                {updateDownloadBusy && (
                  <div className="update-progress">
                    <div>
                      <span>{updateState?.message || "正在下载安装包..."}</span>
                      <strong>{Math.max(0, Math.min(100, Math.round(updateProgress)))}%</strong>
                    </div>
                    <progress value={Math.max(0, Math.min(100, updateProgress))} max="100" />
                    <span>
                      {formatFileSize(updateState?.downloadedBytes || 0)}
                      {updateState?.totalBytes ? ` / ${formatFileSize(updateState.totalBytes)}` : ""}
                    </span>
                  </div>
                )}
                {updateReadyToInstall && (
                  <div className="update-ready">
                    <strong>更新已下载并通过校验</strong>
                    <span>现在重启会启动安装器，安装完成后会重新打开新版本。</span>
                  </div>
                )}
                {updateResult?.hasUpdate && updateResult.installerAsset && !updateResult.sha256Asset && (
                  <div className="status error">Release 缺少 SHA256 校验文件，不能在应用内下载并安装。可以先打开 Release 页面手动下载。</div>
                )}
                {updateResult && !updateResult.ok && (
                  <div className="status error">{updateResult.message || "暂时无法检查更新。"}</div>
                )}
                {updateState?.status === "error" && (
                  <div className="status error">{updateState.message || "更新失败，请重试。"}</div>
                )}
                <div className="toolbar">
                  <button className="primary" onClick={checkUpdates} disabled={updateBusy}>
                    {updateState?.status === "checking" || updateLoading ? "检查中" : "检查更新"}
                  </button>
                  <button onClick={() => openUpdateLink(updateResult?.latestUrl || updateResult?.releasesUrl)}>
                    打开 Release 页面
                  </button>
                  {updateCanDownload && !updateReadyToInstall && (
                    <button onClick={downloadAndInstallUpdate}>
                      下载并安装
                    </button>
                  )}
                  {updateDownloadBusy && (
                    <button onClick={cancelUpdateDownload}>
                      取消下载
                    </button>
                  )}
                  {updateReadyToInstall && (
                    <button className="primary" onClick={installDownloadedUpdate}>
                      现在重启安装
                    </button>
                  )}
                  {updateReadyToInstall && (
                    <button onClick={() => setStatus("已保留安装包，可稍后在设置中安装。")}>
                      稍后
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
                <label>长文本粘贴阈值
                  <input
                    type="number"
                    min="500"
                    max="100000"
                    step="100"
                    value={modelConfig.longPasteThreshold || 4000}
                    onChange={(event) => setModelConfig({ ...modelConfig, longPasteThreshold: event.target.value })}
                  />
                  <small className="muted">粘贴文本达到该字数时，将保存为工作区 TXT 文件，而不是直接放入输入框。</small>
                </label>
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

        {page === "review" && (
          <section>
            <PageTitle title="复习" subtitle="从作业正文与附件整理知识点（原文模式；LLM 总结在后续版本接入）。" />
            <div className="toolbar">
              <button className="primary" onClick={refreshKnowledgeNow} disabled={reviewLoading}>
                {reviewLoading ? "整理中…" : "重新整理"}
              </button>
              <button onClick={loadReviewNotes}>刷新列表</button>
              <button onClick={summarizeNotesNow} disabled={summarizeLoading || !reviewIndex?.subjects?.length}>
                {summarizeLoading ? "总结中…" : "AI 总结（需模型配置）"}
              </button>
            </div>
            {!reviewIndex?.subjects?.length ? (
              <div className="card">
                <p className="muted">还没有复习笔记。登录后点击"重新整理"，应用会扫描当前学期作业的正文与附件。</p>
              </div>
            ) : (
              <div className="review-layout">
                <div className="card review-subjects">
                  {reviewIndex.subjects.map((group) => (
                    <button
                      key={group.subject}
                      className={reviewSubject === group.subject ? "active" : ""}
                      onClick={() => {
                        setReviewSubject(group.subject);
                        setReviewNoteContent("");
                      }}
                    >
                      {group.subject}（{group.notes.length}）
                    </button>
                  ))}
                </div>
                <div className="card review-notes">
                  {(() => {
                    const currentGroup = reviewIndex.subjects.find((group) => group.subject === reviewSubject);
                    const summary = reviewIndex.summaries?.find((item) => item.subject === reviewSubject);
                    const noteList = [
                      summary ? { file: summary.summaryFile, topic: "【AI 总结】", sourceTaskIds: [] } : null,
                      ...(currentGroup?.notes || []),
                    ].filter(Boolean);
                    return noteList.map((note) => (
                      <button key={note.file} className="review-note-item" onClick={() => openReviewNote(reviewSubject, note)}>
                        <strong>{note.topic}</strong>
                        <span>{note.sourceTaskIds?.length ? `来源：${note.sourceTaskIds.join(", ")}` : "自动生成的学科总结"}</span>
                      </button>
                    ));
                  })()}
                </div>
                <div className="card review-content">
                  {reviewNoteContent ? (
                    <pre className="review-pre">{reviewNoteContent}</pre>
                  ) : (
                    <p className="muted">选择左侧笔记查看内容。</p>
                  )}
                </div>
              </div>
            )}
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
