from __future__ import annotations

from collections import deque
from dataclasses import dataclass, field
import re
from typing import Any, Callable

from .interfaces import BanxuebangUiBackend, UiBackendError


@dataclass
class AgentTurn:
    role: str
    text: str


@dataclass
class AgentReply:
    message: str
    session: dict[str, Any] | None = None
    task_rows: list[dict[str, Any]] | None = None
    task_detail: dict[str, Any] | None = None
    gpa_result: dict[str, Any] | None = None
    draft_result: dict[str, Any] | None = None
    draft_detail: dict[str, Any] | None = None
    draft_list: dict[str, Any] | None = None


@dataclass
class AgentProgressEvent:
    kind: str
    summary: str
    detail: str | None = None


@dataclass
class AgentState:
    term_name: str | None = None
    subject_name: str | None = None
    last_task_rows: list[dict[str, Any]] = field(default_factory=list)
    last_task_id: str | None = None


class ConversationAgent:
    def __init__(self, backend: BanxuebangUiBackend, *, max_turns: int = 6) -> None:
        self.backend = backend
        self.turns: deque[AgentTurn] = deque(maxlen=max_turns * 2)
        self.state = AgentState()
        self._progress_callback: Callable[[AgentProgressEvent], None] | None = None

    def recent_turns(self) -> list[AgentTurn]:
        return list(self.turns)

    def sync_from_session(self, session: dict[str, Any] | None) -> None:
        if not session:
            return

        current_subject = (session.get("currentSubject") or {}).get("name")
        if current_subject:
            self.state.subject_name = current_subject

        for term in session.get("availableTerms", []) or []:
            if term.get("status") and term.get("name"):
                self.state.term_name = term["name"]
                break

    def handle(
        self,
        user_text: str,
        progress_callback: Callable[[AgentProgressEvent], None] | None = None,
    ) -> AgentReply:
        text = (user_text or "").strip()
        if not text:
            return AgentReply("请输入要执行的操作，例如：切到国际公民素养并列出未提交作业。")

        self._progress_callback = progress_callback
        self._remember("user", text)
        try:
            self._emit_progress("info", "开始分析用户请求", text)
            reply = self._dispatch(text)
        except UiBackendError as error:
            self._emit_progress("error", "执行失败", str(error))
            reply = AgentReply(str(error))
        finally:
            self._progress_callback = None

        self._remember("assistant", reply.message)
        return reply

    def _dispatch(self, text: str) -> AgentReply:
        if self._wants_help(text):
            return AgentReply(self._help_text())

        if "浏览器登录" in text or ("登录" in text and "浏览器" in text):
            self._emit_progress("tool", "打开浏览器登录")
            self.backend.login_in_browser()
            self._emit_progress("tool", "刷新登录后的会话")
            session = self.backend.session_status()
            self.sync_from_session(session)
            return AgentReply("浏览器登录已完成，会话已刷新。", session=session)

        if self._is_session_request(text):
            self._emit_progress("tool", "读取当前会话")
            session = self.backend.session_status()
            self.sync_from_session(session)
            ready = bool(session.get("ready"))
            user = (session.get("user") or {}).get("name") or "未登录"
            if not ready:
                return AgentReply("当前没有可用会话。先用浏览器登录即可。", session=session)
            return AgentReply(f"当前会话有效，用户是 {user}。", session=session)

        self._emit_progress("tool", "读取当前会话")
        session = self.backend.session_status()
        self.sync_from_session(session)

        if not session.get("ready"):
            return AgentReply("当前没有可用会话。先用浏览器登录，再让我继续调工具。", session=session)

        if self._wants_list_terms(text):
            self._emit_progress("tool", "列出学期")
            result = self.backend.list_terms()
            terms = [item.get("name", "") for item in result.get("terms", []) if item.get("name")]
            return AgentReply("可用学期：" + "、".join(terms) if terms else "当前没有可用学期数据。")

        if self._wants_gpa(text):
            return self._handle_gpa(text, session)

        if self._wants_task_list(text):
            return self._handle_list_tasks(text, session)

        if self._wants_open_task(text):
            return self._handle_open_task(text, session)

        explicit_term = self._match_term_name(text, session)
        if explicit_term and self._wants_switch(text):
            self._emit_progress("tool", f"切换学期：{explicit_term}")
            updated = self.backend.set_current_term(term_name=explicit_term)
            self.sync_from_session(updated)
            return AgentReply(f"已切换到学期：{explicit_term}", session=updated)

        if self._wants_list_courses(text):
            self._emit_progress("tool", "列出课程")
            result = self.backend.list_courses()
            courses = [item.get("name", "") for item in result.get("courses", []) if item.get("name")]
            return AgentReply("可用课程：" + "、".join(courses) if courses else "当前没有课程数据。")

        explicit_subject = self._match_subject_name(text, session)
        if explicit_subject and self._wants_switch(text):
            self._emit_progress("tool", f"切换课程：{explicit_subject}")
            updated = self.backend.set_current_subject(subject_name=explicit_subject)
            self.sync_from_session(updated)
            return AgentReply(f"已切换到课程：{explicit_subject}", session=updated)

        return AgentReply(
            "我没完全听懂。你可以试这些说法：列出课程、切到2025-2026下学期、切到国际公民素养、列出未提交作业、打开第一个任务、查看当前课程GPA。"
        )

    def _handle_gpa(self, text: str, session: dict[str, Any]) -> AgentReply:
        context_session = self._align_context(text, session, require_subject=True)
        self._emit_progress("tool", "读取当前课程 GPA")
        result = self.backend.get_current_subject_gpa()
        self.sync_from_session(context_session)
        subject_name = self.state.subject_name or (context_session.get("currentSubject") or {}).get("name") or "当前课程"
        average = result.get("averageLevel") or result.get("averageGpa") or result.get("averageScore") or "未知"
        return AgentReply(
            f"{subject_name} 的当前平均 GPA/等级是：{average}",
            session=context_session,
            gpa_result=result,
        )

    def _handle_list_tasks(self, text: str, session: dict[str, Any]) -> AgentReply:
        all_courses = any(token in text for token in ("全部课程", "所有课程", "all courses", "all-courses"))
        list_type = "pending" if any(token in text for token in ("未提交", "待交", "pending")) else "all"
        context_session = self._align_context(text, session, require_subject=not all_courses)
        term_name = self._match_term_name(text, context_session) or self.state.term_name
        subject_name = None if all_courses else (self._match_subject_name(text, context_session) or self.state.subject_name)

        self._emit_progress(
            "tool",
            f"列出{'全部课程' if all_courses else (subject_name or '当前课程')}的{'未提交作业' if list_type == 'pending' else '作业'}",
            f"term={term_name or '(当前学期)'}; subject={subject_name or '(全部课程)'}; list_type={list_type}",
        )
        rows = self.backend.list_task_rows(
            term_name=term_name,
            subject_name=subject_name,
            list_type=list_type,
            page=1,
            size=20,
        )
        self.state.last_task_rows = rows
        self.state.last_task_id = rows[0]["task_id"] if rows else None

        scope_text = "全部课程" if all_courses else (subject_name or "当前课程")
        kind_text = "未提交作业" if list_type == "pending" else "作业"
        if not rows:
            return AgentReply(f"{scope_text} 当前没有可显示的{kind_text}。", session=context_session, task_rows=rows)

        preview = []
        for index, row in enumerate(rows[:5], start=1):
            preview.append(f"{index}. {row.get('course') or ''} / {row.get('name') or ''}")
        message = f"{scope_text} 共找到 {len(rows)} 条{kind_text}。\n" + "\n".join(preview)
        return AgentReply(message, session=context_session, task_rows=rows)

    def _handle_open_task(self, text: str, session: dict[str, Any]) -> AgentReply:
        task_id = self._extract_task_id(text) or self._task_id_from_reference(text)
        if not task_id:
            if not self.state.last_task_rows:
                self._emit_progress("info", "当前没有任务上下文，先列出当前课程作业")
                list_reply = self._handle_list_tasks("列出当前课程作业", session)
                if list_reply.task_rows:
                    task_id = list_reply.task_rows[0].get("task_id")
                    session = list_reply.session or session
            else:
                task_id = self.state.last_task_rows[0].get("task_id")

        if not task_id:
            return AgentReply("没有可打开的任务。先让我列一次作业，或者直接给我 task_id。")

        self._emit_progress("tool", f"打开任务 {task_id}")
        self.backend.open_task(task_id, include_other_submissions=False)
        self._emit_progress("tool", f"读取任务正文 {task_id}")
        detail = self.backend.read_task_content(task_id, max_chars=3000)
        self.state.last_task_id = task_id
        summary = detail.get("taskSummary", {}) or {}
        attachments = detail.get("attachments", []) or []
        title = summary.get("activityName") or task_id
        return AgentReply(
            f"已打开任务：{title}。附件 {len(attachments)} 个。",
            session=session,
            task_detail=detail,
        )

    def _align_context(self, text: str, session: dict[str, Any], *, require_subject: bool) -> dict[str, Any]:
        updated_session = session
        explicit_term = self._match_term_name(text, session)
        if explicit_term and explicit_term != self.state.term_name:
            self._emit_progress("tool", f"对齐学期上下文：{explicit_term}")
            updated_session = self.backend.set_current_term(term_name=explicit_term)
            self.sync_from_session(updated_session)

        explicit_subject = self._match_subject_name(text, updated_session)
        if explicit_subject:
            current_subject = (updated_session.get("currentSubject") or {}).get("name")
            if explicit_subject != current_subject:
                self._emit_progress("tool", f"对齐课程上下文：{explicit_subject}")
                updated_session = self.backend.set_current_subject(subject_name=explicit_subject)
                self.sync_from_session(updated_session)

        if require_subject and not (explicit_subject or self.state.subject_name or (updated_session.get("currentSubject") or {}).get("name")):
            raise UiBackendError("当前没有课程上下文。先说“切到某课程”，或者在请求里带上课程名。")

        return updated_session

    def _match_term_name(self, text: str, session: dict[str, Any]) -> str | None:
        names = [item.get("name", "") for item in session.get("availableTerms", []) if item.get("name")]
        return self._best_match(text, names)

    def _match_subject_name(self, text: str, session: dict[str, Any]) -> str | None:
        names = [item.get("name", "") for item in session.get("availableSubjects", []) if item.get("name")]
        return self._best_match(text, names)

    @staticmethod
    def _best_match(text: str, candidates: list[str]) -> str | None:
        compact_text = ConversationAgent._compact(text)
        for name in sorted(candidates, key=len, reverse=True):
            if ConversationAgent._compact(name) and ConversationAgent._compact(name) in compact_text:
                return name
        return None

    @staticmethod
    def _compact(text: str) -> str:
        return re.sub(r"\s+", "", text).lower()

    @staticmethod
    def _extract_task_id(text: str) -> str | None:
        match = re.search(r"\b(\d{12,})\b", text)
        return match.group(1) if match else None

    def _task_id_from_reference(self, text: str) -> str | None:
        if not self.state.last_task_rows:
            return None

        compact = self._compact(text)
        if any(token in compact for token in ("第一个", "第1个", "第1条", "最新", "最近")):
            return self.state.last_task_rows[0].get("task_id")
        if any(token in compact for token in ("第二个", "第2个", "第2条")) and len(self.state.last_task_rows) >= 2:
            return self.state.last_task_rows[1].get("task_id")
        if any(token in compact for token in ("第三个", "第3个", "第3条")) and len(self.state.last_task_rows) >= 3:
            return self.state.last_task_rows[2].get("task_id")
        if "上一个" in compact and self.state.last_task_id:
            return self.state.last_task_id
        return None

    @staticmethod
    def _wants_help(text: str) -> bool:
        return any(token in text.lower() for token in ("help", "帮助", "能做什么", "可以做什么"))

    @staticmethod
    def _is_session_request(text: str) -> bool:
        return any(token in text for token in ("会话状态", "当前会话", "当前状态", "我是谁", "刷新会话"))

    @staticmethod
    def _wants_list_terms(text: str) -> bool:
        return "学期" in text and any(token in text for token in ("列表", "列出", "有哪些", "查看"))

    @staticmethod
    def _wants_list_courses(text: str) -> bool:
        if any(token in text.lower() for token in ("gpa",)) or any(token in text for token in ("作业", "任务", "绩点", "等级")):
            return False
        return "课程" in text and any(token in text for token in ("列表", "列出", "有哪些", "查看"))

    @staticmethod
    def _wants_switch(text: str) -> bool:
        return any(token in text for token in ("切到", "切换", "改到", "设为", "进入"))

    @staticmethod
    def _wants_gpa(text: str) -> bool:
        lower = text.lower()
        return "gpa" in lower or "平均gpa" in lower or "平均绩点" in text or "平均等级" in text

    @staticmethod
    def _wants_task_list(text: str) -> bool:
        return any(token in text for token in ("作业", "任务")) and any(
            token in text for token in ("列出", "查看", "看看", "显示", "查询", "刷新")
        )

    @staticmethod
    def _wants_open_task(text: str) -> bool:
        return any(token in text for token in ("打开", "阅读", "查看")) and (
            "任务" in text or bool(re.search(r"\b\d{12,}\b", text)) or "第一个" in text or "最新" in text or "最近" in text
        )

    def _remember(self, role: str, text: str) -> None:
        self.turns.append(AgentTurn(role=role, text=text))

    def update_limits(self, *, max_turns: int | None = None) -> None:
        if max_turns is None:
            return

        self.turns = deque(self.turns, maxlen=max(1, int(max_turns)) * 2)

    def reset_conversation(self) -> None:
        self.turns.clear()

    def _emit_progress(self, kind: str, summary: str, detail: str | None = None) -> None:
        if self._progress_callback is not None:
            self._progress_callback(AgentProgressEvent(kind=kind, summary=summary, detail=detail))

    @staticmethod
    def _help_text() -> str:
        return (
            "可以直接对我说这些：\n"
            "- 列出课程\n"
            "- 切到2025-2026下学期\n"
            "- 切到国际公民素养\n"
            "- 列出当前课程作业\n"
            "- 列出全部课程未提交作业\n"
            "- 打开第一个任务\n"
            "- 查看当前课程GPA\n"
            "- 当前会话"
        )
