#!/usr/bin/env python3
"""
BXB_Client - 伴学邦作业助手
developed by IGpig
支持 macOS / Windows / Linux
"""

import os
import sys
import subprocess
import json
import threading
import importlib
import tkinter as tk
from tkinter import ttk, messagebox

# ============================================================
# 自动安装依赖
# ============================================================
def ensure_deps():
    deps = {"playwright": "playwright", "requests": "requests"}
    for mod, pip_name in deps.items():
        try:
            importlib.import_module(mod)
        except ImportError:
            print(f"正在安装 {pip_name}...")
            subprocess.check_call([sys.executable, "-m", "pip", "install", pip_name, "-q"])
    try:
        from playwright.sync_api import sync_playwright
        pw = sync_playwright().start()
        try:
            pw.chromium.launch(headless=True)
            pw.stop()
        except Exception:
            print("正在安装 Chromium...")
            subprocess.check_call([sys.executable, "-m", "playwright", "install", "chromium"])
            pw.stop()
    except Exception as e:
        print(f"Playwright 初始化失败: {e}")

ensure_deps()

import requests
from playwright.sync_api import sync_playwright

# ============================================================
# 配置
# ============================================================
BASE = "https://student.banxuebang.com"
CREDENTIALS_FILE = os.path.join(os.path.expanduser("~"), ".banxuebang_creds.json")

