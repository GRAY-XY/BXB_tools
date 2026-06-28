from __future__ import annotations

import html
import json
import re
import threading
import time
import tkinter as tk
import webbrowser
from tkinter import messagebox, ttk
from typing import Any, Callable
import unicodedata
from markdown_it import MarkdownIt
import ttkbootstrap as ttkb
from tkinterweb import HtmlFrame

from .agent import AgentProgressEvent, AgentReply
from .backend_factory import create_backend
from .interfaces import BanxuebangUiBackend
from .llm_agent import LlmConversationAgent
from .model_config import (
    ModelConfig,
    clear_model_config,
    config_path,
    known_context_length,
    load_model_config,
    masked_key,
    save_model_config,
    test_model_connection,
)
from .ui_settings import UiSettings, load_ui_settings, save_ui_settings, settings_as_dict, settings_path


class HomeworkUiApp:
    def __init__(self, root: tk.Tk, backend: BanxuebangUiBackend | None = None) -> None:
        self.root = root
        self.root.title("BXB Homework UI")
        self.root.geometry("1460x920")
        self.root.minsize(1220, 760)

        self.backend = backend or create_backend()
        self.ui_settings = load_ui_settings()
        self.agent = LlmConversationAgent(
            self.backend,
            max_turns=self.ui_settings.max_memory_turns,
            max_tool_rounds=self.ui_settings.max_tool_rounds,
        )
        self.session_data: dict[str, Any] = {}
        self.current_task_rows: list[dict[str, Any]] = []
        self.agent_messages: list[dict[str, str]] = []
        self.markdown_renderer = MarkdownIt("commonmark", {"html": False, "linkify": False}).enable(
            ["table", "strikethrough"],
        )

        self.status_var = tk.StringVar(value="Ready")
        self.term_var = tk.StringVar(value="")
        self.course_var = tk.StringVar(value="")
        self.task_scope_var = tk.StringVar(value="current")
        self.username_var = tk.StringVar(value="")
        self.password_var = tk.StringVar(value="")
        self.agent_input_var = tk.StringVar(value="")
        self.model_api_key_var = tk.StringVar(value="")
        self.model_base_url_var = tk.StringVar(value="")
        self.model_name_var = tk.StringVar(value="")
        self.model_context_length_var = tk.StringVar(value="")
        self.model_key_masked_var = tk.StringVar(value="")
        self.model_status_var = tk.StringVar(value="尚未配置模型。")
        self.max_tool_rounds_var = tk.StringVar(value=str(self.ui_settings.max_tool_rounds))
        self.max_memory_turns_var = tk.StringVar(value=str(self.ui_settings.max_memory_turns))
        self.theme_mode_var = tk.StringVar(value=self.ui_settings.theme_mode)
        self.settings_status_var = tk.StringVar(value="")
        self.repo_url_var = tk.StringVar(value="https://github.com/GRAY-XY/BXB_tools")
        self.agent_run_status_var = tk.StringVar(value="空闲")
        self.agent_elapsed_var = tk.StringVar(value="0.0s")
        self.agent_context_var = tk.StringVar(value="上下文 0 / 4800")
        self.draft_filter_var = tk.StringVar(value="pending_review")
        self.review_status_var = tk.StringVar(value="")

        self.pages: dict[str, ttk.Frame] = {}
        self.nav_buttons: dict[str, tk.Button] = {}
        self._agent_run_active = False
        self._agent_run_started_at = 0.0
        self._agent_progress_counter = 0
        self._agent_usage_is_current = False
        self.current_draft_id: str | None = None

        self._configure_theme()
        self._build_ui()
        self._load_model_config_into_form()
        self._load_ui_settings_into_form()
        self.refresh_session()

    def _configure_theme(self) -> None:
        theme_mode = getattr(self.ui_settings, "theme_mode", "light")
        theme_name = "darkly" if theme_mode == "dark" else "litera"
        root_style = getattr(self.root, "style", None)
        if root_style is not None:
            self.style = root_style
            self.style.theme_use(theme_name)
        elif hasattr(self, "style"):
            self.style.theme_use(theme_name)
        else:
            self.style = ttkb.Style(theme_name)
        self.palette = self._build_palette(theme_mode)
        self.root.configure(background=self.palette["app_bg"])
        self.root.option_add("*Font", "{Segoe UI} 10")

        self.style.configure("App.TFrame", background=self.palette["app_bg"])
        self.style.configure("Sidebar.TFrame", background=self.palette["sidebar"])
        self.style.configure("ContentShell.TFrame", background=self.palette["app_bg"])
        self.style.configure("Page.TFrame", background=self.palette["app_bg"])
        self.style.configure("Section.TFrame", background=self.palette["app_bg"])
        self.style.configure("PageHeader.TFrame", background=self.palette["app_bg"])
        self.style.configure("CardRow.TFrame", background=self.palette["app_bg"])
        self.style.configure("HeaderTitle.TLabel", background=self.palette["app_bg"], foreground=self.palette["text"], font=("Segoe UI Variable Display", 27))
        self.style.configure("HeaderSub.TLabel", background=self.palette["app_bg"], foreground=self.palette["muted"], font=("Segoe UI", 10))
        self.style.configure("BrandTitle.TLabel", background=self.palette["sidebar"], foreground=self.palette["sidebar_text"], font=("Segoe UI Variable Display", 19))
        self.style.configure("BrandSub.TLabel", background=self.palette["sidebar"], foreground=self.palette["sidebar_muted"], font=("Segoe UI", 9))
        self.style.configure("MetricLabel.TLabel", background=self.palette["surface_raised"], foreground=self.palette["muted"], font=("Segoe UI", 10))
        self.style.configure("MetricValue.TLabel", background=self.palette["surface_raised"], foreground=self.palette["text"], font=("Segoe UI Semibold", 14))
        self.style.configure("MetricBadge.TLabel", background=self.palette["accent_soft"], foreground=self.palette["accent"], font=("Segoe UI Semibold", 9), padding=(10, 5))
        self.style.configure("Subtle.TLabel", background=self.palette["surface_raised"], foreground=self.palette["muted"], font=("Segoe UI", 10))
        self.style.configure("StatusBar.TLabel", background=self.palette["app_bg"], foreground=self.palette["muted"], padding=(18, 10))
        self.style.configure("Card.TLabelframe", background=self.palette["surface_raised"], bordercolor=self.palette["border"], relief="solid", borderwidth=1)
        self.style.configure("Card.TLabelframe.Label", background=self.palette["app_bg"], foreground=self.palette["text"], font=("Segoe UI Semibold", 11))
        self.style.configure("Sidebar.TButton", background=self.palette["sidebar"], foreground=self.palette["sidebar_text"], padding=(18, 12), anchor="w", font=("Segoe UI", 10), borderwidth=0)
        self.style.map(
            "Sidebar.TButton",
            background=[("active", self.palette["sidebar_hover"])],
            foreground=[("active", self.palette["sidebar_text"])],
        )
        self.style.configure("SidebarActive.TButton", background=self.palette["sidebar_active"], foreground=self.palette["sidebar_text"], padding=(18, 12), anchor="w", font=("Segoe UI Semibold", 10), borderwidth=0)
        self.style.map(
            "SidebarActive.TButton",
            background=[("active", self.palette["sidebar_active"])],
            foreground=[("active", self.palette["sidebar_text"])],
        )
        self.style.configure("Accent.TButton", font=("Segoe UI Semibold", 10), padding=(16, 10))
        self.style.configure("Quick.TButton", font=("Segoe UI", 10), padding=(13, 9))
        self.style.configure("Ghost.TButton", font=("Segoe UI", 10), padding=(13, 9))
        self.style.configure("Modern.Treeview", rowheight=32, fieldbackground=self.palette["surface_raised"], background=self.palette["surface_raised"], foreground=self.palette["text"], bordercolor=self.palette["border"])
        self.style.configure("Modern.Treeview.Heading", font=("Segoe UI Semibold", 10))
        self.style.map("Modern.Treeview", background=[("selected", self.palette["accent_soft"])], foreground=[("selected", self.palette["text"])])
        self.style.configure("TEntry", padding=10)
        self.style.configure("TCombobox", padding=8)
        self.style.configure("TSpinbox", arrowsize=12)
        self.style.configure("Horizontal.TPanedwindow", background=self.palette["surface"])
        self.style.configure("Vertical.TPanedwindow", background=self.palette["surface"])

    def _build_palette(self, theme_mode: str) -> dict[str, str]:
        if theme_mode == "dark":
            return {
                "app_bg": "#202020",
                "surface": "#202020",
                "surface_alt": "#252525",
                "surface_raised": "#2b2b2b",
                "sidebar": "#1c1c1c",
                "sidebar_active": "#2d3f53",
                "sidebar_hover": "#292929",
                "sidebar_text": "#f3f3f3",
                "sidebar_muted": "#a7a7a7",
                "border": "#3a3a3a",
                "text": "#f3f3f3",
                "muted": "#b7b7b7",
                "accent": "#60cdff",
                "accent_soft": "#17384a",
                "success_soft": "#193a2a",
                "shadow": "#161616",
                "bubble_user": "#005fb8",
                "bubble_user_text": "#ffffff",
                "bubble_assistant": "#303030",
                "bubble_assistant_text": "#f3f3f3",
                "bubble_assistant_border": "#464646",
            }
        return {
            "app_bg": "#f3f3f3",
            "surface": "#f3f3f3",
            "surface_alt": "#fafafa",
            "surface_raised": "#ffffff",
            "sidebar": "#f7f7f7",
            "sidebar_active": "#e5f1fb",
            "sidebar_hover": "#eeeeee",
            "sidebar_text": "#1f1f1f",
            "sidebar_muted": "#6b6b6b",
            "border": "#e5e5e5",
            "text": "#1f1f1f",
            "muted": "#606060",
            "accent": "#0067c0",
            "accent_soft": "#e5f1fb",
            "success_soft": "#e8f5e9",
            "shadow": "#d9d9d9",
            "bubble_user": "#0067c0",
            "bubble_user_text": "#ffffff",
            "bubble_assistant": "#ffffff",
            "bubble_assistant_text": "#1f1f1f",
            "bubble_assistant_border": "#e5e5e5",
        }

    def _build_ui(self) -> None:
        main = ttk.Frame(self.root, style="App.TFrame")
        main.pack(fill="both", expand=True)

        self.sidebar = ttk.Frame(main, style="Sidebar.TFrame", width=278)
        self.sidebar.pack(side="left", fill="y")
        self.sidebar.pack_propagate(False)

        self.content_shell = ttk.Frame(main, style="ContentShell.TFrame", padding=(24, 22, 24, 14))
        self.content_shell.pack(side="left", fill="both", expand=True)

        self.content = ttk.Frame(self.content_shell, style="Page.TFrame")
        self.content.pack(side="left", fill="both", expand=True)

        self.status_bar = ttk.Label(
            self.root,
            textvariable=self.status_var,
            anchor="w",
            style="StatusBar.TLabel",
        )
        self.status_bar.pack(fill="x", side="bottom")

        brand = ttk.Frame(self.sidebar, style="Sidebar.TFrame", padding=(22, 24, 18, 18))
        brand.pack(fill="x")
        brand_row = ttk.Frame(brand, style="Sidebar.TFrame")
        brand_row.pack(fill="x")
        mark = tk.Label(
            brand_row,
            text="BXB",
            bg=self.palette["accent"],
            fg="#ffffff",
            font=("Segoe UI Semibold", 10),
            width=4,
            height=2,
        )
        mark.pack(side="left", padx=(0, 12))
        brand_text = ttk.Frame(brand_row, style="Sidebar.TFrame")
        brand_text.pack(side="left", fill="x", expand=True)
        ttk.Label(brand_text, text="BXB Homework", style="BrandTitle.TLabel").pack(anchor="w")
        ttk.Label(brand_text, text="Local agent workspace", style="BrandSub.TLabel").pack(anchor="w", pady=(1, 0))

        nav_items = [
            ("home", "主页"),
            ("agent", "助手"),
            ("review", "审核"),
            ("model", "模型"),
            ("settings", "设置"),
            ("homework", "作业"),
            ("schedule", "课表"),
            ("notices", "通知"),
        ]
        nav_group = ttk.Frame(self.sidebar, style="Sidebar.TFrame", padding=(12, 8, 12, 12))
        nav_group.pack(fill="x")
        for key, label in nav_items:
            button = ttk.Button(
                nav_group,
                text=f"  {label}",
                style="Sidebar.TButton",
                command=lambda page_key=key: self._show_page(page_key),
            )
            button.pack(fill="x", pady=(0, 5))
            self.nav_buttons[key] = button

        sidebar_footer = ttk.Frame(self.sidebar, style="Sidebar.TFrame", padding=(14, 14, 14, 16))
        sidebar_footer.pack(side="bottom", fill="x")
        footer_card = ttk.LabelFrame(sidebar_footer, text="Workspace", style="Card.TLabelframe", padding=14)
        footer_card.pack(fill="x")
        ttk.Label(footer_card, text="MCP + Direct Tools", style="MetricValue.TLabel").pack(anchor="w")

        self._build_home_page()
        self._build_agent_page()
        self._build_review_page()
        self._build_model_page()
        self._build_settings_page()
        self._build_homework_page()
        self._build_placeholder_page("schedule", "课表暂未接入。")
        self._build_placeholder_page("notices", "通知暂未接入。")

        self._show_page("home")

    def _build_home_page(self) -> None:
        page = ttk.Frame(self.content, style="Page.TFrame", padding=30)
        self.pages["home"] = page

        header = ttk.Frame(page, style="PageHeader.TFrame")
        header.pack(fill="x")

        ttk.Label(header, text="Banxuebang Homework UI", style="HeaderTitle.TLabel").pack(anchor="w")

        metrics = ttk.Frame(page, style="CardRow.TFrame")
        metrics.pack(fill="x", pady=(18, 16))
        for title, value in [
            ("Agent 模式", "LLM + Tools"),
            ("会话存储", ".banxuebang/session.json"),
            ("模型配置", ".bxb_model_config.json"),
        ]:
            card = ttk.LabelFrame(metrics, text=title, style="Card.TLabelframe", padding=16)
            card.pack(side="left", fill="x", expand=True, padx=(0, 12))
            ttk.Label(card, text="ACTIVE", style="MetricBadge.TLabel").pack(anchor="w", pady=(0, 10))
            ttk.Label(card, text=value, style="MetricValue.TLabel").pack(anchor="w")
        metrics.winfo_children()[-1].pack_configure(padx=(0, 0))

        container = ttk.Frame(page, style="Page.TFrame")
        container.pack(fill="both", expand=True)

        left = ttk.LabelFrame(container, text="登录", style="Card.TLabelframe", padding=22)
        left.pack(side="left", fill="y", padx=(0, 16))

        ttk.Label(left, text="账号").grid(row=0, column=0, sticky="w", pady=8)
        ttk.Entry(left, textvariable=self.username_var, width=32).grid(row=0, column=1, pady=8, padx=(12, 0))

        ttk.Label(left, text="密码").grid(row=1, column=0, sticky="w", pady=8)
        ttk.Entry(left, textvariable=self.password_var, show="*", width=32).grid(
            row=1, column=1, pady=8, padx=(12, 0)
        )

        ttk.Button(left, text="浏览器登录", command=self._login_in_browser, style="Accent.TButton").grid(
            row=2, column=0, columnspan=2, sticky="ew", pady=(16, 8)
        )
        ttk.Button(left, text="账号密码登录", command=self._login_with_credentials, style="Quick.TButton").grid(
            row=3, column=0, columnspan=2, sticky="ew", pady=8
        )
        ttk.Button(left, text="刷新当前会话", command=self.refresh_session, style="Quick.TButton").grid(
            row=4, column=0, columnspan=2, sticky="ew", pady=8
        )
        left.grid_columnconfigure(1, weight=1)

        right = ttk.LabelFrame(container, text="当前会话", style="Card.TLabelframe", padding=22)
        right.pack(side="left", fill="both", expand=True, padx=(18, 0))

        self.session_text = tk.Text(
            right,
            height=24,
            wrap="word",
            font=("Consolas", 10),
            bg=self.palette["surface_alt"],
            relief="solid",
            borderwidth=1,
            highlightthickness=0,
            insertbackground=self.palette["text"],
            fg=self.palette["text"],
            padx=12,
            pady=12,
        )
        self.session_text.pack(fill="both", expand=True)
        self._configure_text_widget(self.session_text)

    def _build_agent_page(self) -> None:
        page = ttk.Frame(self.content, style="Page.TFrame", padding=24)
        self.pages["agent"] = page

        ttk.Label(page, text="Agent Assistant", style="HeaderTitle.TLabel").pack(anchor="w")
        ttk.Label(page, text="", style="HeaderSub.TLabel").pack(anchor="w", pady=(0, 10))

        quick = ttk.LabelFrame(page, text="快捷动作", style="Card.TLabelframe", padding=12)
        quick.pack(fill="x", pady=(0, 10))
        ttk.Button(quick, text="列出课程", command=lambda: self._submit_agent_text("列出课程"), style="Quick.TButton").pack(side="left")
        ttk.Button(quick, text="列出当前课程作业", command=lambda: self._submit_agent_text("列出当前课程作业"), style="Quick.TButton").pack(
            side="left", padx=(8, 0)
        )
        ttk.Button(quick, text="列出未提交作业", command=lambda: self._submit_agent_text("列出未提交作业"), style="Quick.TButton").pack(
            side="left", padx=(8, 0)
        )
        ttk.Button(quick, text="查看当前课程GPA", command=lambda: self._submit_agent_text("查看当前课程GPA"), style="Quick.TButton").pack(
            side="left", padx=(8, 0)
        )
        ttk.Button(quick, text="新对话", command=self._reset_agent_conversation, style="Ghost.TButton").pack(side="right")

        runtime_bar = ttk.LabelFrame(page, text="运行状态", style="Card.TLabelframe", padding=12)
        runtime_bar.pack(fill="x", pady=(0, 10))
        ttk.Label(runtime_bar, text="当前动作:", style="Subtle.TLabel").pack(side="left")
        ttk.Label(runtime_bar, textvariable=self.agent_run_status_var, style="MetricValue.TLabel").pack(side="left", padx=(8, 18))
        ttk.Label(runtime_bar, text="耗时:", style="Subtle.TLabel").pack(side="left")
        ttk.Label(runtime_bar, textvariable=self.agent_elapsed_var, style="MetricValue.TLabel").pack(side="left", padx=(8, 0))
        ttk.Label(runtime_bar, text="上下文:", style="Subtle.TLabel").pack(side="left", padx=(24, 6))
        self.agent_context_progress = ttk.Progressbar(
            runtime_bar,
            orient="horizontal",
            mode="determinate",
            maximum=100,
            value=0,
            length=180,
            style="info.Horizontal.TProgressbar",
        )
        self.agent_context_progress.pack(side="left")
        ttk.Label(runtime_bar, textvariable=self.agent_context_var, style="Subtle.TLabel").pack(side="left", padx=(8, 0))
        self._update_agent_context_meter()

        split = ttk.PanedWindow(page, orient="horizontal", style="Horizontal.TPanedwindow")
        split.pack(fill="both", expand=True)

        left_frame = ttk.LabelFrame(split, text="对话", style="Card.TLabelframe", padding=14)
        progress_frame = ttk.LabelFrame(split, text="工作过程", style="Card.TLabelframe", padding=14)
        split.add(left_frame, weight=3)
        split.add(progress_frame, weight=2)
        left_frame.columnconfigure(0, weight=1)
        left_frame.rowconfigure(0, weight=1)
        left_frame.rowconfigure(1, weight=0)

        self.agent_chat_shell = tk.Frame(
            left_frame,
            bg=self.palette["shadow"],
            highlightthickness=0,
            bd=0,
        )
        self.agent_chat_shell.grid(row=0, column=0, sticky="nsew")
        self.agent_chat_region = tk.Frame(self.agent_chat_shell, bg=self.palette["surface_alt"])
        self.agent_chat_region.pack(fill="both", expand=True, padx=(0, 1), pady=(0, 1))
        self.agent_chat_html = HtmlFrame(
            self.agent_chat_region,
            messages_enabled=False,
            vertical_scrollbar=True,
            horizontal_scrollbar=True,
        )
        self.agent_chat_html.pack(fill="both", expand=True)
        self._render_agent_chat_html()

        timeline_meta = ttk.Frame(progress_frame, style="Page.TFrame")
        timeline_meta.pack(fill="x", pady=(0, 10))
        ttk.Label(timeline_meta, text="实时步骤", style="MetricValue.TLabel").pack(side="left")
        ttk.Label(
            timeline_meta,
            text="展开每一步可以看工具调用细节",
            style="Subtle.TLabel",
        ).pack(side="left", padx=(10, 0))

        self.agent_timeline_shell = tk.Frame(
            progress_frame,
            bg=self.palette["shadow"],
            highlightthickness=0,
            bd=0,
        )
        self.agent_timeline_shell.pack(fill="both", expand=True)
        self.agent_timeline_region = tk.Frame(self.agent_timeline_shell, bg=self.palette["surface_alt"])
        self.agent_timeline_region.pack(fill="both", expand=True, padx=(0, 1), pady=(0, 1))
        self.agent_timeline_canvas, self.agent_timeline_feed = self._build_scrollable_region(
            self.agent_timeline_region,
            background=self.palette["surface_alt"],
            inner_background=self.palette["surface_alt"],
        )

        composer = ttk.Frame(left_frame, style="Page.TFrame")
        composer.grid(row=1, column=0, sticky="ew", pady=(10, 0))
        composer.columnconfigure(0, weight=1)
        entry = ttk.Entry(composer, textvariable=self.agent_input_var)
        entry.grid(row=0, column=0, sticky="ew")
        entry.bind("<Return>", lambda _event: self._on_agent_submit())
        ttk.Button(composer, text="发送", command=self._on_agent_submit, style="Accent.TButton").grid(row=0, column=1, padx=(10, 0))

    def _build_model_page(self) -> None:
        page = ttk.Frame(self.content, style="Page.TFrame", padding=24)
        self.pages["model"] = page

        ttk.Label(page, text="模型配置", style="HeaderTitle.TLabel").pack(anchor="w")
        ttk.Label(page, text="", style="HeaderSub.TLabel").pack(anchor="w", pady=(0, 10))

        form = ttk.LabelFrame(page, text="OpenAI 兼容配置", style="Card.TLabelframe", padding=18)
        form.pack(fill="x")

        ttk.Label(form, text="API Key").grid(row=0, column=0, sticky="w", pady=8)
        ttk.Entry(form, textvariable=self.model_api_key_var, show="*", width=58).grid(
            row=0, column=1, sticky="ew", pady=8, padx=(10, 0)
        )

        ttk.Label(form, text="调用链接").grid(row=1, column=0, sticky="w", pady=8)
        ttk.Entry(form, textvariable=self.model_base_url_var, width=58).grid(
            row=1, column=1, sticky="ew", pady=8, padx=(10, 0)
        )

        ttk.Label(form, text="模型名称").grid(row=2, column=0, sticky="w", pady=8)
        ttk.Entry(form, textvariable=self.model_name_var, width=58).grid(
            row=2, column=1, sticky="ew", pady=8, padx=(10, 0)
        )
        ttk.Label(form, text="上下文长度").grid(row=3, column=0, sticky="w", pady=8)
        ttk.Entry(form, textvariable=self.model_context_length_var, width=58).grid(
            row=3, column=1, sticky="ew", pady=8, padx=(10, 0)
        )

        form.columnconfigure(1, weight=1)

        actions = ttk.Frame(page, style="Page.TFrame")
        actions.pack(fill="x", pady=(12, 10))
        ttk.Button(actions, text="重新加载本地配置", command=self._load_model_config_into_form, style="Quick.TButton").pack(side="left")
        ttk.Button(actions, text="保存配置", command=self._save_model_config, style="Accent.TButton").pack(side="left", padx=(8, 0))
        ttk.Button(actions, text="清除配置", command=self._clear_model_config, style="Ghost.TButton").pack(side="left", padx=(8, 0))
        ttk.Button(actions, text="测试连通性", command=self._test_model_connectivity, style="Quick.TButton").pack(side="left", padx=(8, 0))

        status_box = ttk.LabelFrame(page, text="状态", style="Card.TLabelframe", padding=16)
        status_box.pack(fill="x")
        ttk.Label(status_box, textvariable=self.model_status_var, wraplength=820, justify="left").pack(anchor="w")
        ttk.Label(status_box, textvariable=self.model_key_masked_var, style="Subtle.TLabel").pack(anchor="w", pady=(8, 0))

        result_box = ttk.LabelFrame(page, text="测试结果", style="Card.TLabelframe", padding=12)
        result_box.pack(fill="both", expand=True, pady=(12, 0))
        self.model_result_text = tk.Text(
            result_box,
            wrap="word",
            font=("Consolas", 10),
            bg=self.palette["surface_alt"],
            relief="solid",
            borderwidth=1,
            padx=12,
            pady=12,
            insertbackground=self.palette["text"],
            fg=self.palette["text"],
        )
        self.model_result_text.pack(fill="both", expand=True)
        self._configure_text_widget(self.model_result_text)

    def _build_review_page(self) -> None:
        page = ttk.Frame(self.content, style="Page.TFrame", padding=24)
        self.pages["review"] = page

        ttk.Label(page, text="草稿审核", style="HeaderTitle.TLabel").pack(anchor="w")
        ttk.Label(page, text="", style="HeaderSub.TLabel").pack(anchor="w", pady=(0, 10))

        toolbar = ttk.LabelFrame(page, text="筛选与动作", style="Card.TLabelframe", padding=14)
        toolbar.pack(fill="x", pady=(0, 10))
        ttk.Label(toolbar, text="状态").pack(side="left")
        ttk.Combobox(
            toolbar,
            textvariable=self.draft_filter_var,
            state="readonly",
            width=16,
            values=["pending_review", "approved", "rejected", "submitted", "all"],
        ).pack(side="left", padx=(8, 12))
        ttk.Button(toolbar, text="刷新草稿", command=self.load_submission_drafts, style="Accent.TButton").pack(side="left")
        ttk.Label(toolbar, textvariable=self.review_status_var, style="Subtle.TLabel").pack(side="left", padx=(12, 0))

        split = ttk.PanedWindow(page, orient="horizontal", style="Horizontal.TPanedwindow")
        split.pack(fill="both", expand=True)

        left = ttk.LabelFrame(split, text="草稿列表", style="Card.TLabelframe", padding=12)
        right = ttk.LabelFrame(split, text="草稿详情", style="Card.TLabelframe", padding=12)
        split.add(left, weight=2)
        split.add(right, weight=3)

        columns = ("status", "subject", "title", "updated")
        self.draft_tree = ttk.Treeview(left, columns=columns, show="tree headings", height=18, style="Modern.Treeview")
        self.draft_tree.heading("#0", text="Draft ID")
        self.draft_tree.heading("status", text="状态")
        self.draft_tree.heading("subject", text="课程")
        self.draft_tree.heading("title", text="任务")
        self.draft_tree.heading("updated", text="更新时间")
        self.draft_tree.column("#0", width=210)
        self.draft_tree.column("status", width=120, anchor="center")
        self.draft_tree.column("subject", width=140)
        self.draft_tree.column("title", width=240)
        self.draft_tree.column("updated", width=160)
        self.draft_tree.pack(side="left", fill="both", expand=True)
        self.draft_tree.bind("<<TreeviewSelect>>", self._on_draft_selected)

        draft_scroll = ttk.Scrollbar(left, orient="vertical", command=self.draft_tree.yview)
        self.draft_tree.configure(yscrollcommand=draft_scroll.set)
        draft_scroll.pack(side="right", fill="y")

        detail_top = ttk.Frame(right, style="Page.TFrame")
        detail_top.pack(fill="both", expand=True)
        self.draft_detail_text = tk.Text(
            detail_top,
            wrap="word",
            font=("Consolas", 10),
            bg=self.palette["surface_alt"],
            relief="solid",
            borderwidth=1,
            padx=12,
            pady=12,
            insertbackground=self.palette["text"],
            fg=self.palette["text"],
        )
        self.draft_detail_text.pack(fill="both", expand=True)
        self._configure_text_widget(self.draft_detail_text)

        review_note_box = ttk.LabelFrame(right, text="审核备注", style="Card.TLabelframe", padding=10)
        review_note_box.pack(fill="x", pady=(10, 0))
        self.review_note_text = tk.Text(
            review_note_box,
            wrap="word",
            height=4,
            font=("Consolas", 10),
            bg=self.palette["surface_alt"],
            relief="solid",
            borderwidth=1,
            padx=10,
            pady=10,
            insertbackground=self.palette["text"],
            fg=self.palette["text"],
        )
        self.review_note_text.pack(fill="x", expand=False)
        self._configure_text_widget(self.review_note_text)

        actions = ttk.Frame(right, style="Page.TFrame")
        actions.pack(fill="x", pady=(10, 0))
        ttk.Button(actions, text="通过审核", command=self._approve_selected_draft, style="Accent.TButton").pack(side="left")
        ttk.Button(actions, text="驳回草稿", command=self._reject_selected_draft, style="Ghost.TButton").pack(side="left", padx=(8, 0))

    def _build_settings_page(self) -> None:
        page = ttk.Frame(self.content, style="Page.TFrame", padding=24)
        self.pages["settings"] = page

        ttk.Label(page, text="设置", style="HeaderTitle.TLabel").pack(anchor="w")
        ttk.Label(page, text="", style="HeaderSub.TLabel").pack(anchor="w", pady=(0, 10))

        panel = ttk.LabelFrame(page, text="助手设置", style="Card.TLabelframe", padding=18)
        panel.pack(fill="x")

        ttk.Label(panel, text="最大工具调用轮次").grid(row=0, column=0, sticky="w", pady=8)
        ttk.Spinbox(panel, from_=1, to=20, textvariable=self.max_tool_rounds_var, width=8).grid(
            row=0,
            column=1,
            sticky="w",
            pady=8,
            padx=(12, 0),
        )
        ttk.Label(
            panel,
            text="每次助手回复里，模型最多连续调用多少轮工具。范围 1-20。",
            style="Subtle.TLabel",
        ).grid(row=1, column=0, columnspan=2, sticky="w")

        ttk.Label(panel, text="记忆对话轮数").grid(row=2, column=0, sticky="w", pady=(14, 8))
        ttk.Spinbox(panel, from_=1, to=20, textvariable=self.max_memory_turns_var, width=8).grid(
            row=2,
            column=1,
            sticky="w",
            pady=(14, 8),
            padx=(12, 0),
        )
        ttk.Label(
            panel,
            text="助手保留最近多少轮用户/助手对话文本。范围 1-20。",
            style="Subtle.TLabel",
        ).grid(row=3, column=0, columnspan=2, sticky="w")

        ttk.Label(panel, text="主题模式").grid(row=4, column=0, sticky="w", pady=(14, 8))
        ttk.Combobox(
            panel,
            textvariable=self.theme_mode_var,
            state="readonly",
            width=12,
            values=["light", "dark"],
        ).grid(
            row=4,
            column=1,
            sticky="w",
            pady=(14, 8),
            padx=(12, 0),
        )

        actions = ttk.Frame(page, style="Page.TFrame")
        actions.pack(fill="x", pady=(12, 10))
        ttk.Button(actions, text="重新加载设置", command=self._load_ui_settings_into_form, style="Quick.TButton").pack(side="left")
        ttk.Button(actions, text="保存设置", command=self._save_ui_settings, style="Accent.TButton").pack(side="left", padx=(8, 0))

        status_box = ttk.LabelFrame(page, text="状态", style="Card.TLabelframe", padding=16)
        status_box.pack(fill="x")
        ttk.Label(status_box, textvariable=self.settings_status_var, wraplength=820, justify="left").pack(anchor="w")

        repo_box = ttk.LabelFrame(page, text="项目仓库", style="Card.TLabelframe", padding=16)
        repo_box.pack(fill="x", pady=(12, 0))
        ttk.Entry(repo_box, textvariable=self.repo_url_var, state="readonly").pack(side="left", fill="x", expand=True)
        ttk.Button(repo_box, text="打开", command=self._open_repo_url, style="Quick.TButton").pack(side="left", padx=(10, 0))

        result_box = ttk.LabelFrame(page, text="当前设置", style="Card.TLabelframe", padding=12)
        result_box.pack(fill="both", expand=True, pady=(12, 0))
        self.settings_result_text = tk.Text(
            result_box,
            wrap="word",
            font=("Consolas", 10),
            bg=self.palette["surface_alt"],
            relief="solid",
            borderwidth=1,
            padx=12,
            pady=12,
            insertbackground=self.palette["text"],
            fg=self.palette["text"],
        )
        self.settings_result_text.pack(fill="both", expand=True)
        self._configure_text_widget(self.settings_result_text)

    def _build_homework_page(self) -> None:
        page = ttk.Frame(self.content, style="Page.TFrame", padding=24)
        self.pages["homework"] = page

        ttk.Label(page, text="作业中心", style="HeaderTitle.TLabel").pack(anchor="w")
        ttk.Label(page, text="", style="HeaderSub.TLabel").pack(anchor="w", pady=(0, 10))

        toolbar = ttk.LabelFrame(page, text="筛选与动作", style="Card.TLabelframe", padding=14)
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

        ttk.Button(toolbar, text="刷新作业", command=self.load_homework, style="Accent.TButton").pack(side="left")
        ttk.Button(toolbar, text="当前课程 GPA", command=self.load_gpa, style="Quick.TButton").pack(side="left", padx=(8, 0))

        split = ttk.PanedWindow(page, orient="horizontal", style="Horizontal.TPanedwindow")
        split.pack(fill="both", expand=True)

        left = ttk.LabelFrame(split, text="任务列表", style="Card.TLabelframe", padding=12)
        right = ttk.LabelFrame(split, text="任务详情", style="Card.TLabelframe", padding=12)
        split.add(left, weight=3)
        split.add(right, weight=2)

        columns = ("task_id", "course", "name", "deadline", "score")
        self.homework_tree = ttk.Treeview(left, columns=columns, show="headings", height=22, style="Modern.Treeview")
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

        self.detail_text = tk.Text(
            right,
            wrap="word",
            font=("Consolas", 10),
            bg=self.palette["surface_alt"],
            relief="solid",
            borderwidth=1,
            padx=12,
            pady=12,
            insertbackground=self.palette["text"],
            fg=self.palette["text"],
        )
        self.detail_text.pack(fill="both", expand=True)
        self._configure_text_widget(self.detail_text)

    def _build_placeholder_page(self, name: str, message: str) -> None:
        page = ttk.Frame(self.content, style="Page.TFrame", padding=32)
        self.pages[name] = page
        card = ttk.LabelFrame(page, text="暂未接入", style="Card.TLabelframe", padding=22)
        card.pack(anchor="center", expand=True, fill="x", padx=120, pady=80)
        ttk.Label(card, text=message, style="MetricValue.TLabel", wraplength=720, justify="center").pack(anchor="center", expand=True)

    def _show_page(self, name: str) -> None:
        for key, page in self.pages.items():
            page.pack_forget()
            self.nav_buttons[key].configure(style="Sidebar.TButton")

        self.pages[name].pack(fill="both", expand=True)
        self.nav_buttons[name].configure(style="SidebarActive.TButton")
        if name == "review" and hasattr(self, "draft_tree") and not self.draft_tree.get_children():
            self.load_submission_drafts()

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
        self.agent_run_status_var.set("执行失败")
        messagebox.showerror("错误", str(error))

    def _set_status(self, text: str) -> None:
        self.status_var.set(text)
        self.root.update_idletasks()

    def _write_json(self, widget: tk.Text, payload: Any) -> None:
        widget.delete("1.0", "end")
        widget.insert("1.0", json.dumps(payload, ensure_ascii=False, indent=2))

    def _load_model_config_into_form(self) -> None:
        config = load_model_config()
        self.model_api_key_var.set(config.api_key)
        self.model_base_url_var.set(config.base_url)
        self.model_name_var.set(config.model_name)
        self.model_context_length_var.set(str(config.context_length) if config.context_length else "")
        self.model_key_masked_var.set(f"当前本地密钥摘要: {masked_key(config.api_key) or '(未设置)'}")
        path = config_path()
        self.model_status_var.set(f"已从 {path} 读取模型配置。")
        self.model_result_text.delete("1.0", "end") if hasattr(self, "model_result_text") else None

    def _current_model_config(self) -> ModelConfig:
        return ModelConfig(
            api_key=self.model_api_key_var.get().strip(),
            base_url=self.model_base_url_var.get().strip(),
            model_name=self.model_name_var.get().strip(),
            context_length=self._safe_positive_int(self.model_context_length_var.get()),
        )

    def _save_model_config(self) -> None:
        config = self._current_model_config()
        path = save_model_config(config)
        self.model_key_masked_var.set(f"当前本地密钥摘要: {masked_key(config.api_key) or '(未设置)'}")
        self.model_status_var.set(f"模型配置已保存到 {path}")
        self._write_json(
            self.model_result_text,
            {
                "saved": True,
                "config_path": str(path),
                "base_url": config.base_url,
                "model_name": config.model_name,
                "context_length": config.context_length,
                "api_key_masked": masked_key(config.api_key),
            },
        )
        self._update_agent_context_meter()

    def _clear_model_config(self) -> None:
        path = clear_model_config()
        self.model_api_key_var.set("")
        self.model_base_url_var.set("")
        self.model_name_var.set("")
        self.model_context_length_var.set("")
        self.model_key_masked_var.set("当前本地密钥摘要: (未设置)")
        self.model_status_var.set(f"模型配置已清除，本地文件位置: {path}")
        self.model_result_text.delete("1.0", "end")
        self._set_status("模型配置已清除")

    def _test_model_connectivity(self) -> None:
        config = self._current_model_config()
        self._run_async(
            "正在测试模型连通性...",
            lambda: test_model_connection(config),
            self._on_model_test_finished,
        )

    def _on_model_test_finished(self, result: dict[str, Any]) -> None:
        self._write_json(self.model_result_text, result)
        context_length = self._safe_positive_int(result.get("context_length"))
        if context_length:
            self.model_context_length_var.set(str(context_length))
            config = self._current_model_config()
            save_model_config(config)
        self.model_status_var.set(result.get("message", "模型连通性测试完成。"))
        self._set_status(result.get("message", "模型连通性测试完成。"))
        self._update_agent_context_meter()

    def _load_ui_settings_into_form(self) -> None:
        self.ui_settings = load_ui_settings()
        self.max_tool_rounds_var.set(str(self.ui_settings.max_tool_rounds))
        self.max_memory_turns_var.set(str(self.ui_settings.max_memory_turns))
        self.theme_mode_var.set(self.ui_settings.theme_mode)
        self.agent.update_limits(
            max_tool_rounds=self.ui_settings.max_tool_rounds,
            max_turns=self.ui_settings.max_memory_turns,
        )
        self._update_agent_context_meter()
        path = settings_path()
        self.settings_status_var.set(f"已从 {path} 读取设置。")
        if hasattr(self, "settings_result_text"):
            self._write_json(self.settings_result_text, settings_as_dict(self.ui_settings))

    def _save_ui_settings(self) -> None:
        try:
            max_tool_rounds = int(self.max_tool_rounds_var.get().strip())
            max_memory_turns = int(self.max_memory_turns_var.get().strip())
        except ValueError:
            messagebox.showwarning("提示", "设置项必须是整数。")
            return

        theme_mode = (self.theme_mode_var.get().strip().lower() or "light")
        if theme_mode not in {"light", "dark"}:
            messagebox.showwarning("提示", "主题模式只能是 light 或 dark。")
            return

        previous_theme_mode = self.ui_settings.theme_mode

        self.ui_settings = UiSettings(
            max_tool_rounds=max_tool_rounds,
            max_memory_turns=max_memory_turns,
            theme_mode=theme_mode,
        )
        path = save_ui_settings(self.ui_settings)
        self.agent.update_limits(
            max_tool_rounds=self.ui_settings.max_tool_rounds,
            max_turns=self.ui_settings.max_memory_turns,
        )
        self.max_tool_rounds_var.set(str(self.ui_settings.max_tool_rounds))
        self.max_memory_turns_var.set(str(self.ui_settings.max_memory_turns))
        self.theme_mode_var.set(self.ui_settings.theme_mode)
        self._update_agent_context_meter()
        self.settings_status_var.set(f"设置已保存到 {path}")
        self._write_json(self.settings_result_text, settings_as_dict(self.ui_settings))
        self._set_status("设置已保存")
        if self.ui_settings.theme_mode != previous_theme_mode:
            self._rebuild_ui_for_theme()

    def _rebuild_ui_for_theme(self) -> None:
        current_session = self.session_data
        for child in list(self.root.winfo_children()):
            child.destroy()
        self.pages = {}
        self.nav_buttons = {}
        self._configure_theme()
        self._build_ui()
        self._load_model_config_into_form()
        self._load_ui_settings_into_form()
        if current_session:
            self._on_session_loaded(current_session)

    def _open_repo_url(self) -> None:
        webbrowser.open(self.repo_url_var.get().strip())

    def refresh_session(self) -> None:
        self._run_async(
            "正在读取当前会话...",
            self.backend.session_status,
            self._on_session_loaded,
        )

    def _on_session_loaded(self, session: dict[str, Any]) -> None:
        self.session_data = session or {}
        self.agent.sync_from_session(self.session_data)
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
            self.agent.sync_from_session(session)
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

    def load_submission_drafts(self, *, focus_draft_id: str | None = None) -> None:
        status = self.draft_filter_var.get().strip()
        if status == "all":
            status = None
        self._run_async(
            "正在读取草稿列表...",
            lambda: self.backend.list_submission_drafts(status=status),
            lambda result: self._display_submission_drafts(result, focus_draft_id=focus_draft_id),
        )

    def _display_submission_drafts(
        self,
        result: dict[str, Any],
        *,
        focus_draft_id: str | None = None,
    ) -> None:
        drafts = result.get("drafts", []) or []
        for item in self.draft_tree.get_children():
            self.draft_tree.delete(item)

        for draft in drafts:
            draft_id = str(draft.get("draftId") or "")
            self.draft_tree.insert(
                "",
                "end",
                iid=draft_id,
                text=draft_id,
                values=(
                    draft.get("status", ""),
                    draft.get("subjectName", ""),
                    draft.get("taskTitle", ""),
                    draft.get("updatedAt", ""),
                ),
            )

        self.review_status_var.set(f"当前共 {len(drafts)} 条草稿")
        self._set_status(f"已加载 {len(drafts)} 条草稿")

        target_id = focus_draft_id or (drafts[0].get("draftId") if drafts else None)
        if target_id and str(target_id) in self.draft_tree.get_children():
            self.draft_tree.selection_set(str(target_id))
            self.draft_tree.see(str(target_id))
            self._load_selected_draft_detail(str(target_id))
        else:
            self.current_draft_id = None
            if hasattr(self, "draft_detail_text"):
                self.draft_detail_text.delete("1.0", "end")

    def _on_draft_selected(self, _event: tk.Event[Any]) -> None:
        selection = self.draft_tree.selection()
        if not selection:
            return
        self._load_selected_draft_detail(selection[0])

    def _load_selected_draft_detail(self, draft_id: str) -> None:
        self.current_draft_id = draft_id
        self._run_async(
            "正在读取草稿详情...",
            lambda: self.backend.get_submission_draft(draft_id),
            self._display_submission_draft_detail,
        )

    def _display_submission_draft_detail(self, result: dict[str, Any]) -> None:
        draft = (result or {}).get("draft") or {}
        self.current_draft_id = str(draft.get("draftId") or self.current_draft_id or "")
        lines = [
            f"Draft ID: {draft.get('draftId', '')}",
            f"状态: {draft.get('status', '')}",
            f"课程: {draft.get('subjectName', '')}",
            f"任务: {draft.get('taskTitle', '')}",
            f"Task ID: {draft.get('taskId', '')}",
            f"创建时间: {draft.get('createdAt', '')}",
            f"更新时间: {draft.get('updatedAt', '')}",
            f"审核时间: {draft.get('reviewedAt', '') or '(未审核)'}",
            "",
            "摘要:",
            draft.get("summary") or "(无摘要)",
            "",
            "草稿正文:",
            draft.get("draftText") or "(无正文)",
            "",
            "警告:",
        ]
        warnings = draft.get("warnings") or []
        lines.extend([f"- {item}" for item in warnings] or ["(无)"])
        lines.extend(["", "缺失信息:"])
        missing_info = draft.get("missingInfo") or []
        lines.extend([f"- {item}" for item in missing_info] or ["(无)"])
        lines.extend(["", "证据:"])
        evidence = draft.get("evidence") or []
        if evidence:
            for item in evidence:
                lines.append(json.dumps(item, ensure_ascii=False))
        else:
            lines.append("(无)")
        lines.extend(["", "审核备注:", draft.get("reviewNote") or "(无)"])

        self.draft_detail_text.delete("1.0", "end")
        self.draft_detail_text.insert("1.0", "\n".join(lines))
        self.review_note_text.delete("1.0", "end")
        self.review_note_text.insert("1.0", draft.get("reviewNote") or "")
        self.review_status_var.set(f"当前草稿：{draft.get('draftId', '')}")
        self._set_status("草稿详情已更新")

    def _review_note_value(self) -> str:
        return self.review_note_text.get("1.0", "end").strip()

    def _approve_selected_draft(self) -> None:
        if not self.current_draft_id:
            messagebox.showwarning("提示", "先选择一条草稿。")
            return
        draft_id = self.current_draft_id
        review_note = self._review_note_value()
        self._run_async(
            "正在通过草稿审核...",
            lambda: self.backend.approve_submission_draft(draft_id, review_note=review_note),
            lambda result: self._on_draft_review_updated(result, "已通过审核"),
        )

    def _reject_selected_draft(self) -> None:
        if not self.current_draft_id:
            messagebox.showwarning("提示", "先选择一条草稿。")
            return
        draft_id = self.current_draft_id
        review_note = self._review_note_value()
        self._run_async(
            "正在驳回草稿...",
            lambda: self.backend.reject_submission_draft(draft_id, review_note=review_note),
            lambda result: self._on_draft_review_updated(result, "已驳回草稿"),
        )

    def _on_draft_review_updated(self, result: dict[str, Any], status_text: str) -> None:
        draft = result.get("draft") or {}
        draft_id = str(draft.get("draftId") or self.current_draft_id or "")
        self.review_status_var.set(status_text)
        self._set_status(status_text)
        self.load_submission_drafts(focus_draft_id=draft_id)

    def _on_agent_submit(self) -> None:
        text = self.agent_input_var.get().strip()
        if not text:
            return
        self.agent_input_var.set("")
        self._submit_agent_text(text)

    def _submit_agent_text(self, text: str) -> None:
        self._agent_usage_is_current = False
        self._append_agent_message("user", text)
        self._start_agent_run()

        def runner() -> None:
            try:
                result = self.agent.handle(text, progress_callback=self._enqueue_agent_progress)
                self.root.after(0, lambda: self._apply_agent_reply(result))
            except Exception as error:  # noqa: BLE001
                self.root.after(0, lambda err=error: self._handle_error(err))
            finally:
                self.root.after(0, self._finish_agent_run)

        threading.Thread(target=runner, daemon=True).start()

    def _reset_agent_conversation(self) -> None:
        if self._agent_run_active:
            messagebox.showwarning("提示", "助手正在执行，完成后再开始新对话。")
            return

        self.agent_messages.clear()
        self._agent_usage_is_current = False
        if hasattr(self.agent, "reset_conversation"):
            self.agent.reset_conversation()
        if hasattr(self, "agent_timeline_feed"):
            for child in self.agent_timeline_feed.winfo_children():
                child.destroy()
        self.agent_run_status_var.set("空闲")
        self.agent_elapsed_var.set("0.0s")
        self._render_agent_chat_html()
        self._update_agent_context_meter()
        self._set_status("已开始新对话")

    def _append_agent_message(self, role: str, text: str) -> None:
        self.agent_messages.append({"role": role, "text": text or ""})
        self._render_agent_chat_html()
        self._update_agent_context_meter()
        self._scroll_chat_to_bottom()

    def _apply_agent_reply(self, reply: AgentReply) -> None:
        self._agent_usage_is_current = bool(getattr(self.agent, "last_usage", {}).get("prompt_tokens"))
        self._append_agent_message("assistant", reply.message)
        if reply.session is not None:
            self._on_session_loaded(reply.session)
        if reply.task_rows is not None:
            self._display_homework_rows(reply.task_rows)
        if reply.task_detail is not None:
            self._display_task_detail(reply.task_detail)
        if reply.gpa_result is not None:
            self._display_gpa(reply.gpa_result)
        if reply.draft_list is not None:
            self._display_submission_drafts(reply.draft_list)
        if reply.draft_detail is not None and isinstance(reply.draft_detail, dict) and reply.draft_detail.get("draft"):
            self._show_page("review")
            self._display_submission_draft_detail(reply.draft_detail)
        if reply.draft_result is not None:
            draft_id = (reply.draft_result.get("draft") or {}).get("draftId") or reply.draft_result.get("draftId")
            self._show_page("review")
            self.load_submission_drafts(focus_draft_id=str(draft_id) if draft_id else None)
        self._set_status(reply.message.splitlines()[0])
        self._update_agent_context_meter()

    def _start_agent_run(self) -> None:
        self._agent_run_active = True
        self._agent_run_started_at = time.monotonic()
        self._agent_progress_counter = 0
        self.agent_run_status_var.set("准备执行")
        self.agent_elapsed_var.set("0.0s")
        for child in self.agent_timeline_feed.winfo_children():
            child.destroy()
        self._tick_agent_elapsed()

    def _finish_agent_run(self) -> None:
        if not self._agent_run_active:
            return
        self._agent_run_active = False
        elapsed = time.monotonic() - self._agent_run_started_at
        self.agent_elapsed_var.set(f"{elapsed:.1f}s")
        current = self.agent_run_status_var.get().strip() or "已完成"
        if current not in {"执行失败"}:
            self.agent_run_status_var.set("已完成")

    def _tick_agent_elapsed(self) -> None:
        if not self._agent_run_active:
            return
        elapsed = time.monotonic() - self._agent_run_started_at
        self.agent_elapsed_var.set(f"{elapsed:.1f}s")
        self.root.after(200, self._tick_agent_elapsed)

    def _enqueue_agent_progress(self, event: AgentProgressEvent) -> None:
        self.root.after(0, lambda ev=event: self._on_agent_progress(ev))

    def _on_agent_progress(self, event: AgentProgressEvent) -> None:
        self.agent_run_status_var.set(event.summary)
        elapsed = time.monotonic() - self._agent_run_started_at if self._agent_run_started_at else 0.0
        self._agent_progress_counter += 1
        self._append_timeline_event(event, elapsed)
        self._scroll_timeline_to_bottom()

    def _build_scrollable_region(
        self,
        parent: tk.Widget,
        *,
        background: str,
        inner_background: str,
    ) -> tuple[tk.Canvas, tk.Frame]:
        outer = tk.Frame(parent, bg=background, highlightthickness=0, bd=0)
        outer.pack(fill="both", expand=True)

        canvas = tk.Canvas(
            outer,
            bg=background,
            highlightthickness=0,
            bd=0,
            relief="flat",
        )
        scrollbar = ttk.Scrollbar(outer, orient="vertical", command=canvas.yview)
        canvas.configure(yscrollcommand=scrollbar.set)
        canvas.pack(side="left", fill="both", expand=True)
        scrollbar.pack(side="right", fill="y")

        inner = tk.Frame(canvas, bg=inner_background, highlightthickness=0, bd=0)
        window_id = canvas.create_window((0, 0), window=inner, anchor="nw")

        def sync_scrollregion(_event: tk.Event[Any]) -> None:
            canvas.configure(scrollregion=canvas.bbox("all"))

        def sync_width(event: tk.Event[Any]) -> None:
            canvas.itemconfigure(window_id, width=event.width)

        inner.bind("<Configure>", sync_scrollregion)
        canvas.bind("<Configure>", sync_width)
        return canvas, inner

    def _scroll_chat_to_bottom(self) -> None:
        self.root.update_idletasks()
        if hasattr(self, "agent_chat_html"):
            self.root.after_idle(lambda: self.agent_chat_html.yview_moveto(1.0))

    def _scroll_timeline_to_bottom(self) -> None:
        self.root.update_idletasks()
        self.root.after_idle(lambda: self.agent_timeline_canvas.yview_moveto(1.0))

    def _render_agent_chat_html(self) -> None:
        if not hasattr(self, "agent_chat_html"):
            return

        document = self._build_agent_chat_document()
        self.agent_chat_html.load_html(document, base_url=None)

    def _update_agent_context_meter(self) -> None:
        max_tokens = self._agent_context_budget_tokens()
        used_tokens = self._estimate_agent_context_tokens()
        percent = min(100, int((used_tokens / max_tokens) * 100)) if max_tokens else 0
        self.agent_context_var.set(f"上下文 {used_tokens} / {max_tokens}")
        if hasattr(self, "agent_context_progress"):
            self.agent_context_progress.configure(value=percent)

    def _agent_context_budget_tokens(self) -> int:
        model_limit = self._safe_positive_int(self.model_context_length_var.get())
        if model_limit:
            return model_limit
        known_limit = known_context_length(self.model_name_var.get())
        if known_limit:
            return known_limit
        turns = max(1, int(getattr(self.ui_settings, "max_memory_turns", 6)))
        return turns * 800

    def _estimate_agent_context_tokens(self) -> int:
        prompt_tokens = (
            self._safe_positive_int(getattr(self.agent, "last_usage", {}).get("prompt_tokens"))
            if self._agent_usage_is_current
            else 0
        )
        if prompt_tokens:
            return max(prompt_tokens, self._estimated_memory_tokens())
        return self._estimated_memory_tokens()

    def _estimated_memory_tokens(self) -> int:
        remembered_turns = list(self.agent.recent_turns()) if hasattr(self.agent, "recent_turns") else []
        if remembered_turns:
            text = "\n".join(turn.text for turn in remembered_turns)
        else:
            max_messages = max(1, int(getattr(self.ui_settings, "max_memory_turns", 6))) * 2
            text = "\n".join(item.get("text", "") for item in self.agent_messages[-max_messages:])
        return max(0, (len(text) + 3) // 4)

    @staticmethod
    def _safe_positive_int(value: Any) -> int:
        try:
            parsed = int(value or 0)
        except (TypeError, ValueError):
            return 0
        return parsed if parsed > 0 else 0

    def _build_agent_chat_document(self) -> str:
        theme_mode = getattr(self.ui_settings, "theme_mode", "light")
        css = self._agent_chat_css(theme_mode)
        rows = []
        for message in self.agent_messages:
            role = message.get("role", "assistant")
            label = "你" if role == "user" else "助手"
            rendered = self._markdown_to_html(message.get("text", ""))
            rows.append(
                f'<div class="message-row {html.escape(role)}">'
                f'<div class="bubble {html.escape(role)}">'
                f'<div class="message-label">{html.escape(label)}</div>'
                f'<div class="message-body">{rendered}</div>'
                "</div>"
                '<div class="clear"></div>'
                "</div>",
            )

        body = "\n".join(rows) or '<div class="empty-chat"></div>'
        return (
            "<!doctype html>"
            "<html><head><meta charset=\"utf-8\">"
            f"<style>{css}</style>"
            "</head><body>"
            f"<main class=\"chat-feed\">{body}<div id=\"chat-bottom\"></div></main>"
            "</body></html>"
        )

    def _markdown_to_html(self, markdown_text: str) -> str:
        prepared = self._protect_ascii_tables(markdown_text or "")
        rendered = self.markdown_renderer.render(prepared)
        return re.sub(
            r"(<table\b.*?</table>)",
            r'<div class="md-scroll">\1</div>',
            rendered,
            flags=re.IGNORECASE | re.DOTALL,
        )

    def _protect_ascii_tables(self, markdown_text: str) -> str:
        lines = markdown_text.splitlines()
        output: list[str] = []
        index = 0
        while index < len(lines):
            if self._is_ascii_table_start(lines, index):
                table_lines: list[str] = []
                while index < len(lines):
                    stripped = lines[index].rstrip()
                    if not stripped:
                        break
                    if not (self._is_ascii_table_border(stripped) or self._is_markdown_table_row(stripped)):
                        break
                    table_lines.append(stripped)
                    index += 1
                output.append("```text")
                output.extend(table_lines)
                output.append("```")
                continue

            output.append(lines[index])
            index += 1
        return "\n".join(output)

    def _agent_chat_css(self, theme_mode: str) -> str:
        if theme_mode == "dark":
            return """
                html, body { margin: 0; padding: 0; background: #252525; color: #f3f3f3; font-family: "Segoe UI", "Microsoft YaHei", sans-serif; }
                .chat-feed { box-sizing: border-box; min-height: 100vh; padding: 18px 18px 28px; }
                .message-row { display: block; clear: both; margin: 0 0 16px; }
                .bubble { display: inline-block; width: auto; max-width: 82%; border-radius: 10px; padding: 12px 15px; line-height: 1.62; overflow-x: auto; }
                .bubble.user { float: right; background: #005fb8; color: #ffffff; }
                .bubble.assistant { float: left; background: #303030; color: #f3f3f3; border: 1px solid #464646; }
                .clear { clear: both; height: 0; overflow: hidden; }
                .message-label { font-size: 12px; font-weight: 700; margin-bottom: 8px; color: inherit; opacity: .78; }
                .user .message-label { text-align: right; }
                .message-body { font-size: 14px; max-width: 100%; overflow-x: auto; }
                p { margin: 0 0 10px; }
                p:last-child { margin-bottom: 0; }
                h1, h2, h3 { margin: 14px 0 10px; line-height: 1.25; }
                h1 { font-size: 22px; } h2 { font-size: 18px; } h3 { font-size: 16px; }
                ul, ol { margin: 8px 0 12px 24px; padding: 0; }
                blockquote { margin: 10px 0; padding: 8px 12px; border-left: 3px solid #60cdff; background: rgba(96, 205, 255, .08); color: #d6d6d6; }
                code { font-family: Consolas, "Cascadia Mono", monospace; background: rgba(255,255,255,.09); border-radius: 5px; padding: 2px 5px; }
                pre { margin: 12px 0; padding: 12px; overflow-x: auto; background: #202020; border: 1px solid #464646; border-radius: 8px; }
                pre code { background: transparent; padding: 0; white-space: pre; }
                .md-scroll { max-width: 100%; overflow-x: auto; }
                table { border-collapse: collapse; margin: 12px 0; width: auto; font-size: 13px; }
                th, td { border: 1px solid #464646; padding: 8px 10px; text-align: left; vertical-align: top; white-space: nowrap; }
                th { background: #383838; font-weight: 700; }
                tr:nth-child(even) td { background: rgba(255,255,255,.035); }
                a { color: #60cdff; }
            """
        return """
            html, body { margin: 0; padding: 0; background: #fafafa; color: #1f1f1f; font-family: "Segoe UI", "Microsoft YaHei", sans-serif; }
            .chat-feed { box-sizing: border-box; min-height: 100vh; padding: 18px 18px 28px; }
            .message-row { display: block; clear: both; margin: 0 0 16px; }
            .bubble { display: inline-block; width: auto; max-width: 82%; border-radius: 10px; padding: 12px 15px; line-height: 1.62; overflow-x: auto; }
            .bubble.user { float: right; background: #0067c0; color: #ffffff; }
            .bubble.assistant { float: left; background: #ffffff; color: #1f1f1f; border: 1px solid #e5e5e5; }
            .clear { clear: both; height: 0; overflow: hidden; }
            .message-label { font-size: 12px; font-weight: 700; margin-bottom: 8px; color: inherit; opacity: .72; }
            .user .message-label { text-align: right; }
            .message-body { font-size: 14px; max-width: 100%; overflow-x: auto; }
            p { margin: 0 0 10px; }
            p:last-child { margin-bottom: 0; }
            h1, h2, h3 { margin: 14px 0 10px; line-height: 1.25; }
            h1 { font-size: 22px; } h2 { font-size: 18px; } h3 { font-size: 16px; }
            ul, ol { margin: 8px 0 12px 24px; padding: 0; }
            blockquote { margin: 10px 0; padding: 8px 12px; border-left: 3px solid #0067c0; background: #f0f6fc; color: #4f4f4f; }
            code { font-family: Consolas, "Cascadia Mono", monospace; background: rgba(19,32,51,.08); border-radius: 5px; padding: 2px 5px; }
            pre { margin: 12px 0; padding: 12px; overflow-x: auto; background: #f6f6f6; border: 1px solid #e5e5e5; border-radius: 8px; }
            pre code { background: transparent; padding: 0; white-space: pre; }
            .md-scroll { max-width: 100%; overflow-x: auto; }
            table { border-collapse: collapse; margin: 12px 0; width: auto; font-size: 13px; }
            th, td { border: 1px solid #e5e5e5; padding: 8px 10px; text-align: left; vertical-align: top; white-space: nowrap; }
            th { background: #f3f3f3; font-weight: 700; }
            tr:nth-child(even) td { background: #fafafa; }
            a { color: #0067c0; }
        """

    def _create_chat_bubble(self, role: str, text: str) -> None:
        is_user = role == "user"
        row = tk.Frame(self.agent_chat_feed, bg=self.palette["surface_alt"], highlightthickness=0, bd=0)
        row.pack(fill="x", pady=(0, 14))

        anchor = "e" if is_user else "w"
        side_pad = (80, 0) if is_user else (0, 80)
        shadow = tk.Frame(row, bg=self.palette["shadow"], highlightthickness=0, bd=0)
        shadow.pack(anchor=anchor, padx=side_pad)

        bubble = tk.Frame(
            shadow,
            bg=self.palette["bubble_user"] if is_user else self.palette["bubble_assistant"],
            highlightbackground=self.palette["bubble_assistant_border"] if not is_user else self.palette["bubble_user"],
            highlightthickness=1 if not is_user else 0,
            bd=0,
            padx=16,
            pady=12,
        )
        bubble.pack(anchor=anchor, padx=(0, 1), pady=(0, 1))

        header = tk.Label(
            bubble,
            text="你" if is_user else "助手",
            bg=bubble["bg"],
            fg=self.palette["bubble_user_text"] if is_user else self.palette["muted"],
            font=("Segoe UI Semibold", 10),
            anchor="e" if is_user else "w",
            justify="right" if is_user else "left",
        )
        header.pack(fill="x", anchor="e" if is_user else "w", pady=(0, 8))

        message = tk.Text(
            bubble,
            wrap="word",
            width=68,
            height=2,
            font=("Consolas", 10),
            bg=bubble["bg"],
            relief="flat",
            borderwidth=0,
            highlightthickness=0,
            padx=0,
            pady=0,
            insertbackground=self.palette["text"],
            fg=self.palette["bubble_user_text"] if is_user else self.palette["bubble_assistant_text"],
        )
        message.pack(fill="both", expand=True)
        self._configure_markdown_tags(message, is_user=is_user)
        self._render_markdown_into_widget(message, text)
        self.root.update_idletasks()
        display_lines = message.count("1.0", "end-1c", "displaylines")
        lines = int(display_lines[0]) if display_lines else max(2, len((text or "").splitlines()))
        message.configure(height=max(2, min(lines, 18)), state="disabled", cursor="arrow")

    def _append_timeline_event(self, event: AgentProgressEvent, elapsed: float) -> None:
        card_host = tk.Frame(self.agent_timeline_feed, bg=self.palette["surface_alt"], highlightthickness=0, bd=0)
        card_host.pack(fill="x", pady=(0, 12))

        shadow = tk.Frame(card_host, bg=self.palette["shadow"], highlightthickness=0, bd=0)
        shadow.pack(fill="x", padx=(0, 2), pady=(0, 2))

        card = tk.Frame(
            shadow,
            bg=self.palette["surface_raised"],
            highlightbackground=self.palette["border"],
            highlightthickness=1,
            bd=0,
            padx=14,
            pady=12,
        )
        card.pack(fill="x")

        top = tk.Frame(card, bg=self.palette["surface_raised"])
        top.pack(fill="x")

        dot = tk.Canvas(top, width=14, height=14, bg=self.palette["surface_raised"], highlightthickness=0, bd=0)
        dot.create_oval(2, 2, 12, 12, fill=self.palette["accent"], outline="")
        dot.pack(side="left", pady=(3, 0))

        text_box = tk.Frame(top, bg=self.palette["surface_raised"])
        text_box.pack(side="left", fill="x", expand=True, padx=(10, 0))

        tk.Label(
            text_box,
            text=event.summary,
            bg=self.palette["surface_raised"],
            fg=self.palette["text"],
            font=("Segoe UI Semibold", 10),
            anchor="w",
            justify="left",
            wraplength=360,
        ).pack(anchor="w")
        tk.Label(
            text_box,
            text=f"{elapsed:.1f}s  ·  {event.kind}",
            bg=self.palette["surface_raised"],
            fg=self.palette["muted"],
            font=("Segoe UI", 9),
            anchor="w",
        ).pack(anchor="w", pady=(4, 0))

        if event.detail:
            detail_visible = tk.BooleanVar(value=False)
            detail_box = tk.Text(
                card,
                wrap="word",
                height=5,
                font=("Consolas", 9),
                bg=self.palette["surface"],
                fg=self.palette["text"],
                relief="flat",
                borderwidth=0,
                highlightbackground=self.palette["border"],
                highlightthickness=1,
                padx=10,
                pady=10,
            )
            detail_box.insert("1.0", event.detail)
            detail_box.configure(state="disabled", cursor="arrow")

            def toggle_detail() -> None:
                if detail_visible.get():
                    detail_box.pack_forget()
                    toggle_button.configure(text="展开详情")
                    detail_visible.set(False)
                else:
                    detail_box.pack(fill="x", pady=(10, 0))
                    toggle_button.configure(text="收起详情")
                    detail_visible.set(True)
                    self._scroll_timeline_to_bottom()

            toggle_button = ttk.Button(top, text="展开详情", command=toggle_detail, style="Ghost.TButton")
            toggle_button.pack(side="right")

    def _configure_text_widget(self, widget: tk.Text) -> None:
        widget.configure(
            highlightbackground=self.palette["border"],
            highlightcolor=self.palette["accent"],
            highlightthickness=1,
            selectbackground="#cfe0ff",
            selectforeground=self.palette["text"],
            bd=0,
        )

    def _configure_markdown_tags(self, widget: tk.Text, *, is_user: bool = False) -> None:
        foreground = self.palette["bubble_user_text"] if is_user else self.palette["bubble_assistant_text"]
        quote_fg = "#d7e7ff" if is_user else self.palette["muted"]
        code_bg = "#4f89ef" if is_user else self.palette["surface"]
        block_bg = "#4a84e6" if is_user else self.palette["surface"]
        table_fg = "#f4f8ff" if is_user else self.palette["bubble_assistant_text"]

        widget.tag_configure("md_h1", font=("Segoe UI", 18, "bold"), spacing1=8, spacing3=6, foreground=foreground)
        widget.tag_configure("md_h2", font=("Segoe UI", 15, "bold"), spacing1=6, spacing3=4, foreground=foreground)
        widget.tag_configure("md_h3", font=("Segoe UI", 13, "bold"), spacing1=4, spacing3=2, foreground=foreground)
        widget.tag_configure("md_bold", font=("Consolas", 10, "bold"), foreground=foreground)
        widget.tag_configure("md_code_inline", font=("Consolas", 10), background=code_bg, foreground=foreground)
        widget.tag_configure(
            "md_code_block",
            font=("Consolas", 10),
            background=block_bg,
            foreground=foreground,
            lmargin1=14,
            lmargin2=14,
            spacing1=4,
            spacing3=4,
        )
        widget.tag_configure("md_quote", foreground=quote_fg, lmargin1=18, lmargin2=18)
        widget.tag_configure("md_table", font=("Consolas", 10), foreground=table_fg)

    def _render_markdown_into_widget(self, widget: tk.Text, markdown_text: str) -> None:
        lines = (markdown_text or "").splitlines()
        in_code_block = False
        code_buffer: list[str] = []
        index = 0

        while index < len(lines):
            line = lines[index]
            stripped = line.rstrip("\n")
            fence = stripped.strip()
            if fence.startswith("```"):
                if in_code_block:
                    code_text = "\n".join(code_buffer).rstrip()
                    if code_text:
                        widget.insert("end", f"{code_text}\n", ("md_code_block",))
                    code_buffer = []
                    in_code_block = False
                else:
                    in_code_block = True
                index += 1
                continue

            if in_code_block:
                code_buffer.append(stripped)
                index += 1
                continue

            if not stripped.strip():
                widget.insert("end", "\n")
                index += 1
                continue

            if stripped.startswith("# "):
                widget.insert("end", stripped[2:].strip() + "\n", ("md_h1",))
                index += 1
                continue
            if stripped.startswith("## "):
                widget.insert("end", stripped[3:].strip() + "\n", ("md_h2",))
                index += 1
                continue
            if stripped.startswith("### "):
                widget.insert("end", stripped[4:].strip() + "\n", ("md_h3",))
                index += 1
                continue
            if stripped.startswith(">"):
                widget.insert("end", "│ ", ("md_quote",))
                self._insert_inline_markdown(widget, stripped[1:].strip(), base_tags=("md_quote",))
                widget.insert("end", "\n", ("md_quote",))
                index += 1
                continue
            if re.match(r"^\s*([-*])\s+", stripped):
                item_text = re.sub(r"^\s*([-*])\s+", "", stripped, count=1)
                widget.insert("end", "• ")
                self._insert_inline_markdown(widget, item_text)
                widget.insert("end", "\n")
                index += 1
                continue
            if re.match(r"^\s*\d+\.\s+", stripped):
                marker = re.match(r"^\s*(\d+\.)\s+", stripped)
                item_text = re.sub(r"^\s*\d+\.\s+", "", stripped, count=1)
                widget.insert("end", f"{marker.group(1)} ")
                self._insert_inline_markdown(widget, item_text)
                widget.insert("end", "\n")
                index += 1
                continue
            if self._is_ascii_table_start(lines, index):
                next_index = self._render_ascii_table(widget, lines, index)
                index = next_index
                continue
            if self._is_markdown_table_start(lines, index):
                next_index = self._render_markdown_table(widget, lines, index)
                index = next_index
                continue

            self._insert_inline_markdown(widget, stripped)
            widget.insert("end", "\n")
            index += 1

        if in_code_block and code_buffer:
            widget.insert("end", "\n".join(code_buffer) + "\n", ("md_code_block",))

    def _is_markdown_table_start(self, lines: list[str], index: int) -> bool:
        if index + 1 >= len(lines):
            return False
        return self._is_markdown_table_row(lines[index]) and self._is_markdown_table_separator(lines[index + 1])

    @staticmethod
    def _is_markdown_table_row(line: str) -> bool:
        stripped = line.strip()
        return stripped.startswith("|") and stripped.endswith("|") and stripped.count("|") >= 2

    @staticmethod
    def _is_ascii_table_border(line: str) -> bool:
        stripped = line.rstrip()
        return bool(stripped) and stripped.startswith("+") and stripped.endswith("+") and "-" in stripped

    def _is_ascii_table_start(self, lines: list[str], index: int) -> bool:
        if index + 1 >= len(lines):
            return False
        return self._is_ascii_table_border(lines[index]) and self._is_markdown_table_row(lines[index + 1])

    @staticmethod
    def _is_markdown_table_separator(line: str) -> bool:
        stripped = line.strip()
        if not (stripped.startswith("|") and stripped.endswith("|")):
            return False
        cells = [cell.strip() for cell in stripped.strip("|").split("|")]
        if not cells:
            return False
        return all(cell and re.fullmatch(r":?-{3,}:?", cell) for cell in cells)

    def _render_markdown_table(self, widget: tk.Text, lines: list[str], start_index: int) -> int:
        row_lines: list[str] = []
        index = start_index
        while index < len(lines) and self._is_markdown_table_row(lines[index]):
            row_lines.append(lines[index].strip())
            index += 1

        if len(row_lines) < 2 or not self._is_markdown_table_separator(row_lines[1]):
            widget.insert("end", lines[start_index] + "\n", ("md_table",))
            return start_index + 1

        raw_rows = [self._parse_markdown_table_row(line) for line in row_lines]
        header = raw_rows[0]
        body = raw_rows[2:]
        all_rows = [header] + body
        column_count = max(len(row) for row in all_rows) if all_rows else 0
        normalized_rows = [row + [""] * (column_count - len(row)) for row in all_rows]
        widths = [
            max(self._display_width(self._table_cell_plain(row[col])) for row in normalized_rows)
            for col in range(column_count)
        ]

        border = "+-" + "-+-".join("-" * width for width in widths) + "-+"
        widget.insert("end", border + "\n", ("md_table",))
        widget.insert("end", self._format_table_row(header, widths) + "\n", ("md_table",))
        widget.insert("end", border + "\n", ("md_table",))
        for row in body:
            padded_row = row + [""] * (column_count - len(row))
            widget.insert("end", self._format_table_row(padded_row, widths) + "\n", ("md_table",))
        widget.insert("end", border + "\n", ("md_table",))
        return index

    def _render_ascii_table(self, widget: tk.Text, lines: list[str], start_index: int) -> int:
        index = start_index
        while index < len(lines):
            stripped = lines[index].rstrip("\n")
            if not stripped.strip():
                break
            if not (self._is_ascii_table_border(stripped) or self._is_markdown_table_row(stripped)):
                break
            widget.insert("end", stripped + "\n", ("md_table",))
            index += 1
        return index

    @staticmethod
    def _parse_markdown_table_row(line: str) -> list[str]:
        return [cell.strip() for cell in line.strip().strip("|").split("|")]

    def _format_table_row(self, row: list[str], widths: list[int]) -> str:
        cells: list[str] = []
        for index, cell in enumerate(row):
            plain = self._table_cell_plain(cell)
            padding = widths[index] - self._display_width(plain)
            cells.append(f"{plain}{' ' * max(0, padding)}")
        return f"| {' | '.join(cells)} |"

    @staticmethod
    def _table_cell_plain(cell: str) -> str:
        value = cell.strip()
        value = re.sub(r"\*\*([^*]+)\*\*", r"\1", value)
        value = re.sub(r"`([^`]+)`", r"\1", value)
        return value

    @staticmethod
    def _display_width(text: str) -> int:
        width = 0
        for char in text:
            width += 2 if unicodedata.east_asian_width(char) in {"W", "F"} else 1
        return width

    def _insert_inline_markdown(self, widget: tk.Text, text: str, base_tags: tuple[str, ...] = ()) -> None:
        pattern = re.compile(r"(`[^`]+`|\*\*[^*]+\*\*)")
        last_index = 0

        for match in pattern.finditer(text):
            if match.start() > last_index:
                widget.insert("end", text[last_index:match.start()], base_tags)

            token = match.group(0)
            if token.startswith("**") and token.endswith("**"):
                widget.insert("end", token[2:-2], base_tags + ("md_bold",))
            elif token.startswith("`") and token.endswith("`"):
                widget.insert("end", token[1:-1], base_tags + ("md_code_inline",))
            else:
                widget.insert("end", token, base_tags)
            last_index = match.end()

        if last_index < len(text):
            widget.insert("end", text[last_index:], base_tags)


def main(*, backend: BanxuebangUiBackend | None = None) -> None:
    root = ttkb.Window(themename="litera")
    HomeworkUiApp(root, backend=backend)
    root.mainloop()


if __name__ == "__main__":
    main()
