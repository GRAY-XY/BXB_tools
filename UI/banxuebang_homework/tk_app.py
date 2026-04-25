from __future__ import annotations

import json
import threading
import tkinter as tk
from tkinter import messagebox, ttk
from typing import Any, Callable

from .direct_tool_backend import DirectToolBackend
from .interfaces import BanxuebangUiBackend


class HomeworkUiApp:
    def __init__(self, root: tk.Tk, backend: BanxuebangUiBackend | None = None) -> None:
        self.root = root
        self.root.title("BXB Homework UI")
        self.root.geometry("1080x700")
        self.root.minsize(920, 620)

        self.backend = backend or DirectToolBackend()
        self.session_data: dict[str, Any] = {}
        self.current_task_rows: list[dict[str, Any]] = []

        self.status_var = tk.StringVar(value="Ready")
        self.term_var = tk.StringVar(value="")
        self.course_var = tk.StringVar(value="")
        self.task_scope_var = tk.StringVar(value="current")
        self.username_var = tk.StringVar(value="")
        self.password_var = tk.StringVar(value="")

        self.pages: dict[str, ttk.Frame] = {}
        self.nav_buttons: dict[str, tk.Button] = {}

        self._build_ui()
        self.refresh_session()

    def _build_ui(self) -> None:
        main = ttk.Frame(self.root)
        main.pack(fill="both", expand=True)

        self.sidebar = tk.Frame(main, width=76, bg="#243746")
        self.sidebar.pack(side="left", fill="y")
        self.sidebar.pack_propagate(False)

        self.content = ttk.Frame(main)
        self.content.pack(side="left", fill="both", expand=True)

        self.status_bar = ttk.Label(
            self.root,
            textvariable=self.status_var,
            relief="sunken",
            anchor="w",
            padding=(6, 3),
        )
        self.status_bar.pack(fill="x", side="bottom")

        nav_items = [
            ("home", "主页"),
            ("homework", "作业"),
            ("schedule", "课表"),
            ("notices", "通知"),
        ]
        for key, label in nav_items:
            button = tk.Button(
                self.sidebar,
                text=label,
                font=("", 11),
                relief="flat",
                bg="#243746",
                fg="white",
                activebackground="#325168",
                activeforeground="white",
                cursor="hand2",
                command=lambda page_key=key: self._show_page(page_key),
            )
            button.pack(fill="x", pady=(8, 0), ipadx=6, ipady=14)
            self.nav_buttons[key] = button

        self._build_home_page()
        self._build_homework_page()
        self._build_placeholder_page("schedule", "当前 main 分支后端还没有课表接口。")
        self._build_placeholder_page("notices", "当前 main 分支后端还没有通知接口。")

        self._show_page("home")

    def _build_home_page(self) -> None:
        page = ttk.Frame(self.content, padding=24)
        self.pages["home"] = page

        header = ttk.Frame(page)
        header.pack(fill="x")

        ttk.Label(header, text="Banxuebang Homework UI", font=("", 26, "bold")).pack(anchor="w")
        ttk.Label(
            header,
            text="这是从 client 分支拆出的 UI 壳，底层默认复用 main 分支的 direct-tool.js。",
            foreground="#666666",
        ).pack(anchor="w", pady=(6, 0))

        container = ttk.Frame(page)
        container.pack(fill="both", expand=True, pady=(24, 0))

        left = ttk.LabelFrame(container, text="登录", padding=18)
        left.pack(side="left", fill="y")

        ttk.Label(left, text="账号").grid(row=0, column=0, sticky="w", pady=8)
        ttk.Entry(left, textvariable=self.username_var, width=32).grid(row=0, column=1, pady=8, padx=(12, 0))

        ttk.Label(left, text="密码").grid(row=1, column=0, sticky="w", pady=8)
        ttk.Entry(left, textvariable=self.password_var, show="*", width=32).grid(
            row=1, column=1, pady=8, padx=(12, 0)
        )

        ttk.Button(left, text="浏览器登录", command=self._login_in_browser).grid(
            row=2, column=0, columnspan=2, sticky="ew", pady=(16, 8)
        )
        ttk.Button(left, text="账号密码登录", command=self._login_with_credentials).grid(
            row=3, column=0, columnspan=2, sticky="ew", pady=8
        )
        ttk.Button(left, text="刷新当前会话", command=self.refresh_session).grid(
            row=4, column=0, columnspan=2, sticky="ew", pady=8
        )

        right = ttk.LabelFrame(container, text="当前会话", padding=18)
        right.pack(side="left", fill="both", expand=True, padx=(18, 0))

        self.session_text = tk.Text(
            right,
            height=24,
            wrap="word",
            font=("Consolas", 10),
            bg="#fafafa",
            relief="solid",
            borderwidth=1,
        )
        self.session_text.pack(fill="both", expand=True)

    def _build_homework_page(self) -> None:
        page = ttk.Frame(self.content, padding=16)
        self.pages["homework"] = page

        toolbar = ttk.Frame(page)
        toolbar.pack(fill="x", pady=(0, 10))

        ttk.Label(toolbar, text="学期").pack(side="left")
        self.term_combo = ttk.Combobox(toolbar, textvariable=self.term_var, state="readonly", width=22)
        self.term_combo.pack(side="left", padx=(6, 14))
        self.term_combo.bind("<<ComboboxSelected>>", lambda _event: self._on_term_changed())

        ttk.Label(toolbar, text="课程").pack(side="left")
        self.course_combo = ttk.Combobox(toolbar, textvariable=self.course_var, state="readonly", width=24)
        self.course_combo.pack(side="left", padx=(6, 14))

        ttk.Label(toolbar, text="范围").pack(side="left")
        self.scope_combo = ttk.Combobox(
            toolbar,
            textvariable=self.task_scope_var,
            state="readonly",
            width=16,
            values=["current", "all-courses"],
        )
        self.scope_combo.pack(side="left", padx=(6, 14))
        self.scope_combo.set("current")

        ttk.Button(toolbar, text="刷新作业", command=self.load_homework).pack(side="left")
        ttk.Button(toolbar, text="当前课程 GPA", command=self.load_gpa).pack(side="left", padx=(8, 0))

        split = ttk.PanedWindow(page, orient="horizontal")
        split.pack(fill="both", expand=True)

        left = ttk.Frame(split)
        right = ttk.Frame(split)
        split.add(left, weight=3)
        split.add(right, weight=2)

        columns = ("task_id", "course", "name", "deadline", "score")
        self.homework_tree = ttk.Treeview(left, columns=columns, show="headings", height=22)
        self.homework_tree.heading("task_id", text="Task ID")
        self.homework_tree.heading("course", text="课程")
        self.homework_tree.heading("name", text="任务")
        self.homework_tree.heading("deadline", text="截止时间")
        self.homework_tree.heading("score", text="成绩")
        self.homework_tree.column("task_id", width=150)
        self.homework_tree.column("course", width=140)
        self.homework_tree.column("name", width=320)
        self.homework_tree.column("deadline", width=150)
        self.homework_tree.column("score", width=80)
        self.homework_tree.pack(fill="both", expand=True, side="left")
        self.homework_tree.bind("<<TreeviewSelect>>", self._on_task_selected)

        tree_scroll = ttk.Scrollbar(left, orient="vertical", command=self.homework_tree.yview)
        self.homework_tree.configure(yscrollcommand=tree_scroll.set)
        tree_scroll.pack(side="right", fill="y")

        detail_box = ttk.LabelFrame(right, text="任务详情", padding=10)
        detail_box.pack(fill="both", expand=True)

        self.detail_text = tk.Text(
            detail_box,
            wrap="word",
            font=("Consolas", 10),
            bg="#fbfbfb",
            relief="solid",
            borderwidth=1,
        )
        self.detail_text.pack(fill="both", expand=True)

    def _build_placeholder_page(self, name: str, message: str) -> None:
        page = ttk.Frame(self.content, padding=32)
        self.pages[name] = page
        ttk.Label(page, text=message, font=("", 16)).pack(anchor="center", expand=True)

    def _show_page(self, name: str) -> None:
        for key, page in self.pages.items():
            page.pack_forget()
            self.nav_buttons[key].configure(bg="#243746", font=("", 11))

        self.pages[name].pack(fill="both", expand=True)
        self.nav_buttons[name].configure(bg="#325168", font=("", 11, "bold"))

    def _run_async(
        self,
        status_text: str,
        work: Callable[[], Any],
        on_success: Callable[[Any], None],
    ) -> None:
        self._set_status(status_text)

        def runner() -> None:
            try:
                result = work()
                self.root.after(0, lambda: on_success(result))
            except Exception as error:  # noqa: BLE001
                self.root.after(0, lambda err=error: self._handle_error(err))

        threading.Thread(target=runner, daemon=True).start()

    def _handle_error(self, error: Exception) -> None:
        self._set_status("操作失败")
        messagebox.showerror("错误", str(error))

    def _set_status(self, text: str) -> None:
        self.status_var.set(text)
        self.root.update_idletasks()

    def _write_json(self, widget: tk.Text, payload: Any) -> None:
        widget.delete("1.0", "end")
        widget.insert("1.0", json.dumps(payload, ensure_ascii=False, indent=2))

    def refresh_session(self) -> None:
        self._run_async(
            "正在读取当前会话...",
            self.backend.session_status,
            self._on_session_loaded,
        )

    def _on_session_loaded(self, session: dict[str, Any]) -> None:
        self.session_data = session or {}
        self._write_json(self.session_text, self.session_data)

        terms = [item.get("name", "") for item in session.get("availableTerms", []) if item.get("name")]
        current_term_items = session.get("availableTerms", []) or []
        current_term_name = next((item.get("name") for item in current_term_items if item.get("status")), None)

        subjects = [item.get("name", "") for item in session.get("availableSubjects", []) if item.get("name")]
        current_subject = (session.get("currentSubject") or {}).get("name") or ""

        self.term_combo["values"] = terms
        self.course_combo["values"] = ["全部"] + subjects if subjects else ["全部"]

        if current_term_name:
            self.term_var.set(current_term_name)
        elif terms:
            self.term_var.set(terms[0])

        if current_subject:
            self.course_var.set(current_subject)
        elif subjects:
            self.course_var.set(subjects[0])
        else:
            self.course_var.set("全部")

        user = session.get("user", {}) or {}
        self._set_status(f"当前用户: {user.get('name') or '未登录'}")

    def _login_in_browser(self) -> None:
        self._run_async(
            "正在打开浏览器登录...",
            lambda: self.backend.login_in_browser(),
            lambda _result: self.refresh_session(),
        )

    def _login_with_credentials(self) -> None:
        username = self.username_var.get().strip()
        password = self.password_var.get().strip()

        if not username or not password:
            messagebox.showwarning("提示", "请输入账号和密码。")
            return

        self._run_async(
            "正在登录...",
            lambda: self.backend.login_with_credentials(username=username, password=password),
            lambda _result: self.refresh_session(),
        )

    def _on_term_changed(self) -> None:
        term_name = self.term_var.get().strip()
        if not term_name:
            return

        def work() -> tuple[dict[str, Any], dict[str, Any]]:
            self.backend.set_current_term(term_name=term_name)
            courses = self.backend.list_courses()
            session = self.backend.session_status()
            return courses, session

        def on_success(result: tuple[dict[str, Any], dict[str, Any]]) -> None:
            courses, session = result
            self.session_data = session
            course_names = [item.get("name", "") for item in courses.get("courses", []) if item.get("name")]
            self.course_combo["values"] = ["全部"] + course_names if course_names else ["全部"]
            current_subject = (session.get("currentSubject") or {}).get("name") or ""
            self.course_var.set(current_subject or (course_names[0] if course_names else "全部"))
            self._write_json(self.session_text, session)
            self._set_status(f"已切换到学期: {term_name}")

        self._run_async("正在切换学期...", work, on_success)

    def load_homework(self) -> None:
        term_name = self.term_var.get().strip() or None
        course_name = self.course_var.get().strip()
        scope = self.task_scope_var.get().strip() or "current"

        if scope == "all-courses" or course_name == "全部":
            subject_name = None
        else:
            subject_name = course_name or None

        self._run_async(
            "正在加载作业...",
            lambda: self.backend.list_task_rows(
                term_name=term_name,
                subject_name=subject_name,
                list_type="all",
                page=1,
                size=50,
            ),
            self._display_homework_rows,
        )

    def _display_homework_rows(self, rows: list[dict[str, Any]]) -> None:
        self.current_task_rows = rows
        for item in self.homework_tree.get_children():
            self.homework_tree.delete(item)

        for row in rows:
            self.homework_tree.insert(
                "",
                "end",
                values=(
                    row.get("task_id", ""),
                    row.get("course", ""),
                    row.get("name", ""),
                    row.get("deadline", ""),
                    row.get("score", ""),
                ),
            )

        self.detail_text.delete("1.0", "end")
        self._set_status(f"共加载 {len(rows)} 条任务")

    def _on_task_selected(self, _event: tk.Event[Any]) -> None:
        selection = self.homework_tree.selection()
        if not selection:
            return

        item = selection[0]
        task_id = self.homework_tree.item(item, "values")[0]
        if not task_id:
            return

        self._run_async(
            "正在读取任务正文...",
            lambda: self.backend.read_task_content(str(task_id), max_chars=2500),
            self._display_task_detail,
        )

    def _display_task_detail(self, result: dict[str, Any]) -> None:
        summary = result.get("taskSummary", {}) or {}
        attachments = result.get("attachments", []) or []
        lines = [
            f"任务: {summary.get('activityName', '')}",
            f"Task ID: {summary.get('id', '')}",
            f"截止时间: {summary.get('endTime', '')}",
            f"附件数量: {len(attachments)}",
            "",
            "正文:",
            result.get("content", "") or "(无正文)",
        ]

        self.detail_text.delete("1.0", "end")
        self.detail_text.insert("1.0", "\n".join(lines))
        self._set_status("任务正文已更新")

    def load_gpa(self) -> None:
        self._run_async(
            "正在读取当前课程 GPA...",
            self.backend.get_current_subject_gpa,
            self._display_gpa,
        )

    def _display_gpa(self, result: dict[str, Any]) -> None:
        self.detail_text.delete("1.0", "end")
        self.detail_text.insert("1.0", json.dumps(result, ensure_ascii=False, indent=2))
        self._set_status("GPA 已更新")


def main() -> None:
    root = tk.Tk()
    HomeworkUiApp(root)
    root.mainloop()


if __name__ == "__main__":
    main()
