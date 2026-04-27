from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any


class UiBackendError(RuntimeError):
    """Raised when the UI backend cannot fulfill a request."""


class UnsupportedCapabilityError(UiBackendError):
    """Raised when the selected backend does not expose a requested capability."""


class BanxuebangUiBackend(ABC):
    @abstractmethod
    def session_status(self) -> dict[str, Any]:
        raise NotImplementedError

    @abstractmethod
    def login_in_browser(self, *, headless: bool = False, timeout_ms: int = 300000) -> dict[str, Any]:
        raise NotImplementedError

    @abstractmethod
    def login_with_credentials(
        self,
        *,
        username: str,
        password: str,
        headless: bool = False,
        timeout_ms: int = 60000,
    ) -> dict[str, Any]:
        raise NotImplementedError

    @abstractmethod
    def list_terms(self) -> dict[str, Any]:
        raise NotImplementedError

    @abstractmethod
    def set_current_term(self, *, term_id: str | None = None, term_name: str | None = None) -> dict[str, Any]:
        raise NotImplementedError

    @abstractmethod
    def list_courses(self) -> dict[str, Any]:
        raise NotImplementedError

    @abstractmethod
    def set_current_subject(
        self,
        *,
        subject_id: str | None = None,
        subject_name: str | None = None,
        class_id: str | None = None,
    ) -> dict[str, Any]:
        raise NotImplementedError

    @abstractmethod
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

    @abstractmethod
    def list_task_rows(
        self,
        *,
        term_name: str | None = None,
        subject_name: str | None = None,
        list_type: str = "all",
        page: int = 1,
        size: int = 20,
    ) -> list[dict[str, Any]]:
        raise NotImplementedError

    @abstractmethod
    def read_task_content(self, task_id: str, *, max_chars: int = 4000) -> dict[str, Any]:
        raise NotImplementedError

    @abstractmethod
    def open_task(self, task_id: str, *, include_other_submissions: bool = False) -> dict[str, Any]:
        raise NotImplementedError

    @abstractmethod
    def download_task_attachment(
        self,
        *,
        file_id: str,
        task_id: str | None = None,
        directory: str | None = None,
    ) -> dict[str, Any]:
        raise NotImplementedError

    @abstractmethod
    def read_task_attachment(
        self,
        *,
        file_id: str,
        task_id: str | None = None,
        max_chars: int = 4000,
        directory: str | None = None,
    ) -> dict[str, Any]:
        raise NotImplementedError

    @abstractmethod
    def get_current_subject_gpa(self) -> dict[str, Any]:
        raise NotImplementedError

    @abstractmethod
    def collect_task_submission_context(
        self,
        task_id: str,
        *,
        max_chars: int = 4000,
        max_attachments: int = 6,
    ) -> dict[str, Any]:
        raise NotImplementedError

    @abstractmethod
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
        raise NotImplementedError

    @abstractmethod
    def list_submission_drafts(self, *, status: str | None = None) -> dict[str, Any]:
        raise NotImplementedError

    @abstractmethod
    def get_submission_draft(self, draft_id: str) -> dict[str, Any]:
        raise NotImplementedError

    @abstractmethod
    def approve_submission_draft(self, draft_id: str, *, review_note: str = "") -> dict[str, Any]:
        raise NotImplementedError

    @abstractmethod
    def reject_submission_draft(self, draft_id: str, *, review_note: str = "") -> dict[str, Any]:
        raise NotImplementedError

    def get_schedule(self) -> dict[str, Any]:
        raise UnsupportedCapabilityError("The current main-branch backend does not expose schedule data yet.")

    def get_notices(self) -> dict[str, Any]:
        raise UnsupportedCapabilityError("The current main-branch backend does not expose notices yet.")