# ============================================================
# 伴学邦 API
# ============================================================
class BanxuebangAPI:
    def __init__(self):
        self.pw = None
        self.browser = None
        self.page = None
        self.session = None
        self.http = None

    def start(self):
        self.pw = sync_playwright().start()
        self.browser = self.pw.chromium.launch(headless=True, args=["--no-sandbox"])
        context = self.browser.new_context(viewport={"width": 1280, "height": 800})
        self.page = context.new_page()

    def stop(self):
        if self.browser:
            self.browser.close()
        if self.pw:
            self.pw.stop()
        self.pw = None
        self.browser = None
        self.page = None
        self.session = None
        self.http = None

    def login(self, username, password):
        page = self.page
        page.goto(f"{BASE}/login", wait_until="load", timeout=30000)
        page.wait_for_timeout(5000)
        page.evaluate("""() => {
            const cb = document.querySelector('.el-checkbox');
            if (cb) ['mousedown','mouseup','click'].forEach(e =>
                cb.dispatchEvent(new MouseEvent(e, {bubbles:true, cancelable:true}))
            );
        }""")
        page.wait_for_timeout(500)
        page.fill('input[type="text"]', username)
        page.fill('input[type="password"]', password)
        page.click('button.sigin_btn')
        page.wait_for_url("**/achievement_list", timeout=15000)
        page.wait_for_timeout(3000)

        token = page.evaluate("() => { const t = localStorage.getItem('tokens'); return t ? JSON.parse(t).access_token : ''; }")
        if not token:
            raise RuntimeError("登录失败：无法获取 token")

        user_info = page.evaluate("() => { const u = localStorage.getItem('userInfo'); return u ? JSON.parse(u) : {}; }")
        courses = page.evaluate("() => { const c = localStorage.getItem('subjectList'); return c ? JSON.parse(c) : []; }")
        class_info = page.evaluate("() => { const c = localStorage.getItem('curClass'); return c ? JSON.parse(c) : {}; }")
        terms = page.evaluate("() => { const t = localStorage.getItem('termList'); return t ? JSON.parse(t) : []; }")

        campus_id = page.evaluate("""() => {
            const u = JSON.parse(localStorage.getItem('userInfo') || '{}');
            return u.campusId || '';
        }""")

        self.session = {
            "token": token,
            "student_id": user_info.get("id"),
            "user_name": user_info.get("userName"),
            "org_name": user_info.get("orgName"),
            "school_name": user_info.get("schoolName", ""),
            "campus_name": user_info.get("campusName", ""),
            "class_id": class_info.get("id"),
            "class_name": class_info.get("className", ""),
            "class_alias": class_info.get("classAlias", ""),
            "campus_id": campus_id,
            "courses": courses,
            "terms": terms,
            "system_code": user_info.get("systemCode", ""),
        }

        self.http = requests.Session()
        self.http.headers.update({
            "Authorization": f"Bearer {token}",
            "Accept": "application/json, text/plain, */*",
        })
        return self.session

    def _api_get(self, url):
        resp = self.http.get(url)
        return resp.json()

    def get_courses(self):
        s = self.session
        cur_term = next((t for t in s["terms"] if t.get("status")), s["terms"][0] if s["terms"] else {})
        return {
            "student": s["user_name"],
            "school": s["org_name"],
            "term": cur_term.get("termName", ""),
            "courses": [{
                "name": c["cnName"],
                "id": c["id"],
                "class_id": c.get("classId", ""),
                "teachers": [t["userName"] for t in c.get("teacherList", [])],
            } for c in s["courses"]]
        }

    def get_homework(self, course_name=None):
        s = self.session
        cur_term = next((t for t in s["terms"] if t.get("status")), s["terms"][0] if s["terms"] else {})
        term_id = cur_term["id"]
        courses = s["courses"]
        if course_name:
            courses = [c for c in courses if course_name in c["cnName"]]

        results = []
        for c in courses:
            url = f"{BASE}/gateway/bxb/student/{s['student_id']}/course/{c['id']}/page-query-homework?page=1&size=50&leamTermIds={term_id}&classId={c.get('classId','')}"
            resp = self._api_get(url)
            if isinstance(resp.get("data"), dict) and resp["data"].get("aaData"):
                for hw in resp["data"]["aaData"]:
                    results.append({
                        "course": c["cnName"],
                        "name": hw.get("activityName", ""),
                        "type": hw.get("activityTypeName", "") or hw.get("scoreTypeName", ""),
                        "publish_time": hw.get("endTime") or hw.get("releaseTime") or "",
                        "deadline": hw.get("submitDate") or hw.get("endTime"),
                        "score": hw.get("academicScore") or hw.get("scoreLevel") or hw.get("score") or "N/A",
                    })
        return results

    def get_schedule(self):
        """获取一周课表"""
        s = self.session
        cur_term = next((t for t in s["terms"] if t.get("status")), s["terms"][0] if s["terms"] else {})
        term_id = cur_term["id"]
        sid = s["student_id"]
        campus_id = s.get("campus_id", "")

        url = f"{BASE}/gateway/arrange-course/courseTable/student/{sid}/getSchemeTable/teach?campusId={campus_id}&termId={term_id}"
        resp = self._api_get(url)

        schedule = {}
        if resp.get("code") == 0 and resp.get("data"):
            data = resp["data"]

            time_slots = {}
            for period in ["forenoonLessonTimeSets", "afternoonLessonTimeSets"]:
                for slot in data.get(period, []):
                    time_slots[slot["lesson"]] = f"{slot['startTime']}-{slot['endTime']}"

            for day_data in data.get("weekDays", []):
                day = day_data["day"] + 1
                day_slots = {}
                for period in ["forenoonLessonTimeSets", "afternoonLessonTimeSets"]:
                    for slot in day_data.get(period, []):
                        lesson = slot["lesson"]
                        time = f"{slot['startTime']}-{slot['endTime']}"
                        teach_list = slot.get("teachList", [])
                        if teach_list:
                            courses = []
                            for t in teach_list:
                                courses.append({
                                    "name": t.get("courseName", ""),
                                    "teacher": t.get("teacherName", "").strip(),
                                    "room": t.get("classRoomName", ""),
                                    "color": t.get("courseColor", "#666"),
                                })
                            day_slots[lesson] = {"time": time, "courses": courses}
                        else:
                            day_slots[lesson] = {"time": time, "courses": []}
                schedule[day] = day_slots

            for day in range(1, 6):
                if day not in schedule:
                    schedule[day] = {}
                for lesson in range(9):
                    if lesson not in schedule[day]:
                        if lesson in time_slots:
                            schedule[day][lesson] = {"time": time_slots[lesson], "courses": []}
                        else:
                            schedule[day][lesson] = {"time": "", "courses": []}

        return schedule, time_slots

    def get_notices(self, page_num=1, size=20):
        """获取通知/公告"""
        s = self.session
        url = f"{BASE}/gateway/bxb/student/{s['student_id']}/page-query-notice?page={page_num}&size={size}"
        resp = self._api_get(url)
        notices = []
        if resp.get("code") == 0 and resp.get("data"):
            data = resp["data"]
            for item in data.get("aaData", []):
                notices.append({
                    "id": item.get("id", ""),
                    "title": item.get("activityName", ""),
                    "content": item.get("activityContent", ""),
                    "sender": item.get("createName", ""),
                    "time": item.get("createTime", ""),
                    "read": item.get("readStatus", False),
                })
        return notices


