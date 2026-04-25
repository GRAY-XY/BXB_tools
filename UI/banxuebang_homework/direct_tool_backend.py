from __future__ import annotations

import json
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

        result = subprocess.run(
            command,
            cwd=self.repo_root,
            capture_output=True,
            text=True,
            encoding="utf-8",
        )

        if result.returncode != 0:
            message = (result.stderr or result.stdout or "").strip()
            raise UiBackendError(message or f"Tool {tool_name} failed with exit code {result.returncode}.")

        stdout = result.stdout.strip()
        if not stdout:
            return {}

        try:
            return json.loads(stdout)
        except json.JSONDecodeError as error:
            raise UiBackendError(f"Tool {tool_name} returned non-JSON output: {error}") from error

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

    def get_current_subject_gpa(self) -> dict[str, Any]:
        return self._call_tool("get_current_subject_gpa")
