from __future__ import annotations

import json
from typing import Any

from .agent import ConversationAgent
from .interfaces import BanxuebangUiBackend


class FakeBackend(BanxuebangUiBackend):
    def __init__(self) -> None:
        self.calls: list[tuple[str, dict[str, Any]]] = []
        self._session = {
            "ready": True,
            "user": {"name": "测试用户"},
            "currentSubject": {"name": "软硬件加速工程"},
            "availableSubjects": [
                {"name": "软硬件加速工程"},
                {"name": "国际公民素养"},
            ],
            "availableTerms": [
                {"name": "2025-2026上学期", "status": False},
                {"name": "2025-2026下学期", "status": True},
            ],
        }

    def session_status(self) -> dict[str, Any]:
        self.calls.append(("session_status", {}))
        return self._session

    def login_in_browser(self, *, headless: bool = False, timeout_ms: int = 300000) -> dict[str, Any]:
        self.calls.append(("login_in_browser", {"headless": headless, "timeout_ms": timeout_ms}))
        return {"ok": True}

    def login_with_credentials(
        self,
        *,
        username: str,
        password: str,
        headless: bool = False,
        timeout_ms: int = 60000,
    ) -> dict[str, Any]:
        self.calls.append(
            (
                "login_with_credentials",
                {"username": username, "password": password, "headless": headless, "timeout_ms": timeout_ms},
            )
        )
        return {"ok": True}

    def list_terms(self) -> dict[str, Any]:
        self.calls.append(("list_terms", {}))
        return {"terms": self._session["availableTerms"]}

    def set_current_term(self, *, term_id: str | None = None, term_name: str | None = None) -> dict[str, Any]:
        self.calls.append(("set_current_term", {"term_id": term_id, "term_name": term_name}))
        for term in self._session["availableTerms"]:
            term["status"] = term["name"] == term_name
        return self._session

    def list_courses(self) -> dict[str, Any]:
        self.calls.append(("list_courses", {}))
        return {"courses": [{"name": item["name"]} for item in self._session["availableSubjects"]]}

    def set_current_subject(
        self,
        *,
        subject_id: str | None = None,
        subject_name: str | None = None,
        class_id: str | None = None,
    ) -> dict[str, Any]:
        self.calls.append(
            ("set_current_subject", {"subject_id": subject_id, "subject_name": subject_name, "class_id": class_id})
        )
        self._session["currentSubject"] = {"name": subject_name or ""}
        return self._session

    def list_tasks(
        self,
        *,
        term_name: str | None = None,
        subject_name: str | None = None,
        list_type: str = "all",
        page: int = 1,
        size: int = 20,
    ) -> dict[str, Any]:
        raise NotImplementedError

    def list_task_rows(
        self,
        *,
        term_name: str | None = None,
        subject_name: str | None = None,
        list_type: str = "all",
        page: int = 1,
        size: int = 20,
    ) -> list[dict[str, Any]]:
        self.calls.append(
            (
                "list_task_rows",
                {
                    "term_name": term_name,
                    "subject_name": subject_name,
                    "list_type": list_type,
                    "page": page,
                    "size": size,
                },
            )
        )
        return [
            {
                "task_id": "2046748211590590465",
                "course": subject_name or self._session["currentSubject"]["name"],
                "name": "根据代码判断功能",
                "deadline": "2026-04-30",
                "score": "",
            },
            {
                "task_id": "2046748211590590466",
                "course": subject_name or self._session["currentSubject"]["name"],
                "name": "第二个任务",
                "deadline": "2026-05-01",
                "score": "",
            },
        ]

    def read_task_content(self, task_id: str, *, max_chars: int = 4000) -> dict[str, Any]:
        self.calls.append(("read_task_content", {"task_id": task_id, "max_chars": max_chars}))
        return {
            "taskSummary": {"id": task_id, "activityName": "根据代码判断功能", "endTime": "2026-04-30"},
            "attachments": [{"id": "f1", "name": "附件.pdf"}],
            "content": "任务正文示例",
        }

    def open_task(self, task_id: str, *, include_other_submissions: bool = False) -> dict[str, Any]:
        self.calls.append(
            ("open_task", {"task_id": task_id, "include_other_submissions": include_other_submissions})
        )
        return {"id": task_id}

    def download_task_attachment(
        self,
        *,
        file_id: str,
        task_id: str | None = None,
        directory: str | None = None,
    ) -> dict[str, Any]:
        self.calls.append(
            ("download_task_attachment", {"file_id": file_id, "task_id": task_id, "directory": directory})
        )
        return {"fileId": file_id, "savedPath": "D:\\fake\\attachment.pdf"}

    def read_task_attachment(
        self,
        *,
        file_id: str,
        task_id: str | None = None,
        max_chars: int = 4000,
        directory: str | None = None,
    ) -> dict[str, Any]:
        self.calls.append(
            (
                "read_task_attachment",
                {
                    "file_id": file_id,
                    "task_id": task_id,
                    "max_chars": max_chars,
                    "directory": directory,
                },
            )
        )
        return {"fileId": file_id, "readable": True, "content": "附件正文示例"}

    def get_current_subject_gpa(self) -> dict[str, Any]:
        self.calls.append(("get_current_subject_gpa", {}))
        return {"averageLevel": "A+"}


def main() -> int:
    backend = FakeBackend()
    agent = ConversationAgent(backend)

    first = agent.handle("切到国际公民素养并列出未提交作业")
    second = agent.handle("打开第一个任务")
    third = agent.handle("查看当前课程GPA")

    payload = {
        "messages": [first.message, second.message, third.message],
        "calls": backend.calls,
        "recent_turns": [{"role": turn.role, "text": turn.text} for turn in agent.recent_turns()],
    }
    print(json.dumps(payload, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