# ============================================================
# GUI
# ============================================================
class App:
    def __init__(self, root):
        self.root = root
        self.root.title("BXB_Client")
        self.root.geometry("960x620")
        self.root.minsize(860, 550)

        self.api = BanxuebangAPI()
        self.api_started = False
        self.logged_in = False

        self.status_var = tk.StringVar(value="就绪")

        self._build_ui()
        self._load_saved_creds()

    def _build_ui(self):
        main = ttk.Frame(self.root)
        main.pack(fill="both", expand=True)

        # ---- 左侧边栏 ----
        self.sidebar = ttk.Frame(main, width=60, style="Sidebar.TFrame")
        self.sidebar.pack(side="left", fill="y")
        self.sidebar.pack_propagate(False)

        style = ttk.Style()
        style.configure("Sidebar.TFrame", background="#2c3e50")
        style.configure("Sidebar.TButton", background="#2c3e50", foreground="white", font=("", 11))

        self.nav_btns = {}
        nav_items = [
            ("home", "🏠", "主页"),
            ("schedule", "📅", "课表"),
            ("homework", "📝", "作业"),
            ("notice", "📬", "通知"),
        ]
        for name, icon, tip in nav_items:
            btn = tk.Button(
                self.sidebar, text=f"{icon}\n{tip}", font=("", 10),
                width=4, relief="flat", bg="#2c3e50", fg="white",
                activebackground="#34495e", activeforeground="white",
                cursor="hand2",
                command=lambda n=name: self._show_page(n)
            )
            btn.pack(fill="x", pady=(8, 0), padx=0)
            btn.bind("<Enter>", lambda e, b=btn: b.config(bg="#34495e"))
            btn.bind("<Leave>", lambda e, b=btn: b.config(bg="#2c3e50"))
            self.nav_btns[name] = btn

        # ---- 右侧内容区 ----
        self.content = ttk.Frame(main)
        self.content.pack(side="left", fill="both", expand=True)

        # ---- 状态栏 ----
        self.status_bar = ttk.Label(self.root, textvariable=self.status_var, relief="sunken", anchor="w", padding=(5, 2))
        self.status_bar.pack(fill="x", side="bottom")

        # ---- 页面 ----
        self.pages = {}
        self._build_home_page()
        self._build_schedule_page()
        self._build_homework_page()
        self._build_notice_page()

        self._show_page("home")

    # ============================================================
    # 导航
    # ============================================================
    def _show_page(self, name):
        for n, page in self.pages.items():
            page.pack_forget()
        self.pages[name].pack(fill="both", expand=True)

        for n, btn in self.nav_btns.items():
            if n == name:
                btn.config(bg="#34495e", font=("", 10, "bold"))
            else:
                btn.config(bg="#2c3e50", font=("", 10))

    # ============================================================
    # 主页
    # ============================================================
    def _build_home_page(self):
        page = ttk.Frame(self.content, padding=40)
        self.pages["home"] = page

        self.home_center = ttk.Frame(page)
        self.home_center.pack(expand=True)

        self._show_login_form()

    def _show_login_form(self):
        for w in self.home_center.winfo_children():
            w.destroy()

        ttk.Label(self.home_center, text="BXB_Client", font=("", 36, "bold")).pack(pady=(0, 5))
        ttk.Label(self.home_center, text="developed by IGpig", font=("", 14), foreground="#999").pack(pady=(0, 50))

        form = ttk.LabelFrame(self.home_center, text="登录", padding=25)
        form.pack(fill="x")

        ttk.Label(form, text="邮箱:").grid(row=0, column=0, sticky="w", pady=8)
        self.username_var = tk.StringVar()
        ttk.Entry(form, textvariable=self.username_var, width=35).grid(row=0, column=1, padx=12, pady=8)

        ttk.Label(form, text="密码:").grid(row=1, column=0, sticky="w", pady=8)
        self.password_var = tk.StringVar()
        ttk.Entry(form, textvariable=self.password_var, show="●", width=35).grid(row=1, column=1, padx=12, pady=8)

        self.remember_var = tk.BooleanVar(value=True)
        ttk.Checkbutton(form, text="记住密码", variable=self.remember_var).grid(row=2, column=1, sticky="w", padx=12)

        btn_frame = ttk.Frame(form)
        btn_frame.grid(row=3, column=0, columnspan=2, pady=(20, 0))
        self.login_btn = ttk.Button(btn_frame, text="登  录", command=self._on_login, width=20)
        self.login_btn.pack()
        self.logout_btn = ttk.Button(btn_frame, text="退  出", command=self._on_logout, width=20, state="disabled")
        self.logout_btn.pack()

    def _show_user_info(self, session):
        for w in self.home_center.winfo_children():
            w.destroy()

        # 头像区
        avatar_frame = ttk.Frame(self.home_center)
        avatar_frame.pack(pady=(20, 10))

        avatar_lbl = tk.Label(avatar_frame, text="👤", font=("", 48))
        avatar_lbl.pack()

        # 名字
        name = session.get("user_name", "")
        ttk.Label(self.home_center, text=name, font=("", 24, "bold")).pack(pady=(5, 0))

        # 学号
        sys_code = session.get("system_code", "")
        if sys_code:
            ttk.Label(self.home_center, text=sys_code, font=("", 11), foreground="#888").pack()

        # 信息卡片
        info_frame = ttk.LabelFrame(self.home_center, text="基本信息", padding=20)
        info_frame.pack(fill="x", pady=(30, 0), padx=40)

        rows = [
            ("学校", session.get("school_name", "")),
            ("校区", session.get("campus_name", "")),
            ("班级", f"{session.get('class_name', '')}  ({session.get('class_alias', '')})"),
            ("部门", session.get("org_name", "")),
        ]
        for i, (label, value) in enumerate(rows):
            ttk.Label(info_frame, text=label, font=("", 10, "bold")).grid(row=i, column=0, sticky="w", pady=6, padx=(0, 15))
            ttk.Label(info_frame, text=value, font=("", 10)).grid(row=i, column=1, sticky="w", pady=6)

        # 登出按钮
        ttk.Button(self.home_center, text="退  出", command=self._on_logout, width=15).pack(pady=(30, 0))

    # ============================================================
    # 课表页面
    # ============================================================
    def _build_schedule_page(self):
        page = ttk.Frame(self.content, padding=10)
        self.pages["schedule"] = page

        toolbar = ttk.Frame(page)
        toolbar.pack(fill="x", pady=(0, 5))
        ttk.Button(toolbar, text="🔄 刷新课表", command=self._load_schedule).pack(side="left")

        self.schedule_frame = ttk.Frame(page)
        self.schedule_frame.pack(fill="both", expand=True)

    def _display_schedule(self, schedule, time_slots):
        for w in self.schedule_frame.winfo_children():
            w.destroy()

        headers = ["节次", "周一", "周二", "周三", "周四", "周五"]
        ROW_HEIGHT = 65
        HEADER_BG = "#ecf0f1"
        EMPTY_BG = "#ffffff"

        self.schedule_frame.columnconfigure(0, weight=0)
        for c in range(1, 6):
            self.schedule_frame.columnconfigure(c, weight=1)

        for i, text in enumerate(headers):
            lbl = tk.Label(self.schedule_frame, text=text, font=("", 10, "bold"),
                          relief="solid", borderwidth=1, bg=HEADER_BG, anchor="center", pady=6)
            lbl.grid(row=0, column=i, sticky="nsew")

        for lesson in range(9):
            row_idx = lesson + 1

            time_str = time_slots.get(lesson, "")
            if not time_str:
                for day in range(1, 6):
                    if lesson in schedule.get(day, {}):
                        time_str = schedule[day][lesson]["time"]
                        break

            time_lbl = tk.Label(self.schedule_frame, text=time_str, font=("", 8),
                               relief="solid", borderwidth=1, anchor="center", pady=4)
            time_lbl.grid(row=row_idx, column=0, sticky="nsew")

            for day in range(1, 6):
                slot = schedule.get(day, {}).get(lesson, {"courses": []})

                cell = tk.Frame(self.schedule_frame, relief="solid", borderwidth=1, bg=EMPTY_BG)
                cell.grid(row=row_idx, column=day, sticky="nsew")
                cell.grid_propagate(False)
                cell.config(height=ROW_HEIGHT)

                if slot["courses"]:
                    for c in slot["courses"]:
                        color = c.get("color", "#666")
                        name = c["name"]
                        teacher = c["teacher"]
                        room = c["room"]
                        detail = f"{teacher} {room}".strip()
                        text = f"{name}\n{detail}" if detail else name
                        lbl = tk.Label(cell, text=text, font=("", 8), anchor="center",
                                      bg=color, fg="white", wraplength=120, justify="center")
                        lbl.pack(fill="both", expand=True, padx=1, pady=1)

    # ============================================================
    # 作业页面
    # ============================================================
    def _build_homework_page(self):
        page = ttk.Frame(self.content, padding=10)
        self.pages["homework"] = page

        filter_frame = ttk.Frame(page)
        filter_frame.pack(fill="x", pady=(0, 5))
        ttk.Label(filter_frame, text="课程:").pack(side="left")
        self.course_filter = ttk.Combobox(filter_frame, values=["全部"], state="readonly", width=20)
        self.course_filter.pack(side="left", padx=5)
        self.course_filter.set("全部")
        ttk.Button(filter_frame, text="🔄 刷新", command=self._load_homework).pack(side="left", padx=5)

        columns = ("course", "name", "publish_time", "deadline", "score")
        self.hw_tree = ttk.Treeview(page, columns=columns, show="headings", height=20)
        self.hw_tree.heading("course", text="课程")
        self.hw_tree.heading("name", text="作业名称")
        self.hw_tree.heading("publish_time", text="发布时间")
        self.hw_tree.heading("deadline", text="截止时间")
        self.hw_tree.heading("score", text="成绩")
        self.hw_tree.column("course", width=100)
        self.hw_tree.column("name", width=350)
        self.hw_tree.column("publish_time", width=140)
        self.hw_tree.column("deadline", width=140)
        self.hw_tree.column("score", width=60)
        self.hw_tree.pack(fill="both", expand=True)

        scrollbar = ttk.Scrollbar(page, orient="vertical", command=self.hw_tree.yview)
        self.hw_tree.configure(yscrollcommand=scrollbar.set)
        scrollbar.pack(side="right", fill="y")

    # ============================================================
    # 通知页面
    # ============================================================
    def _build_notice_page(self):
        page = ttk.Frame(self.content, padding=10)
        self.pages["notice"] = page

        toolbar = ttk.Frame(page)
        toolbar.pack(fill="x", pady=(0, 5))
        ttk.Button(toolbar, text="🔄 刷新通知", command=self._load_notices).pack(side="left")

        # 通知列表
        list_frame = ttk.Frame(page)
        list_frame.pack(fill="both", expand=True)

        self.notice_tree = ttk.Treeview(list_frame, columns=("sender", "title", "time"), show="headings", height=20)
        self.notice_tree.heading("sender", text="发件人")
        self.notice_tree.heading("title", text="标题")
        self.notice_tree.heading("time", text="时间")
        self.notice_tree.column("sender", width=120)
        self.notice_tree.column("title", width=500)
        self.notice_tree.column("time", width=140)
        self.notice_tree.pack(side="left", fill="both", expand=True)

        notice_scroll = ttk.Scrollbar(list_frame, orient="vertical", command=self.notice_tree.yview)
        self.notice_tree.configure(yscrollcommand=notice_scroll.set)
        notice_scroll.pack(side="right", fill="y")

        # 内容预览区
        self.notice_detail = tk.Text(page, height=8, wrap="word", font=("", 10), state="disabled",
                                      bg="#f8f8f8", relief="solid", borderwidth=1)
        self.notice_detail.pack(fill="x", pady=(5, 0))

        self.notice_tree.bind("<<TreeviewSelect>>", self._on_notice_select)

        # 缓存通知数据
        self._notices_cache = []

    def _on_notice_select(self, event):
        sel = self.notice_tree.selection()
        if not sel:
            return
        idx = self.notice_tree.index(sel[0])
        if idx < len(self._notices_cache):
            notice = self._notices_cache[idx]
            self.notice_detail.config(state="normal")
            self.notice_detail.delete("1.0", "end")
            self.notice_detail.insert("1.0", notice["content"])
            self.notice_detail.config(state="disabled")

    def _load_notices(self):
        if not self.logged_in:
            return

        self._set_status("正在加载通知...")

        def do_load():
            try:
                notices = self.api.get_notices()
                self.root.after(0, lambda: self._display_notices(notices))
            except Exception as e:
                self.root.after(0, lambda err=str(e): self._set_status(f"加载通知失败：{err}"))

        threading.Thread(target=do_load, daemon=True).start()

    def _display_notices(self, notices):
        for item in self.notice_tree.get_children():
            self.notice_tree.delete(item)

        self._notices_cache = notices

        for n in notices:
            self.notice_tree.insert("", "end", values=(
                n["sender"],
                n["title"],
                n["time"],
            ))

        self.notice_detail.config(state="normal")
        self.notice_detail.delete("1.0", "end")
        if notices:
            self.notice_detail.insert("1.0", notices[0]["content"])
        self.notice_detail.config(state="disabled")

        self._set_status(f"共 {len(notices)} 条通知")

    # ============================================================
    # 登录 / 退出
    # ============================================================
    def _on_login(self):
        username = self.username_var.get().strip()
        password = self.password_var.get().strip()
        if not username or not password:
            messagebox.showwarning("提示", "请输入邮箱和密码")
            return

        self.login_btn.config(state="disabled")
        self._set_status("正在启动浏览器...")

        def do_login():
            try:
                if not self.api_started:
                    self.api.start()
                    self.api_started = True
                self._set_status("正在登录...")
                session = self.api.login(username, password)
                self.root.after(0, lambda: self._on_login_success(session))
            except Exception as e:
                self.root.after(0, lambda err=str(e): self._on_login_error(err))

        threading.Thread(target=do_login, daemon=True).start()

    def _on_login_success(self, session):
        self.logged_in = True
        self.login_btn.config(state="disabled")
        self.logout_btn.config(state="normal")

        name = session["user_name"]
        self._set_status(f"✅ 已登录：{name}")
        self.root.title(f"BXB_Client - {name}")

        # 更新主页显示用户信息
        self._show_user_info(session)

        courses = self.api.get_courses()
        course_names = ["全部"] + [c["name"] for c in courses["courses"]]
        self.course_filter["values"] = course_names
        self.course_filter.set("全部")

        # 自动加载
        self._load_homework()
        self._load_schedule()
        self._load_notices()

        if self.remember_var.get():
            with open(CREDENTIALS_FILE, "w") as f:
                json.dump({"username": self.username_var.get(), "password": self.password_var.get()}, f)

    def _on_login_error(self, error):
        self.login_btn.config(state="normal")
        self._set_status("❌ 登录失败")
        messagebox.showerror("登录失败", error)

    def _on_logout(self):
        try:
            self.api.stop()
        except:
            pass
        self.api_started = False
        self.api = BanxuebangAPI()
        self.logged_in = False

        self.login_btn.config(state="normal")
        self.logout_btn.config(state="disabled")
        self.root.title("BXB_Client")
        self._set_status("已退出")

        for item in self.hw_tree.get_children():
            self.hw_tree.delete(item)
        for w in self.schedule_frame.winfo_children():
            w.destroy()
        for item in self.notice_tree.get_children():
            self.notice_tree.delete(item)

        self._show_login_form()
        self._show_page("home")

    # ============================================================
    # 加载数据
    # ============================================================
    def _load_homework(self):
        if not self.logged_in:
            return
        course = self.course_filter.get()
        if course == "全部":
            course = None

        self._set_status("正在加载作业...")

        def do_load():
            try:
                homework = self.api.get_homework(course)
                self.root.after(0, lambda hw=homework: self._display_homework(hw))
            except Exception as e:
                self.root.after(0, lambda err=str(e): self._set_status(f"加载失败：{err}"))

        threading.Thread(target=do_load, daemon=True).start()

    def _display_homework(self, homework):
        for item in self.hw_tree.get_children():
            self.hw_tree.delete(item)

        for hw in homework:
            self.hw_tree.insert("", "end", values=(
                hw["course"],
                hw["name"],
                hw["publish_time"] or "-",
                hw["deadline"] or "-",
                str(hw["score"]),
            ))

        for item in self.hw_tree.get_children():
            vals = self.hw_tree.item(item, "values")
            if vals[4] == "N/A":
                self.hw_tree.item(item, tags=("pending",))
        self.hw_tree.tag_configure("pending", foreground="red")

        self._set_status(f"共 {len(homework)} 条作业")

        pending = [h for h in homework if h["score"] == "N/A"]
        if pending:
            self._notify(f"⚠️ 有 {len(pending)} 条未提交作业",
                         "\n".join([f"• {h['course']} - {h['name']}" for h in pending[:5]]))

    def _load_schedule(self):
        if not self.logged_in:
            return

        self._set_status("正在加载课表...")

        def do_load():
            try:
                schedule, time_slots = self.api.get_schedule()
                self.root.after(0, lambda s=schedule, t=time_slots: self._display_schedule(s, t))
                self.root.after(0, lambda: self._set_status("课表加载完成"))
            except Exception as e:
                self.root.after(0, lambda err=str(e): self._set_status(f"加载课表失败：{err}"))

        threading.Thread(target=do_load, daemon=True).start()

    # ============================================================
    # 工具
    # ============================================================
    def _set_status(self, text):
        self.status_var.set(text)
        self.root.update_idletasks()

    def _load_saved_creds(self):
        if os.path.exists(CREDENTIALS_FILE):
            try:
                with open(CREDENTIALS_FILE) as f:
                    creds = json.load(f)
                self.username_var.set(creds.get("username", ""))
                self.password_var.set(creds.get("password", ""))
            except:
                pass

    def _notify(self, title, body):
        try:
            if sys.platform == "darwin":
                import subprocess as sp
                escaped_body = body.replace('"', '\\"').replace('\n', '\\n')
                sp.run([
                    "osascript", "-e",
                    f'display notification "{escaped_body}" with title "{title}" sound name "default"'
                ], capture_output=True)
            elif sys.platform == "win32":
                try:
                    from win10toast import ToastNotifier
                    ToastNotifier().show_toast(title, body, duration=5, threaded=True)
                except ImportError:
                    pass
        except:
            pass


# ============================================================
# 启动
# ============================================================
def main():
    root = tk.Tk()
    app = App(root)
    root.mainloop()

if __name__ == "__main__":
    main()
