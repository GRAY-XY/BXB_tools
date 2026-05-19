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
  ["review", "审核"],
  ["model", "模型"],
  ["settings", "设置"],
];

const quickPrompts = [
  "列出课程",
  "列出当前课程作业",
  "列出未提交作业",
  "查看当前课程GPA",
];

const fallbackSystemPrompt =
  "你是伴学邦桌面助手。需要真实数据时必须调用工具，不要猜测。需要联网资料时先调用 web_search；需要阅读某个搜索结果时再调用 read_web_page。用户提到工作区文件时，先调用 list_workspace_files 定位文件，再按需调用 read_workspace_file；需要整理文件名时可调用 rename_workspace_file。不要上传、提交或删除任何内容。处理作业草稿时先调用 collect_task_submission_context；信息不足就说明缺什么；信息足够才调用 draft_task_submission 保存草稿等待用户审核。";

const allCoursesName = "全部课程";

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

function isAllCourses(course) {
  const id = course?.id || course?.subject_id || course?.subjectId;
  const name = course?.name || course?.subjectName || course?.courseName || course?.title;
  return Boolean(course?.allSubjects || id === "__all_courses__" || name === allCoursesName);
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
  const pendingCount = session.currentSubject?.unSubmitCount;
  const pendingLabel = session.currentSubject?.allSubjects
    ? "按课程查看"
    : pendingCount === undefined || pendingCount === null
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
          <span>当前课程</span>
          <strong>{session.currentSubject?.name || "暂无课程"}</strong>
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
          <span>可切换课程</span>
          <strong>{courseCount ? `${courseCount} 门` : "暂无数据"}</strong>
        </div>
        <div>
          <span>当前课程未交</span>
          <strong>{pendingLabel}</strong>
        </div>
      </div>
      <p>为了安全，这里不会显示登录令牌、会话文件路径、邮箱或其他技术字段。</p>
    </div>
  );
}

