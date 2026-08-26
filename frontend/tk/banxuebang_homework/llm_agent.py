from __future__ import annotations

from collections import deque
import json
from typing import Any, Callable
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from .agent import AgentProgressEvent, AgentReply, AgentTurn, ConversationAgent as RuleConversationAgent
from .interfaces import BanxuebangUiBackend, UiBackendError
from .model_config import ModelConfig, derive_chat_completions_url, load_model_config


SYSTEM_PROMPT = """你是伴学邦桌面助手，运行在一个本地 UI 中。

你的职责：
1. 优先通过工具读取真实数据，不要猜测课程、学期、任务内容。
2. 回答要简洁、直接、可执行。
3. 需要伴学邦数据时，先确认会话是否可用；如果没有登录态，就明确提示用户先点击浏览器登录。
4. 只使用提供给你的工具，不要编造不存在的能力。
5. 当用户要查看作业、课程、学期、任务正文、当前课程 GPA 时，主动调用工具完成，不要只给建议。
6. 当前不要触发任何上传、提交、删除之类高风险动作；本轮工具集中没有这些工具。
7. 保持对最近几轮对话的衔接，但不要假装记得更久以前的内容。
8. 当用户让你“处理某个任务”或“帮我写提交草稿”时，先调用 collect_task_submission_context。
9. 如果收集结果显示 missing_info 非空或 is_sufficient 为 false，就直接说明信息不足，不要硬写。
10. 当信息足够时，由你自己生成 draft_text，然后调用 draft_task_submission 保存为待审核草稿。
"""


