from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path
from typing import Any

from .interfaces import BanxuebangUiBackend, UiBackendError


class DirectToolBackend(BanxuebangUiBackend):
    def __init__(self, repo_root: Path | None = None, node_command: str = "node") -> None:
        self.repo_root = repo_root or Path(__file__).resolve().parents[2]
        self.node_command = node_command
        self.tool_script = self.repo_root / "scripts" / "direct-tool.js"

    def _call_tool(self, tool_name: str, arguments: dict[str, Any] | None = None) -> dict[str, Any]:
        payload = arguments or {}
        command = [
            self.node_command,
            str(self.tool_script),
            tool_name,
            json.dumps(payload, ensure_ascii=False),
        ]

        startupinfo = None
        creationflags = 0
        if os.name == "nt":
            startupinfo = subprocess.STARTUPINFO()
            startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW
            startupinfo.wShowWindow = 0
            creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0)

        result = subprocess.run(
            command,
            cwd=self.repo_root,
            capture_output=True,
            text=True,
            encoding="utf-8",
            startupinfo=startupinfo,
            creationflags=creationflags,
        )

        if result.returncode != 0:
            message = self._clean_error_message(result.stderr or result.stdout or "")
            raise UiBackendError(message or f"Tool {tool_name} failed with exit code {result.returncode}.")

        stdout = result.stdout.strip()
        if not stdout:
            return {}

        try:
            return json.loads(stdout)
        except json.JSONDecodeError as error:
            raise UiBackendError(f"Tool {tool_name} returned non-JSON output: {error}") from error

    @staticmethod
    def _clean_error_message(raw: str) -> str:
        lines: list[str] = []
        for line in raw.splitlines():
            stripped = line.strip()
            if not stripped or stripped.startswith("at "):
                continue
            lines.append(stripped)

        if not lines:
            return raw.strip()

        first = lines[0]
        if first.startswith("Error: "):
            return first[len("Error: ") :]
        return first

    def session_status(self) -> dict[str, Any]:
        return self._call_tool("session_status")

    def login_in_browser(self, *, headless: bool = False, timeout_ms: int = 300000) -> dict[str, Any]:
        return self._call_tool(
            "login_in_browser",
            {
                "headless": headless,
                "timeout_ms": timeout_ms,
            },
        )

    def login_with_credentials(
        self,
        *,
        username: str,
        password: str,
        headless: bool = False,
        timeout_ms: int = 60000,
    ) -> dict[str, Any]:
        return self._call_tool(
            "login_with_credentials",
            {
                "username": username,
                "password": password,
                "headless": headless,
                "timeout_ms": timeout_ms,
            },
        )

    def list_terms(self) -> dict[str, Any]:
        return self._call_tool("list_terms")

    def set_current_term(self, *, term_id: str | None = None, term_name: str | None = None) -> dict[str, Any]:
        args: dict[str, Any] = {}
        if term_id:
            args["term_id"] = term_id
        if term_name:
            args["term_name"] = term_name
        return self._call_tool("set_current_term", args)

    def list_courses(self) -> dict[str, Any]:
        return self._call_tool("list_courses")

    def set_current_subject(
        self,
        *,
        subject_id: str | None = None,
        subject_name: str | None = None,
        class_id: str | None = None,
    ) -> dict[str, Any]:
        args: dict[str, Any] = {}
        if subject_id:
            args["subject_id"] = subject_id
        if subject_name:
            args["subject_name"] = subject_name
        if class_id:
            args["class_id"] = class_id
        return self._call_tool("set_current_subject", args)

    def list_tasks(
        self,
        *,
        term_name: str | None = None,
        subject_name: str | None = None,
        list_type: str = "all",
        page: int = 1,
        size: int = 20,
    ) -> dict[str, Any]:
        args: dict[str, Any] = {
            "list_type": list_type,
            "page": page,
            "size": size,
        }
        if term_name:
            args["term_name"] = term_name
        if subject_name:
            args["subject_name"] = subject_name
        return self._call_tool("list_tasks", args)

    def list_task_rows(
        self,
        *,
        term_name: str | None = None,
        subject_name: str | None = None,
        list_type: str = "all",
        page: int = 1,
        size: int = 20,
    ) -> list[dict[str, Any]]:
        if subject_name:
            result = self.list_tasks(
                term_name=term_name,
                subject_name=subject_name,
                list_type=list_type,
                page=page,
                size=size,
            )
            return self._normalize_task_rows(result)

        previous = self.session_status()
        previous_subject = (previous or {}).get("currentSubject") or {}

        aggregated: list[dict[str, Any]] = []
        try:
            if term_name:
                self.set_current_term(term_name=term_name)

            courses = self.list_courses().get("courses", [])
            for course in courses:
                course_name = course.get("name")
                if not course_name:
                    continue

                result = self.list_tasks(
                    term_name=term_name,
                    subject_name=course_name,
                    list_type=list_type,
                    page=page,
                    size=size,
                )
                aggregated.extend(self._normalize_task_rows(result))
        finally:
            restore_name = previous_subject.get("name")
            restore_class_id = previous_subject.get("classId")
            if restore_name:
                try:
                    self.set_current_subject(subject_name=restore_name, class_id=restore_class_id)
                except UiBackendError:
                    pass

        return aggregated

    def _normalize_task_rows(self, result: dict[str, Any]) -> list[dict[str, Any]]:
        context = (result or {}).get("context") or {}
        current_subject = context.get("currentSubject") or {}
        course_name = current_subject.get("name")
        rows: list[dict[str, Any]] = []

        for item in result.get("homeworkList", []):
            rows.append(
                {
                    "task_id": str(item.get("id", "")),
                    "course": course_name or item.get("courseName") or "",
                    "name": item.get("activityName", ""),
                    "publish_time": item.get("releaseTime") or "",
                    "deadline": item.get("endTime") or "",
                    "score": item.get("scoreLevel") or item.get("score") or "",
                    "score_type": item.get("scoreTypeName") or "",
                }
            )

        return rows

    def read_task_content(self, task_id: str, *, max_chars: int = 4000) -> dict[str, Any]:
        return self._call_tool(
            "read_task_content",
            {
                "task_id": task_id,
                "max_chars": max_chars,
            },
        )

    def open_task(self, task_id: str, *, include_other_submissions: bool = False) -> dict[str, Any]:
        return self._call_tool(
            "open_task",
            {
                "task_id": task_id,
                "include_other_submissions": include_other_submissions,
            },
        )

    def download_task_attachment(
        self,
        *,
        file_id: str,
        task_id: str | None = None,
        directory: str | None = None,
    ) -> dict[str, Any]:
        args: dict[str, Any] = {"file_id": file_id}
        if task_id:
            args["task_id"] = task_id
        if directory:
            args["directory"] = directory
        return self._call_tool("download_task_attachment", args)

    def read_task_attachment(
        self,
        *,
        file_id: str,
        task_id: str | None = None,
        max_chars: int = 4000,
        directory: str | None = None,
    ) -> dict[str, Any]:
        args: dict[str, Any] = {
            "file_id": file_id,
            "max_chars": max_chars,
        }
        if task_id:
            args["task_id"] = task_id
        if directory:
            args["directory"] = directory
        return self._call_tool("read_task_attachment", args)

    def get_current_subject_gpa(self) -> dict[str, Any]:
        return self._call_tool("get_current_subject_gpa")

    def collect_task_submission_context(
        self,
        task_id: str,
        *,
        max_chars: int = 4000,
        max_attachments: int = 6,
    ) -> dict[str, Any]:
        return self._call_tool(
            "collect_task_submission_context",
            {
                "task_id": task_id,
                "max_chars": max_chars,
                "max_attachments": max_attachments,
            },
        )

    def draft_task_submission(
        self,
        *,
        task_id: str,
        subject_name: str | None,
        task_title: str | None,
        draft_text: str,
        summary: str = "",
        evidence: list[dict[str, Any]] | None = None,
        warnings: list[str] | None = None,
        missing_info: list[str] | None = None,
        needs_user_input: bool = False,
    ) -> dict[str, Any]:
        args: dict[str, Any] = {
            "task_id": task_id,
            "draft_text": draft_text,
            "summary": summary,
            "evidence": evidence or [],
            "warnings": warnings or [],
            "missing_info": missing_info or [],
            "needs_user_input": needs_user_input,
        }
        if subject_name:
            args["subject_name"] = subject_name
        if task_title:
            args["task_title"] = task_title
        return self._call_tool("draft_task_submission", args)

    def list_submission_drafts(self, *, status: str | None = None) -> dict[str, Any]:
        args: dict[str, Any] = {}
        if status:
            args["status"] = status
        return self._call_tool("list_submission_drafts", args)

    def get_submission_draft(self, draft_id: str) -> dict[str, Any]:
        return self._call_tool("get_submission_draft", {"draft_id": draft_id})

    def approve_submission_draft(self, draft_id: str, *, review_note: str = "") -> dict[str, Any]:
        return self._call_tool(
            "approve_submission_draft",
            {
                "draft_id": draft_id,
                "review_note": review_note,
            },
        )

    def reject_submission_draft(self, draft_id: str, *, review_note: str = "") -> dict[str, Any]:
        return self._call_tool(
            "reject_submission_draft",
            {
                "draft_id": draft_id,
                "review_note": review_note,
            },
        )