function App() {
  const [page, setPage] = useState("home");
  const [theme, setTheme] = useState(() => localStorage.getItem("bxb-theme") || "light");
  const [status, setStatus] = useState("Ready");
  const [session, setSession] = useState(null);
  const [terms, setTerms] = useState([]);
  const [courses, setCourses] = useState([]);
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
  const [tasks, setTasks] = useState([]);
  const [taskDetail, setTaskDetail] = useState(null);
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
  const [modelConfig, setModelConfig] = useState({
    apiKey: "",
    baseUrl: "",
    modelName: "",
    contextLength: 0,
    maxToolRounds: 6,
    systemPrompt: fallbackSystemPrompt,
    defaultSystemPrompt: fallbackSystemPrompt,
  });
  const [modelResult, setModelResult] = useState(null);
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

  const contextUsed = useMemo(() => {
    const promptTokens = usage?.prompt_tokens || usage?.promptTokens || 0;
    if (promptTokens) {
      return promptTokens;
    }
    const text = messages
      .map((item) => item.text)
      .join("\n");
    return Math.ceil(text.length / 4);
  }, [messages, usage]);

  const contextMax = Number(modelConfig.contextLength || 0) || 1000000;
  const contextPercent = Math.min(100, Math.round((contextUsed / contextMax) * 100));

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
    setActiveConversationId(state?.activeId || "");
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
      setStatus("请先登录后再切换学期或课程");
      return;
    }
    const nextOpen = !sessionMenuOpen;
    setSessionMenuOpen(nextOpen);
    if (nextOpen) {
      await loadSessionChoices();
    }
  }

  async function loadSessionChoices() {
    const [termResult, courseResult] = await Promise.all([
      callTool("list_terms", {}),
      callTool("list_courses", {}),
    ]);
    const termRows = termResult?.terms || termResult?.items || termResult?.records || session?.availableTerms || [];
    const courseRows = courseResult?.courses || courseResult?.items || courseResult?.records || session?.availableSubjects || [];
    setTerms(Array.isArray(termRows) ? termRows : []);
    setCourses(Array.isArray(courseRows) ? courseRows : []);
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
    const [termResult, courseResult] = await Promise.all([
      callTool("list_terms", {}),
      callTool("list_courses", {}),
    ]);
    const termRows = termResult?.terms || termResult?.items || termResult?.records || nextSession?.availableTerms || [];
    const courseRows = courseResult?.courses || courseResult?.items || courseResult?.records || nextSession?.availableSubjects || [];
    const currentTermId = nextSession?.currentTermId;
    const currentTermName = nextSession?.currentTermName || nextSession?.availableTerms?.find((item) => item?.id === currentTermId)?.name;
    setTerms(Array.isArray(termRows) ? termRows.map((item) => ({
      ...item,
      status: currentTermId ? getTermId(item) === currentTermId : getTermName(item) === currentTermName,
    })) : []);
    setCourses(Array.isArray(courseRows) ? courseRows : []);
    setStatus(`已切换学期：${termName || termId}`);
  }

  async function switchCourse(course) {
    const subjectName = course?.name || course?.subjectName || course?.courseName || course?.title;
    const subjectId = course?.subject_id || course?.subjectId || course?.id;
    const classId = course?.class_id || course?.classId;
    if (!subjectName && !subjectId) {
      setStatus("无法识别课程名称或 ID");
      return;
    }
    setSessionMenuOpen(false);
    const args = isAllCourses(course)
      ? { subject_name: allCoursesName }
      : subjectName
        ? { subject_name: subjectName, class_id: classId }
        : { subject_id: subjectId, class_id: classId };
    await callTool("set_current_subject", args);
    await refreshSession();
    setStatus(`已切换课程：${subjectName || subjectId}`);
  }

  async function loadTasks(listType = "all") {
    const result = await callTool("list_tasks", { list_type: listType, page: 1, size: 30 });
    setTasks(extractTaskRows(result));
    setPage("homework");
  }

  async function openTask(taskId) {
    if (!taskId) return;
    const result = await callTool("read_task_content", { task_id: String(taskId), max_chars: 6000 });
    setTaskDetail(result);
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

  async function loadDrafts(statusFilter = "pending_review") {
    const result = await callTool("list_submission_drafts", { status: statusFilter });
    setDrafts(result?.drafts || []);
    setPage("review");
  }

  async function openDraft(draftId) {
    const result = await callTool("get_submission_draft", { draft_id: draftId });
    setSelectedDraft(result?.draft || result);
  }

  async function approveDraft() {
    if (!selectedDraft?.draftId) return;
    await callTool("approve_submission_draft", { draft_id: selectedDraft.draftId, review_note: "UI approved" });
    await loadDrafts("pending_review");
  }

  async function rejectDraft() {
    if (!selectedDraft?.draftId) return;
    await callTool("reject_submission_draft", { draft_id: selectedDraft.draftId, review_note: "UI rejected" });
    await loadDrafts("pending_review");
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
    setUsage(null);
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
            <button key={key} className={page === key ? "nav active" : "nav"} onClick={() => setPage(key)}>
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
              <div className="session-menu-section">
                <div className="session-menu-title">切换课程</div>
                {courses.length === 0 ? (
                  <div className="session-empty">暂无课程数据</div>
                ) : (
                  courses.map((course, index) => {
                    const name = course?.name || course?.subjectName || course?.courseName || course?.title || `课程 ${index + 1}`;
                    const id = course?.id || course?.subject_id || course?.subjectId;
                    const active = name === session?.currentSubject?.name || id === session?.currentSubject?.id;
                    return (
                      <button key={`${id || name}-${index}`} className={active ? "session-menu-item active" : "session-menu-item"} onClick={() => switchCourse(course)}>
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
            <span>{session?.currentSubject?.name || "暂无课程"}</span>
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
            <PageTitle title="作业中心" subtitle="直接调用本地 list_tasks / read_task_content 工具。" />
            <div className="card toolbar">
              <button className="primary" onClick={() => loadTasks("all")}>刷新作业</button>
              <button onClick={() => loadTasks("pending")}>未提交作业</button>
            </div>
            <div className="grid two wide-left">
              <div className="card table-card">
                <table>
                  <thead><tr><th>ID</th><th>课程</th><th>任务</th><th>截止</th><th>成绩</th></tr></thead>
                  <tbody>
                    {!tasks.length && (
                      <tr>
                        <td colSpan="5" className="empty-cell">暂无作业数据，点击上方刷新作业或未提交作业。</td>
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
              <div className="card">
                <h2>任务详情</h2>
                <JsonBlock data={taskDetail || {}} />
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
                {workspacePreview?.file?.text && (
                  <pre className="workspace-text">{workspacePreview.file.text}</pre>
                )}
                {workspacePreview?.file && !workspacePreview.file.text && !workspacePreview.loading && !workspacePreview.error && (
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

        {page === "review" && (
          <section>
            <PageTitle title="草稿审核" subtitle="这里只审核本地草稿，不做上传提交。" />
            <div className="card toolbar">
              <button className="primary" onClick={() => loadDrafts("pending_review")}>刷新待审核</button>
              <button onClick={() => loadDrafts("all")}>全部草稿</button>
              <button onClick={approveDraft} disabled={!selectedDraft}>通过</button>
              <button onClick={rejectDraft} disabled={!selectedDraft}>驳回</button>
            </div>
            <div className="grid two">
              <div className="card list">
                {drafts.map((draft) => (
                  <button key={draft.draftId} onClick={() => openDraft(draft.draftId)}>
                    <strong>{draft.taskTitle || draft.taskId}</strong>
                    <span>{draft.subjectName || "未知课程"} · {draft.status}</span>
                  </button>
                ))}
              </div>
              <div className="card">
                <h2>草稿详情</h2>
                <JsonBlock data={selectedDraft || {}} />
              </div>
            </div>
          </section>
        )}

        {page === "model" && (
          <section>
            <PageTitle title="模型配置" subtitle="OpenAI-compatible chat completions endpoint." />
            <div className="card form">
              <label>API Key<input type="password" value={modelConfig.apiKey || ""} onChange={(event) => setModelConfig({ ...modelConfig, apiKey: event.target.value })} /></label>
              <label>调用链接<input value={modelConfig.baseUrl || ""} onChange={(event) => setModelConfig({ ...modelConfig, baseUrl: event.target.value })} placeholder="https://api.example.com/v1" /></label>
              <label>模型名称<input value={modelConfig.modelName || ""} onChange={(event) => setModelConfig({ ...modelConfig, modelName: event.target.value })} /></label>
              <label>上下文长度<input value={modelConfig.contextLength || ""} onChange={(event) => setModelConfig({ ...modelConfig, contextLength: event.target.value })} /></label>
              <div className="toolbar">
                <button className="primary" onClick={saveConfig}>保存配置</button>
                <button onClick={testConfig}>测试连通性</button>
                <button onClick={clearConfig}>清除配置</button>
              </div>
              <JsonBlock data={modelResult || { apiKeyMasked: modelConfig.apiKeyMasked, configPath: modelConfig.configPath }} />
            </div>
          </section>
        )}

        {page === "settings" && (
          <section>
            <PageTitle title="设置" subtitle="界面、Agent 轮次和仓库信息。" />
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
                <button onClick={() => window.open("https://github.com/GRAY-XY/BXB_tools")}>打开 GitHub</button>
              </div>
              <JsonBlock data={appInfo || {}} />
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