class LlmConversationAgent:
    def __init__(
        self,
        backend: BanxuebangUiBackend,
        *,
        max_turns: int = 6,
        max_tool_rounds: int = 6,
    ) -> None:
        self.backend = backend
        self.turns: deque[AgentTurn] = deque(maxlen=max_turns * 2)
        self.rule_fallback = RuleConversationAgent(backend, max_turns=max_turns)
        self.max_tool_rounds = max(1, int(max_tool_rounds))
        self.last_usage: dict[str, Any] = {}
        self._progress_callback: Callable[[AgentProgressEvent], None] | None = None

    def recent_turns(self) -> list[AgentTurn]:
        return list(self.turns)

    def sync_from_session(self, session: dict[str, Any] | None) -> None:
        self.rule_fallback.sync_from_session(session)

    def handle(
        self,
        user_text: str,
        progress_callback: Callable[[AgentProgressEvent], None] | None = None,
    ) -> AgentReply:
        text = (user_text or "").strip()
        if not text:
            return AgentReply("请输入要执行的操作。")

        self.last_usage = {}
        self._progress_callback = progress_callback
        config = load_model_config()
        if not self._config_ready(config):
            self._emit_progress("info", "当前未配置可用模型，退回规则助手")
            fallback = self.rule_fallback.handle(text, progress_callback=progress_callback)
            fallback.message = f"{fallback.message}\n\n提示：当前未配置可用模型，已退回规则助手。"
            self._remember("user", text)
            self._remember("assistant", fallback.message)
            self._progress_callback = None
            return fallback

        try:
            self._emit_progress("info", "开始调用大模型", text)
            reply = self._run_llm_turn(config, text)
        except Exception as error:  # noqa: BLE001
            self._emit_progress("error", "模型调用失败", str(error))
            reply = AgentReply(f"模型调用失败：{error}")
        finally:
            self._progress_callback = None

        self._remember("user", text)
        self._remember("assistant", reply.message)
        return reply

    def _run_llm_turn(self, config: ModelConfig, user_text: str) -> AgentReply:
        messages = [{"role": "system", "content": SYSTEM_PROMPT}]
        for turn in self.turns:
            if turn.role == "user":
                messages.append({"role": "user", "content": turn.text})
            elif turn.role == "assistant":
                messages.append({"role": "assistant", "content": turn.text})
        messages.append({"role": "user", "content": user_text})

        latest_session: dict[str, Any] | None = None
        latest_task_rows: list[dict[str, Any]] | None = None
        latest_task_detail: dict[str, Any] | None = None
        latest_gpa: dict[str, Any] | None = None
        latest_draft_result: dict[str, Any] | None = None
        latest_draft_detail: dict[str, Any] | None = None
        latest_draft_list: dict[str, Any] | None = None

        for round_index in range(self.max_tool_rounds):
            self._emit_progress("llm", f"第 {round_index + 1} 轮请求模型")
            response = self._chat_completion(config, messages, self._tool_schemas())
            self.last_usage = response.get("usage") if isinstance(response.get("usage"), dict) else {}
            message = (((response.get("choices") or [{}])[0]).get("message") or {})
            tool_calls = message.get("tool_calls") or []

            if tool_calls:
                self._emit_progress("llm", f"模型请求调用 {len(tool_calls)} 个工具")
                messages.append(
                    {
                        "role": "assistant",
                        "content": self._message_content_as_text(message.get("content")),
                        "tool_calls": tool_calls,
                    }
                )
                for call in tool_calls:
                    tool_name = ((call or {}).get("function") or {}).get("name")
                    raw_arguments = ((call or {}).get("function") or {}).get("arguments") or "{}"
                    try:
                        arguments = json.loads(raw_arguments)
                    except json.JSONDecodeError as error:
                        raise UiBackendError(f"模型返回了无效的工具参数：{error}") from error

                    self._emit_progress(
                        "tool",
                        f"调用工具 {tool_name}",
                        json.dumps(arguments, ensure_ascii=False, indent=2),
                    )
                    result = self._execute_tool(tool_name, arguments)
                    if tool_name in {"session_status", "login_in_browser", "set_current_term", "set_current_subject"}:
                        latest_session = result if isinstance(result, dict) else latest_session
                        if isinstance(result, dict):
                            self.sync_from_session(result)
                    elif tool_name == "open_task":
                        latest_task_detail = result if isinstance(result, dict) else latest_task_detail
                    elif tool_name == "list_task_rows":
                        latest_task_rows = result if isinstance(result, list) else latest_task_rows
                    elif tool_name == "read_task_content":
                        latest_task_detail = result if isinstance(result, dict) else latest_task_detail
                    elif tool_name == "get_current_subject_gpa":
                        latest_gpa = result if isinstance(result, dict) else latest_gpa
                    elif tool_name == "collect_task_submission_context":
                        latest_task_detail = result if isinstance(result, dict) else latest_task_detail
                    elif tool_name == "draft_task_submission":
                        latest_draft_result = result if isinstance(result, dict) else latest_draft_result
                        latest_draft_detail = result if isinstance(result, dict) else latest_draft_detail
                    elif tool_name == "list_submission_drafts":
                        latest_draft_list = result if isinstance(result, dict) else latest_draft_list
                    elif tool_name in {"get_submission_draft", "approve_submission_draft", "reject_submission_draft"}:
                        latest_draft_detail = result if isinstance(result, dict) else latest_draft_detail

                    self._emit_progress(
                        "tool",
                        f"工具 {tool_name} 已完成",
                        self._truncate_detail(json.dumps(result, ensure_ascii=False, indent=2)),
                    )
                    messages.append(
                        {
                            "role": "tool",
                            "tool_call_id": call.get("id"),
                            "content": json.dumps(result, ensure_ascii=False),
                        }
                    )
                continue

            content = self._message_content_as_text(message.get("content"))
            if not content:
                content = "工具执行完成。"
            self._emit_progress("llm", "模型已生成最终回答")
            return AgentReply(
                content,
                session=latest_session,
                task_rows=latest_task_rows,
                task_detail=latest_task_detail,
                gpa_result=latest_gpa,
                draft_result=latest_draft_result,
                draft_detail=latest_draft_detail,
                draft_list=latest_draft_list,
            )

        raise UiBackendError(
            f"模型连续请求工具超过 {self.max_tool_rounds} 轮，仍未给出最终回答。"
        )

    def update_limits(
        self,
        *,
        max_tool_rounds: int | None = None,
        max_turns: int | None = None,
    ) -> None:
        if max_tool_rounds is not None:
            self.max_tool_rounds = max(1, int(max_tool_rounds))
        if max_turns is not None:
            self.turns = deque(self.turns, maxlen=max(1, int(max_turns)) * 2)
            self.rule_fallback.update_limits(max_turns=max_turns)

    def reset_conversation(self) -> None:
        self.turns.clear()
        self.last_usage = {}
        self.rule_fallback.reset_conversation()

    def _chat_completion(
        self,
        config: ModelConfig,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]],
    ) -> dict[str, Any]:
        url = derive_chat_completions_url(config.base_url)
        payload = {
            "model": config.model_name,
            "messages": messages,
            "tools": tools,
            "tool_choice": "auto",
            "temperature": 0.2,
        }

        request = Request(
            url,
            data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
            headers={
                "Authorization": f"Bearer {config.api_key}",
                "Content-Type": "application/json",
                "Accept": "application/json",
                "User-Agent": "BXB-Homework-UI/1.0",
            },
            method="POST",
        )

        # 创建 SSL 上下文，处理证书验证问题
        ssl_context = ssl.create_default_context()
        ssl_context.check_hostname = False
        ssl_context.verify_mode = ssl.CERT_NONE

        try:
            with urlopen(request, context=ssl_context, timeout=60) as response:
                raw = response.read().decode("utf-8", errors="replace")
        except HTTPError as error:
            detail = error.read().decode("utf-8", errors="replace") if getattr(error, "fp", None) else ""
            raise UiBackendError(f"模型服务返回 HTTP {error.code}。\n{detail[:800]}") from error
        except URLError as error:
            raise UiBackendError(f"无法连接模型服务：{error.reason}") from error

        try:
            return json.loads(raw) if raw else {}
        except json.JSONDecodeError as error:
            raise UiBackendError(f"模型服务返回了非 JSON 响应：{error}") from error

    def _execute_tool(self, tool_name: str | None, arguments: dict[str, Any]) -> Any:
        if tool_name == "session_status":
            return self.backend.session_status()
        if tool_name == "login_in_browser":
            return self.backend.login_in_browser()
        if tool_name == "list_terms":
            return self.backend.list_terms()
        if tool_name == "set_current_term":
            return self.backend.set_current_term(term_name=arguments.get("term_name"), term_id=arguments.get("term_id"))
        if tool_name == "list_courses":
            return self.backend.list_courses()
        if tool_name == "set_current_subject":
            return self.backend.set_current_subject(
                subject_name=arguments.get("subject_name"),
                subject_id=arguments.get("subject_id"),
                class_id=arguments.get("class_id"),
            )
        if tool_name == "list_tasks":
            return self.backend.list_tasks(
                term_name=arguments.get("term_name"),
                subject_name=arguments.get("subject_name"),
                list_type=arguments.get("list_type") or "all",
                page=int(arguments.get("page") or 1),
                size=int(arguments.get("size") or 20),
            )
        if tool_name == "list_task_rows":
            return self.backend.list_task_rows(
                term_name=arguments.get("term_name"),
                subject_name=arguments.get("subject_name"),
                list_type=arguments.get("list_type") or "all",
                page=int(arguments.get("page") or 1),
                size=int(arguments.get("size") or 20),
            )
        if tool_name == "open_task":
            return self.backend.open_task(
                str(arguments.get("task_id") or ""),
                include_other_submissions=bool(arguments.get("include_other_submissions") or False),
            )
        if tool_name == "read_task_content":
            return self.backend.read_task_content(
                str(arguments.get("task_id") or ""),
                max_chars=int(arguments.get("max_chars") or 3000),
            )
        if tool_name == "download_task_attachment":
            return self.backend.download_task_attachment(
                file_id=str(arguments.get("file_id") or ""),
                task_id=str(arguments["task_id"]) if arguments.get("task_id") is not None else None,
                directory=arguments.get("directory"),
            )
        if tool_name == "read_task_attachment":
            return self.backend.read_task_attachment(
                file_id=str(arguments.get("file_id") or ""),
                task_id=str(arguments["task_id"]) if arguments.get("task_id") is not None else None,
                max_chars=int(arguments.get("max_chars") or 4000),
                directory=arguments.get("directory"),
            )
        if tool_name == "get_current_subject_gpa":
            return self.backend.get_current_subject_gpa()
        if tool_name == "collect_task_submission_context":
            return self.backend.collect_task_submission_context(
                str(arguments.get("task_id") or ""),
                max_chars=int(arguments.get("max_chars") or 4000),
                max_attachments=int(arguments.get("max_attachments") or 6),
            )
        if tool_name == "draft_task_submission":
            return self.backend.draft_task_submission(
                task_id=str(arguments.get("task_id") or ""),
                subject_name=arguments.get("subject_name"),
                task_title=arguments.get("task_title"),
                draft_text=str(arguments.get("draft_text") or ""),
                summary=str(arguments.get("summary") or ""),
                evidence=arguments.get("evidence") or [],
                warnings=arguments.get("warnings") or [],
                missing_info=arguments.get("missing_info") or [],
                needs_user_input=bool(arguments.get("needs_user_input") or False),
            )
        if tool_name == "list_submission_drafts":
            return self.backend.list_submission_drafts(status=arguments.get("status"))
        if tool_name == "get_submission_draft":
            return self.backend.get_submission_draft(str(arguments.get("draft_id") or ""))
        if tool_name == "approve_submission_draft":
            return self.backend.approve_submission_draft(
                str(arguments.get("draft_id") or ""),
                review_note=str(arguments.get("review_note") or ""),
            )
        if tool_name == "reject_submission_draft":
            return self.backend.reject_submission_draft(
                str(arguments.get("draft_id") or ""),
                review_note=str(arguments.get("review_note") or ""),
            )
        raise UiBackendError(f"模型请求了未知工具：{tool_name}")

    @staticmethod
    def _tool_schemas() -> list[dict[str, Any]]:
        return [
            {
                "type": "function",
                "function": {
                    "name": "session_status",
                    "description": "读取当前伴学邦会话、当前学期、当前课程。",
                    "parameters": {"type": "object", "properties": {}, "additionalProperties": False},
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "login_in_browser",
                    "description": "打开浏览器让用户手动登录伴学邦，并保存登录态。",
                    "parameters": {"type": "object", "properties": {}, "additionalProperties": False},
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "list_terms",
                    "description": "列出当前会话可用的学期。",
                    "parameters": {"type": "object", "properties": {}, "additionalProperties": False},
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "set_current_term",
                    "description": "按学期名或学期 id 切换当前学期。",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "term_name": {"type": "string"},
                            "term_id": {"type": ["string", "number"]},
                        },
                        "additionalProperties": False,
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "list_courses",
                    "description": "列出当前学期下可用课程。",
                    "parameters": {"type": "object", "properties": {}, "additionalProperties": False},
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "set_current_subject",
                    "description": "按课程名或课程 id 切换当前课程。",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "subject_name": {"type": "string"},
                            "subject_id": {"type": ["string", "number"]},
                            "class_id": {"type": ["string", "number"]},
                        },
                        "additionalProperties": False,
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "list_tasks",
                    "description": "列出任务的原始结构化结果，包含当前上下文和 homeworkList。",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "term_name": {"type": "string"},
                            "subject_name": {"type": "string"},
                            "list_type": {"type": "string", "enum": ["all", "pending", "latest"]},
                            "page": {"type": "integer"},
                            "size": {"type": "integer"},
                        },
                        "additionalProperties": False,
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "list_task_rows",
                    "description": "列出作业/任务，返回更适合展示的简化列表。",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "term_name": {"type": "string"},
                            "subject_name": {"type": "string"},
                            "list_type": {"type": "string", "enum": ["all", "pending", "latest"]},
                            "page": {"type": "integer"},
                            "size": {"type": "integer"},
                        },
                        "additionalProperties": False,
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "open_task",
                    "description": "打开任务详情，返回正文、附件、提交状态等更完整的结构化信息。",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "task_id": {"type": "string"},
                            "include_other_submissions": {"type": "boolean"},
                        },
                        "required": ["task_id"],
                        "additionalProperties": False,
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "read_task_content",
                    "description": "按 task_id 读取任务正文和附件摘要。",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "task_id": {"type": "string"},
                            "max_chars": {"type": "integer"},
                        },
                        "required": ["task_id"],
                        "additionalProperties": False,
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "download_task_attachment",
                    "description": "把任务附件下载到本地工作目录。只在用户明确要求保存到本地时使用。",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "task_id": {"type": "string"},
                            "file_id": {"type": "string"},
                            "directory": {"type": "string"},
                        },
                        "required": ["file_id"],
                        "additionalProperties": False,
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "read_task_attachment",
                    "description": "读取任务附件正文，适合 PDF、DOCX、TXT 等可提取文本的附件。",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "task_id": {"type": "string"},
                            "file_id": {"type": "string"},
                            "max_chars": {"type": "integer"},
                            "directory": {"type": "string"},
                        },
                        "required": ["file_id"],
                        "additionalProperties": False,
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "collect_task_submission_context",
                    "description": "按 task_id 收集写草稿前需要的正文、附件文本、缺失信息和充分性判断。",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "task_id": {"type": "string"},
                            "max_chars": {"type": "integer"},
                            "max_attachments": {"type": "integer"},
                        },
                        "required": ["task_id"],
                        "additionalProperties": False,
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "draft_task_submission",
                    "description": "保存已经写好的提交草稿，等待人工审核。这不是最终提交。",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "task_id": {"type": "string"},
                            "subject_name": {"type": "string"},
                            "task_title": {"type": "string"},
                            "draft_text": {"type": "string"},
                            "summary": {"type": "string"},
                            "evidence": {"type": "array"},
                            "warnings": {"type": "array", "items": {"type": "string"}},
                            "missing_info": {"type": "array", "items": {"type": "string"}},
                            "needs_user_input": {"type": "boolean"},
                        },
                        "required": ["task_id", "draft_text"],
                        "additionalProperties": False,
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "list_submission_drafts",
                    "description": "列出已保存的草稿和审核状态。",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "status": {"type": "string", "enum": ["pending_review", "approved", "rejected", "submitted"]},
                        },
                        "additionalProperties": False,
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "get_submission_draft",
                    "description": "读取某个草稿的完整内容。",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "draft_id": {"type": "string"},
                        },
                        "required": ["draft_id"],
                        "additionalProperties": False,
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "approve_submission_draft",
                    "description": "把草稿标记为已审核通过。只有用户明确同意时才使用。",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "draft_id": {"type": "string"},
                            "review_note": {"type": "string"},
                        },
                        "required": ["draft_id"],
                        "additionalProperties": False,
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "reject_submission_draft",
                    "description": "把草稿标记为已驳回。只有用户明确拒绝时才使用。",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "draft_id": {"type": "string"},
                            "review_note": {"type": "string"},
                        },
                        "required": ["draft_id"],
                        "additionalProperties": False,
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "get_current_subject_gpa",
                    "description": "读取当前课程的平均 GPA / 等级。",
                    "parameters": {"type": "object", "properties": {}, "additionalProperties": False},
                },
            },
        ]

    @staticmethod
    def _message_content_as_text(content: Any) -> str:
        if isinstance(content, str):
            return content.strip()
        if isinstance(content, list):
            parts: list[str] = []
            for item in content:
                if isinstance(item, dict) and item.get("type") == "text":
                    text = item.get("text")
                    if text:
                        parts.append(str(text))
            return "\n".join(parts).strip()
        return ""

    @staticmethod
    def _config_ready(config: ModelConfig) -> bool:
        return bool(config.api_key.strip() and config.base_url.strip() and config.model_name.strip())

    def _remember(self, role: str, text: str) -> None:
        self.turns.append(AgentTurn(role=role, text=text))

    def _emit_progress(self, kind: str, summary: str, detail: str | None = None) -> None:
        if self._progress_callback is not None:
            self._progress_callback(AgentProgressEvent(kind=kind, summary=summary, detail=detail))

    @staticmethod
    def _truncate_detail(detail: str, limit: int = 1800) -> str:
        if len(detail) <= limit:
            return detail
        return f"{detail[:limit]}\n... (truncated)"
