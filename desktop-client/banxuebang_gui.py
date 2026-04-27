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
import queue
import importlib
import mimetypes
import re
import base64
import tempfile
import traceback
import webbrowser
from datetime import datetime
import tkinter as tk
from tkinter import ttk, messagebox, filedialog
import tkinter.font as tkfont
from app_metadata import (
    APP_TAGLINE,
    APP_TITLE,
    APP_VERSION,
    FEEDBACK_EMAIL,
    PROJECT_URL,
    REMINDER_SETTINGS_FILENAME,
    UPDATE_FEED_URL,
    WINDOW_TITLE,
)
from bootstrap_runtime import ensure_runtime

# ============================================================
# 自动安装依赖
# ============================================================
def ensure_deps():
    if os.environ.get("BXB_RUNTIME_BOOTSTRAPPED") == "1":
        return
    ensure_runtime(mode="gui")
    return
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
APP_ICON_PATH = os.path.join(os.path.expanduser("~"), "Desktop", "20260424-205440.png")
ASSETS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "assets")
ROUNDED_APP_ICON_PATH = os.path.join(ASSETS_DIR, "app_icon_rounded.png")
CREDENTIALS_FILE = os.path.join(os.path.expanduser("~"), ".banxuebang_creds.json")
REMINDER_SETTINGS_FILE = os.path.join(os.path.expanduser("~"), REMINDER_SETTINGS_FILENAME)
ALL_COURSES_LABEL = "全部课程"

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

    def download_remote_file(self, file_id, target_path):
        url = f"{BASE}/gateway/filesystem/file/download/{file_id}"
        with self.http.get(url, stream=True) as resp:
            resp.raise_for_status()
            with open(target_path, "wb") as f:
                for chunk in resp.iter_content(chunk_size=1024 * 128):
                    if chunk:
                        f.write(chunk)
        return target_path

    def start(self):
        self.pw = sync_playwright().start()
        self.browser = self.pw.chromium.launch(headless=True, args=["--no-sandbox"])
        context = self.browser.new_context(viewport={"width": 1280, "height": 800}, ignore_https_errors=True)
        self.page = context.new_page()

    def _goto_login_page(self):
        page = self.page
        last_error = None
        for attempt in range(2):
            try:
                page.goto(f"{BASE}/login", wait_until="domcontentloaded", timeout=60000)
                page.wait_for_selector('input[type="text"]', timeout=20000)
                page.wait_for_selector('input[type="password"]', timeout=20000)
                try:
                    page.wait_for_load_state("networkidle", timeout=5000)
                except Exception:
                    pass
                return
            except Exception as exc:
                last_error = exc
                try:
                    page.goto("about:blank", wait_until="load", timeout=5000)
                except Exception:
                    pass
                page.wait_for_timeout(1200)
        raise RuntimeError(f"打开登录页失败：{last_error}")

    def _wait_for_login_success(self):
        page = self.page
        try:
            page.wait_for_function(
                """() => {
                    const tokenText = localStorage.getItem('tokens');
                    if (!tokenText) return false;
                    try {
                        const tokenObj = JSON.parse(tokenText);
                        return Boolean(tokenObj && tokenObj.access_token);
                    } catch (e) {
                        return false;
                    }
                }""",
                timeout=45000,
            )
        except Exception:
            try:
                page.wait_for_url("**/achievement_list", wait_until="domcontentloaded", timeout=20000)
            except Exception as exc:
                current_url = ""
                try:
                    current_url = page.url
                except Exception:
                    pass
                raise RuntimeError(f"登录成功状态等待超时，当前页面：{current_url or 'unknown'}；原始错误：{exc}")

        try:
            page.wait_for_function(
                """() => {
                    const userText = localStorage.getItem('userInfo');
                    if (!userText) return false;
                    try {
                        const user = JSON.parse(userText);
                        return Boolean(user && user.id);
                    } catch (e) {
                        return false;
                    }
                }""",
                timeout=10000,
            )
        except Exception:
            pass

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
        self._goto_login_page()
        page.wait_for_timeout(1800)
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
        self._wait_for_login_success()
        page.wait_for_timeout(2000)

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
            "user_avatar": user_info.get("userAvatar", ""),
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

    def _api_put(self, url, payload):
        resp = self.http.put(url, json=payload)
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
        if course_name and course_name != ALL_COURSES_LABEL:
            courses = [c for c in courses if course_name in c["cnName"]]

        results = []
        for c in courses:
            url = f"{BASE}/gateway/bxb/student/{s['student_id']}/course/{c['id']}/page-query-homework?page=1&size=50&leamTermIds={term_id}&classId={c.get('classId','')}"
            resp = self._api_get(url)
            if isinstance(resp.get("data"), dict) and resp["data"].get("aaData"):
                for hw in resp["data"]["aaData"]:
                    score_level = hw.get("scoreLevel")
                    numeric_score = hw.get("score")
                    academic_score = hw.get("academicScore")
                    is_na = hw.get("na") == 1

                    if is_na:
                        display_score = "N/A"
                    else:
                        display_score = score_level or numeric_score or academic_score or "待点评"

                    results.append({
                        "id": hw.get("id"),
                        "course": c["cnName"],
                        "class_id": c.get("classId", ""),
                        "name": hw.get("activityName", ""),
                        "type": hw.get("activityTypeName", "") or hw.get("scoreTypeName", ""),
                        "publish_time": hw.get("endTime") or hw.get("releaseTime") or "",
                        "deadline": hw.get("submitDate") or hw.get("endTime"),
                        "score": display_score,
                        "score_level": score_level,
                        "numeric_score": numeric_score,
                        "academic_score": academic_score,
                        "is_na": is_na,
                    })
        return results

    def get_homework_detail(self, activity_id):
        s = self.session
        url = f"{BASE}/gateway/bxb/student/{s['student_id']}/activity/{activity_id}/detail"
        resp = self._api_get(url)
        if resp.get("code"):
            raise RuntimeError(resp.get("msg") or "获取作业详情失败")
        return resp.get("data") or {}

    def get_homework_submitted_list(self, activity_id, class_id):
        url = f"{BASE}/gateway/bxb/activityWork/homework/{activity_id}/submitted/list"
        resp = self.http.get(url, params={"classId": class_id})
        data = resp.json()
        if data.get("code"):
            raise RuntimeError(data.get("msg") or "获取已提交列表失败")
        return data.get("data") or []

    def get_homework_last_score(self, activity_id, class_id):
        s = self.session
        url = f"{BASE}/gateway/bxb/activityWork/homework/{activity_id}/student/{s['student_id']}/last-score"
        resp = self.http.get(url, params={"classId": class_id})
        data = resp.json()
        if data.get("code"):
            raise RuntimeError(data.get("msg") or "获取最近成绩失败")
        return data.get("data") or {}

    def _get_file_category(self, file_info):
        ext = (file_info.get("ext") or os.path.splitext(file_info.get("filename", ""))[1] or "").lower()
        image_exts = {".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp", ".heic"}
        video_exts = {".mp4", ".mov", ".avi", ".mkv", ".webm", ".m4v"}
        if ext in image_exts:
            return 1
        if ext in video_exts:
            return 2
        return 4

    def upload_file(self, file_path):
        s = self.session
        url = f"{BASE}/gateway/filesystem/file/simpleupload/{s['student_id']}"
        with open(file_path, "rb") as f:
            resp = self.http.post(url, files={"file": (os.path.basename(file_path), f)})
        data = resp.json()
        result = data.get("result") or {}
        if not result or result == "上传失败" or not result.get("id"):
            raise RuntimeError(data.get("msg") or "上传附件失败")

        file_info = {
            "fileId": result["id"],
            "category": self._get_file_category(result),
            "name": result.get("filename", os.path.basename(file_path)),
            "fileName": result.get("filename", os.path.basename(file_path)),
            "fileExt": result.get("ext", os.path.splitext(file_path)[1].lower()),
            "fileType": result.get("contenttype") or mimetypes.guess_type(file_path)[0] or "",
            "fileLength": result.get("timelength", 0),
            "fileSize": result.get("filesize", os.path.getsize(file_path)),
            "creatorId": result.get("userid", s["student_id"]),
            "createTime": result.get("uploaddate", ""),
        }

        try:
            self.http.get(f"{BASE}/gateway/filesystem/file/update/{result['id']}")
        except Exception:
            pass

        return file_info

    def submit_homework(self, activity_id, class_id, remark="", file_paths=None, is_correct_work=0):
        s = self.session
        uploaded_files = []
        for path in file_paths or []:
            uploaded_files.append(self.upload_file(path))

        payload = {
            "activityId": activity_id,
            "childrenId": s["student_id"],
            "classId": class_id,
            "remark": remark,
            "id": None,
            "isCorrectWork": is_correct_work,
            "fileList": uploaded_files,
        }

        if not (payload["remark"] or uploaded_files):
            raise RuntimeError("内容和附件不能都为空")

        data = self._api_put(f"{BASE}/gateway/bxb/activityUser/receipt", payload)
        if data.get("code"):
            raise RuntimeError(data.get("msg") or "提交作业失败")
        return data

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

    def get_undo_message_count(self):
        """获取未处理/未读消息统计"""
        s = self.session
        url = f"{BASE}/gateway/bxb/student/{s['student_id']}/msg/count-undo"
        resp = self._api_get(url)
        if resp.get("code"):
            raise RuntimeError(resp.get("msg") or "获取消息统计失败")
        return resp.get("data")


# ============================================================
# UI Widgets
# ============================================================
class RoundedButton(tk.Canvas):
    def __init__(
        self,
        parent,
        text,
        command=None,
        *,
        width=150,
        height=42,
        radius=16,
        kind="secondary",
        font=None,
        bg="#f5f5f7",
        fg="#111111",
        disabled_fg="#a0a4ad",
        active_fill=None,
        image=None,
        image_y=None,
        text_y=None,
        **kwargs,
    ):
        super().__init__(
            parent,
            width=width,
            height=height,
            highlightthickness=0,
            bd=0,
            bg=bg,
            relief="flat",
            **kwargs,
        )
        self.command = command
        self.kind = kind
        self.radius = radius
        self.base_bg = bg
        self.enabled = True
        self.font = font or ("Segoe UI Variable Text", 11, "bold")
        self.palette = {
            "primary": {"fill": "#0a84ff", "outline": "#0a84ff", "text": "#ffffff", "active": "#0077ed"},
            "secondary": {"fill": "#ffffff", "outline": "#d8dde6", "text": fg, "active": "#f1f4f9"},
            "ghost": {"fill": bg, "outline": bg, "text": fg, "active": "#e9eef7"},
            "active": {"fill": "#e8f2ff", "outline": "#e8f2ff", "text": "#0a84ff", "active": "#dcecff"},
            "danger": {"fill": "#ffffff", "outline": "#ffd7d3", "text": "#d93025", "active": "#fff1f0"},
        }
        self.disabled_fg = disabled_fg
        self.active_fill = active_fill
        self._current_kind = kind
        self._text = text
        self._image = image
        self._image_y = image_y
        self._text_y = text_y
        self._rect_id = None
        self._text_id = None
        self._image_id = None
        self.bind("<Button-1>", self._on_click)
        self.bind("<Enter>", self._on_enter)
        self.bind("<Leave>", self._on_leave)
        self._draw()

    def _rounded_points(self, x1, y1, x2, y2, r):
        return [
            x1 + r, y1,
            x2 - r, y1,
            x2, y1,
            x2, y1 + r,
            x2, y2 - r,
            x2, y2,
            x2 - r, y2,
            x1 + r, y2,
            x1, y2,
            x1, y2 - r,
            x1, y1 + r,
            x1, y1,
        ]

    def _draw(self):
        self.delete("all")
        width = max(int(float(self.cget("width"))), 2)
        height = max(int(float(self.cget("height"))), 2)
        palette = self.palette[self._current_kind]
        fill = palette["fill"]
        outline = palette["outline"]
        text_color = palette["text"] if self.enabled else self.disabled_fg
        if self._current_kind == "active":
            self.create_polygon(
                self._rounded_points(3, 6, width - 3, height - 1, self.radius),
                smooth=True,
                splinesteps=36,
                fill="#d5e4f7",
                outline="",
            )
            self.create_polygon(
                self._rounded_points(2, 4, width - 2, height - 1, self.radius),
                smooth=True,
                splinesteps=36,
                fill="#edf4fc",
                outline="",
            )
        self._rect_id = self.create_polygon(
            self._rounded_points(1, 1, width - 1, height - 1, self.radius),
            smooth=True,
            splinesteps=36,
            fill=fill,
            outline=outline,
            width=1,
        )
        image_y = self._image_y if self._image_y is not None else max(height * 0.34, 16)
        text_y = self._text_y if self._text_y is not None else (height * 0.74 if self._image else height / 2)
        if self._image is not None:
            self._image_id = self.create_image(width / 2, image_y, image=self._image)
        self._text_id = self.create_text(
            width / 2,
            text_y,
            text=self._text,
            fill=text_color,
            font=self.font,
            justify="center",
        )
        super().configure(cursor="hand2" if self.enabled else "arrow")

    def _set_hover(self, hover):
        if not self.enabled:
            return
        palette = self.palette[self._current_kind]
        fill = self.active_fill or (palette["active"] if hover else palette["fill"])
        self.itemconfigure(self._rect_id, fill=fill)

    def _on_enter(self, _event):
        self._set_hover(True)

    def _on_leave(self, _event):
        self._set_hover(False)

    def _on_click(self, _event):
        if self.enabled and self.command:
            self.command()

    def configure(self, cnf=None, **kwargs):
        if cnf:
            kwargs.update(cnf)
        if "text" in kwargs:
            self._text = kwargs.pop("text")
        if "command" in kwargs:
            self.command = kwargs.pop("command")
        if "state" in kwargs:
            self.enabled = kwargs.pop("state") != "disabled"
        if "kind" in kwargs:
            self._current_kind = kwargs.pop("kind")
        if "font" in kwargs:
            self.font = kwargs.pop("font")
        if "image" in kwargs:
            self._image = kwargs.pop("image")
        if "bg" in kwargs:
            self.base_bg = kwargs["bg"]
        super().configure(**kwargs)
        self._draw()

    config = configure


class RoundedPanel(tk.Canvas):
    def __init__(self, parent, *, bg, fill, outline, radius=22, padding=0, height=96, **kwargs):
        super().__init__(parent, highlightthickness=0, bd=0, bg=bg, height=height, **kwargs)
        self.fill = fill
        self.outline = outline
        self.radius = radius
        self.padding = padding
        self.inner = tk.Frame(self, bg=fill)
        self._window = self.create_window((padding, padding), window=self.inner, anchor="nw")
        self.bind("<Configure>", self._redraw)
        self._redraw()

    def _rounded_points(self, x1, y1, x2, y2, r):
        return [
            x1 + r, y1,
            x2 - r, y1,
            x2, y1,
            x2, y1 + r,
            x2, y2 - r,
            x2, y2,
            x2 - r, y2,
            x1 + r, y2,
            x1, y2,
            x1, y2 - r,
            x1, y1 + r,
            x1, y1,
        ]

    def _redraw(self, _event=None):
        self.delete("panel")
        width = max(int(float(self.winfo_width() or self.cget("width") or 10)), 10)
        height = max(int(float(self.winfo_height() or self.cget("height") or 10)), 10)
        self.create_polygon(
            self._rounded_points(1, 1, width - 1, height - 1, self.radius),
            smooth=True,
            splinesteps=36,
            fill=self.fill,
            outline=self.outline,
            width=1,
            tags="panel",
        )
        self.coords(self._window, self.padding, self.padding)
        self.itemconfigure(self._window, width=max(width - self.padding * 2, 1), height=max(height - self.padding * 2, 1))


# ============================================================
# GUI
# ============================================================
class App:
    def __init__(self, root):
        self.root = root
        self.root.title(WINDOW_TITLE)
        self.root.geometry("1320x860")
        self.root.minsize(1180, 760)
        self._ui_queue = queue.Queue()
        if sys.platform == "darwin":
            self.font_family = "PingFang SC"
            self.font_family_display = "SF Pro Display"
        elif sys.platform == "win32":
            self.font_family = "Segoe UI Variable Text"
            self.font_family_display = "Segoe UI Variable Display"
        else:
            self.font_family = "Noto Sans"
            self.font_family_display = "Noto Sans"

        self.api = BanxuebangAPI()
        self.api_started = False
        self.logged_in = False
        self._homework_cache = []
        self._homework_by_item = {}
        self._selected_homework = None
        self._submit_files = []
        self._submit_dialog = None
        self._avatar_photo = None
        self._message_count = None
        self._app_icon = None
        self._sidebar_icon = None
        self._nav_icon_images = {}
        self._homework_subject = ALL_COURSES_LABEL
        self._homework_subject_buttons = {}
        self._homework_card_widgets = {}
        self._homework_view_mode = "homework"
        self._homework_subject_loading = False
        self._scroll_jobs = {}
        self._scroll_pending = {}
        self._schedule_cache = {}
        self._schedule_time_slots = {}
        self._page_transition_job = None
        self._reminder_job = None
        self._last_reminder_keys = set()
        self._last_notice_signature = ""
        self._last_homework_signature = ""
        self._last_schedule_signature = ""
        self._reminder_running = False
        self.reminder_config = self._default_reminder_config()

        self.status_var = tk.StringVar(value=f"就绪 · v{APP_VERSION}")
        self.page_title_var = tk.StringVar(value="Dashboard")
        self.page_subtitle_var = tk.StringVar(value="A calmer workspace for homework, schedule, and notices.")
        self.current_page = "home"
        self.ui = {
            "bg": "#edf1f6",
            "panel": "#ffffff",
            "panel_alt": "#f4f6f9",
            "border": "#d8e0e8",
            "text": "#1d1d1f",
            "muted": "#69717d",
            "accent": "#1473e6",
            "accent_soft": "#eaf3ff",
            "danger": "#d93025",
            "danger_soft": "#fff2f0",
            "success": "#2fb35a",
            "shadow": "#c7d2dd",
        }

        self._configure_window()
        self._configure_styles()
        self._build_ui()
        self._load_saved_creds()
        self._load_reminder_settings()
        self._apply_reminder_config_to_form()
        self.root.bind("<Configure>", self._on_window_resize)
        self.root.bind_all("<MouseWheel>", self._on_global_mousewheel)
        self.root.bind_all("<Shift-MouseWheel>", self._on_global_shift_mousewheel)
        self.root.bind_all("<Button-4>", self._on_global_linux_scroll)
        self.root.bind_all("<Button-5>", self._on_global_linux_scroll)
        self.root.after(50, self._drain_ui_queue)
        self.root.after(1500, self._schedule_reminder_tick)

    def _configure_window(self):
        self.root.configure(bg=self.ui["bg"])
        self._ensure_ui_assets()
        if sys.platform == "darwin":
            try:
                self.root.tk.call("tk", "scaling", 1.15)
            except Exception:
                pass
            try:
                self.root.tk.call("::tk::unsupported::MacWindowStyle", "style", self.root._w, "document", "closeBox collapseBox resizable")
            except Exception:
                pass
        try:
            icon_path = ROUNDED_APP_ICON_PATH if os.path.exists(ROUNDED_APP_ICON_PATH) else APP_ICON_PATH
            if os.path.exists(icon_path):
                self._app_icon = tk.PhotoImage(file=icon_path)
                self.root.iconphoto(True, self._app_icon)
        except Exception:
            pass
        try:
            self.root.option_add("*Font", f"{{{self.font_family}}} 12")
        except Exception:
            pass
        self.root.after(80, self._maximize_window)

    def _maximize_window(self):
        try:
            if sys.platform == "win32":
                self.root.state("zoomed")
                return
        except Exception:
            pass
        try:
            width = self.root.winfo_screenwidth()
            height = self.root.winfo_screenheight()
            if sys.platform == "darwin":
                target_width = min(max(1240, int(width * 0.82)), 1440)
                target_height = min(max(820, int(height * 0.84)), 980)
                offset_x = max((width - target_width) // 2, 0)
                offset_y = max((height - target_height) // 2 - 18, 0)
                self.root.geometry(f"{target_width}x{target_height}+{offset_x}+{offset_y}")
                return
            self.root.geometry(f"{width}x{height}+0+0")
        except Exception:
            pass

    def _ensure_ui_assets(self):
        script_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "generate_ui_assets.py")
        if not os.path.exists(script_path):
            return
        needed = [
            ROUNDED_APP_ICON_PATH,
            os.path.join(ASSETS_DIR, "nav_home.png"),
            os.path.join(ASSETS_DIR, "nav_schedule.png"),
            os.path.join(ASSETS_DIR, "nav_homework.png"),
            os.path.join(ASSETS_DIR, "nav_notice.png"),
            os.path.join(ASSETS_DIR, "nav_reminder.png"),
        ]
        if all(os.path.exists(path) for path in needed):
            return
        try:
            subprocess.run([sys.executable, script_path], check=True, capture_output=True)
        except Exception:
            pass

    def _on_global_mousewheel(self, event):
        return self._dispatch_scroll_event(event, horizontal=False)

    def _on_global_shift_mousewheel(self, event):
        return self._dispatch_scroll_event(event, horizontal=True)

    def _on_global_linux_scroll(self, event):
        horizontal = False
        steps = -1 if getattr(event, "num", None) == 4 else 1
        return self._dispatch_scroll_event(event, horizontal=horizontal, fallback_steps=steps)

    def _dispatch_scroll_event(self, event, horizontal=False, fallback_steps=None):
        pointer_widget = self.root.winfo_containing(event.x_root, event.y_root)
        target = self._resolve_scroll_target(pointer_widget, horizontal=horizontal)
        if target is None:
            return None

        if fallback_steps is not None:
            steps = fallback_steps
        else:
            delta = getattr(event, "delta", 0)
            if delta == 0:
                return None
            if sys.platform == "darwin":
                steps = -1 if delta > 0 else 1
            else:
                steps = int(-delta / 120)
                if steps == 0:
                    steps = -1 if delta > 0 else 1

        self._queue_smooth_scroll(target, steps, axis="x" if horizontal else "y")
        return "break"

    def _resolve_scroll_target(self, widget, horizontal=False):
        target_names = [
            "homework_subjects_canvas",
            "submit_center_detail",
            "submit_center_remark_text",
            "submit_assignment_file_list",
            "submit_center_file_list",
            "submit_center_canvas",
            "homework_preview_body",
            "notice_detail",
            "notice_tree",
            "homework_list_canvas",
            "schedule_canvas",
        ]
        while widget is not None:
            for name in target_names:
                target = getattr(self, name, None)
                if target is not None and widget == target:
                    if horizontal and not hasattr(target, "xview_scroll"):
                        return None
                    return target
            try:
                widget = widget.master
            except Exception:
                widget = None
        return None

    def _queue_smooth_scroll(self, widget, steps, axis="y"):
        if steps == 0:
            return
        key = (str(widget), axis)
        multiplier = 1 if sys.platform == "darwin" else 3
        self._scroll_pending[key] = self._scroll_pending.get(key, 0) + steps * multiplier
        if key not in self._scroll_jobs:
            self._animate_smooth_scroll(widget, axis)

    def _animate_smooth_scroll(self, widget, axis="y"):
        key = (str(widget), axis)
        remaining = self._scroll_pending.get(key, 0)
        if remaining == 0:
            self._scroll_jobs.pop(key, None)
            self._scroll_pending.pop(key, None)
            return

        direction = 1 if remaining > 0 else -1
        if sys.platform == "darwin":
            step = direction
        else:
            step = direction if abs(remaining) < 3 else direction * 2
        self._scroll_pending[key] = remaining - step

        try:
            if axis == "x":
                widget.xview_scroll(step, "units")
            else:
                widget.yview_scroll(step, "units")
        except Exception:
            self._scroll_jobs.pop(key, None)
            self._scroll_pending.pop(key, None)
            return

        delay = 11 if sys.platform == "darwin" else 14
        self._scroll_jobs[key] = self.root.after(delay, lambda: self._animate_smooth_scroll(widget, axis))

    def _fit_photoimage(self, image, max_size):
        width = image.width()
        height = image.height()
        if width <= 0 or height <= 0:
            return image
        scale = max(width / max_size, height / max_size, 1)
        factor = max(1, int(scale))
        return image.subsample(factor, factor)

    def _load_nav_icon(self, name, max_size=22):
        path = os.path.join(ASSETS_DIR, f"nav_{name}.png")
        if not os.path.exists(path):
            return None
        try:
            image = tk.PhotoImage(file=path)
            image = self._fit_photoimage(image, max_size)
            self._nav_icon_images[name] = image
            return image
        except Exception:
            return None

    def _parent_bg(self, parent, fallback=None):
        fallback = fallback or self.ui["panel"]
        for key in ("bg", "background"):
            try:
                value = parent.cget(key)
                if value:
                    return value
            except Exception:
                continue
        return fallback

    def _make_button(self, parent, text, command, *, kind="secondary", width=150, height=42):
        return RoundedButton(
            parent,
            text=text,
            command=command,
            kind=kind,
            width=width,
            height=height,
            radius=18,
            bg=self._parent_bg(parent),
            fg=self.ui["text"],
            font=(self.font_family, 11, "bold"),
        )

    def _make_nav_button(self, parent, text, command, *, image=None):
        return RoundedButton(
            parent,
            text=text,
            command=command,
            kind="ghost",
            width=84,
            height=72,
            radius=22,
            bg=self._parent_bg(parent, self.ui["bg"]),
            fg=self.ui["muted"],
            font=(self.font_family, 9, "bold"),
            image=image,
            image_y=22,
            text_y=54,
        )

    def _configure_styles(self):
        style = ttk.Style()
        try:
            style.theme_use("aqua" if sys.platform == "darwin" else "clam")
        except Exception:
            pass

        style.configure("App.TFrame", background=self.ui["bg"])
        style.configure("Panel.TFrame", background=self.ui["panel"])
        style.configure("PanelAlt.TFrame", background=self.ui["panel_alt"])
        style.configure("Panel.TLabelframe", background=self.ui["panel"], borderwidth=0)
        style.configure("Panel.TLabelframe.Label", background=self.ui["panel"], foreground=self.ui["muted"], font=(self.font_family, 11, "bold"))
        style.configure("Title.TLabel", background=self.ui["bg"], foreground=self.ui["text"], font=(self.font_family_display, 30 if sys.platform == "darwin" else 28, "bold"))
        style.configure("Subtitle.TLabel", background=self.ui["bg"], foreground=self.ui["muted"], font=(self.font_family, 12 if sys.platform == "darwin" else 12))
        style.configure("PanelTitle.TLabel", background=self.ui["panel"], foreground=self.ui["text"], font=(self.font_family_display, 16, "bold"))
        style.configure("PanelBody.TLabel", background=self.ui["panel"], foreground=self.ui["muted"], font=(self.font_family, 11))
        style.configure("MetricValue.TLabel", background=self.ui["panel"], foreground=self.ui["text"], font=(self.font_family_display, 26, "bold"))
        style.configure("MetricCaption.TLabel", background=self.ui["panel"], foreground=self.ui["muted"], font=(self.font_family, 10))
        style.configure("Primary.TButton", background=self.ui["accent"], foreground="#ffffff", borderwidth=0, padding=(18, 12), font=(self.font_family, 11, "bold"))
        style.map("Primary.TButton", background=[("active", "#0672dd")])
        style.configure("Secondary.TButton", background=self.ui["panel_alt"], foreground=self.ui["text"], bordercolor=self.ui["border"], borderwidth=1, padding=(18, 12), font=(self.font_family, 11, "bold"))
        style.map("Secondary.TButton", background=[("active", "#eef0f5")])
        style.configure("Sidebar.TButton", background=self.ui["bg"], foreground=self.ui["muted"], borderwidth=0, padding=(10, 10))
        style.map("Sidebar.TButton", background=[("active", self.ui["accent_soft"])], foreground=[("active", self.ui["text"])])
        style.configure("App.Treeview", background=self.ui["panel"], fieldbackground=self.ui["panel"], foreground=self.ui["text"], rowheight=52 if sys.platform == "darwin" else 48, borderwidth=0, font=(self.font_family, 11))
        style.configure("App.Treeview.Heading", background=self.ui["panel_alt"], foreground=self.ui["muted"], relief="flat", borderwidth=0, font=(self.font_family, 10, "bold"), padding=(14, 14))
        style.map("App.Treeview", background=[("selected", self.ui["accent_soft"])], foreground=[("selected", self.ui["text"])])
        style.configure("App.TCombobox", fieldbackground=self.ui["panel_alt"], background=self.ui["panel_alt"], foreground=self.ui["text"], bordercolor=self.ui["panel_alt"], lightcolor=self.ui["panel_alt"], darkcolor=self.ui["panel_alt"], arrowsize=16, padding=12, font=(self.font_family, 11))
        style.layout("App.Vertical.TScrollbar", [
            ("Vertical.Scrollbar.trough", {
                "sticky": "ns",
                "children": [("Vertical.Scrollbar.thumb", {"expand": "1", "sticky": "nswe"})],
            })
        ])
        style.layout("App.Horizontal.TScrollbar", [
            ("Horizontal.Scrollbar.trough", {
                "sticky": "ew",
                "children": [("Horizontal.Scrollbar.thumb", {"expand": "1", "sticky": "nswe"})],
            })
        ])
        style.configure("App.Vertical.TScrollbar", background="#b8c5d4", troughcolor=self.ui["panel_alt"], bordercolor=self.ui["panel_alt"], darkcolor="#b8c5d4", lightcolor="#b8c5d4", arrowcolor="#b8c5d4", relief="flat", borderwidth=0, arrowsize=0, gripcount=0)
        style.map("App.Vertical.TScrollbar", background=[("active", "#93a7bc")])
        style.configure("App.Horizontal.TScrollbar", background="#b8c5d4", troughcolor=self.ui["panel_alt"], bordercolor=self.ui["panel_alt"], darkcolor="#b8c5d4", lightcolor="#b8c5d4", arrowcolor="#b8c5d4", relief="flat", borderwidth=0, arrowsize=0, gripcount=0)
        style.map("App.Horizontal.TScrollbar", background=[("active", "#93a7bc")])

    def _build_ui(self):
        self.app_shell = tk.Frame(self.root, bg=self.ui["bg"])
        self.app_shell.pack(fill="both", expand=True, padx=18, pady=18)

        self.sidebar = tk.Frame(self.app_shell, bg=self.ui["bg"], width=96)
        self.sidebar.pack(side="left", fill="y", padx=(0, 18))
        self.sidebar.pack_propagate(False)

        brand = tk.Frame(self.sidebar, bg=self.ui["bg"])
        brand.pack(fill="x", pady=(6, 20))
        if self._app_icon is not None:
            self._sidebar_icon = self._fit_photoimage(self._app_icon, 56)
            brand_icon = tk.Label(brand, image=self._sidebar_icon, bg=self.ui["bg"])
            brand_icon.image = self._sidebar_icon
            brand_icon.pack(pady=(0, 10))
        else:
            tk.Label(brand, text="BXB", bg=self.ui["text"], fg="#ffffff", width=4, height=2, font=(self.font_family_display, 14, "bold")).pack(pady=(0, 10))
        tk.Label(brand, text="Client", bg=self.ui["bg"], fg=self.ui["muted"], font=(self.font_family, 10, "bold")).pack()

        self.nav_btns = {}
        nav_items = [
            ("home", "Overview"),
            ("schedule", "Schedule"),
            ("homework", "Homework"),
            ("notice", "Notices"),
            ("reminder", "Alerts"),
        ]
        for name, tip in nav_items:
            btn = self._make_nav_button(
                self.sidebar,
                tip,
                lambda n=name: self._show_page(n),
                image=self._load_nav_icon(name),
            )
            btn.pack(fill="x", pady=6)
            self.nav_btns[name] = btn

        content_wrap = tk.Frame(self.app_shell, bg=self.ui["bg"])
        content_wrap.pack(side="left", fill="both", expand=True)

        self.topbar = tk.Frame(content_wrap, bg=self.ui["bg"], height=78)
        self.topbar.pack(fill="x", pady=(0, 14))
        self.topbar.pack_propagate(False)

        title_group = tk.Frame(self.topbar, bg=self.ui["bg"])
        title_group.pack(side="left", fill="y")
        ttk.Label(title_group, textvariable=self.page_title_var, style="Title.TLabel").pack(anchor="w", pady=(4, 0))
        ttk.Label(title_group, textvariable=self.page_subtitle_var, style="Subtitle.TLabel").pack(anchor="w", pady=(4, 0))

        self.topbar_meta = tk.Frame(self.topbar, bg=self.ui["bg"])
        self.topbar_meta.pack(side="right", fill="y")
        self.update_btn = self._make_button(
            self.topbar_meta,
            f"v{APP_VERSION}",
            self._check_for_updates,
            kind="secondary",
            width=108,
            height=40,
        )
        self.update_btn.pack(side="right", padx=(0, 10), pady=10)
        self.topbar_user_badge = tk.Label(
            self.topbar_meta,
            text="Not Signed In",
            bg=self.ui["panel"],
            fg=self.ui["muted"],
            relief="flat",
            padx=18,
            pady=12,
            font=(self.font_family, 11, "bold"),
        )
        self.topbar_user_badge.pack(side="right", pady=8)

        self.content = tk.Frame(content_wrap, bg=self.ui["bg"])
        self.content.pack(fill="both", expand=True)

        self.status_bar = tk.Label(
            content_wrap,
            textvariable=self.status_var,
            bg=self.ui["panel"],
            fg=self.ui["muted"],
            anchor="w",
            padx=16,
            pady=10,
            font=(self.font_family, 10),
        )
        self.status_bar.pack(fill="x", pady=(14, 0))

        self.footer_bar = tk.Frame(content_wrap, bg=self.ui["bg"])
        self.footer_bar.pack(fill="x", pady=(10, 0))
        self._build_footer(self.footer_bar)

        self.pages = {}
        self._build_home_page()
        self._build_schedule_page()
        self._build_homework_page()
        self._build_notice_page()
        self._build_reminder_page()
        self._show_page("home")

    def _build_footer(self, parent):
        footer = tk.Frame(parent, bg=self.ui["bg"])
        footer.pack(fill="x")

        label_style = {
            "bg": self.ui["bg"],
            "fg": self.ui["muted"],
            "font": (self.font_family, 10),
        }
        link_style = {
            "bg": self.ui["bg"],
            "fg": self.ui["accent"],
            "font": (self.font_family, 10, "underline"),
            "cursor": "hand2",
        }

        tk.Label(footer, text="反馈邮箱：", **label_style).pack(side="left")
        mail_link = tk.Label(footer, text=FEEDBACK_EMAIL, **link_style)
        mail_link.pack(side="left")
        tk.Label(footer, text="   GitHub 项目：", **label_style).pack(side="left")
        repo_link = tk.Label(footer, text=PROJECT_URL, **link_style)
        repo_link.pack(side="left")

        mail_link.bind("<Button-1>", lambda _event: self._open_external_link(f"mailto:{FEEDBACK_EMAIL}"))
        repo_link.bind("<Button-1>", lambda _event: self._open_external_link(PROJECT_URL))

    def _open_external_link(self, url):
        try:
            webbrowser.open(url)
            if url.startswith("mailto:"):
                self._set_status(f"已打开反馈邮箱：{FEEDBACK_EMAIL}")
            else:
                self._set_status("已打开 GitHub 项目地址")
        except Exception as exc:
            self._set_status(f"打开链接失败：{exc}")

    # ============================================================
    # 导航
    # ============================================================
    def _show_page(self, name):
        for n, btn in self.nav_btns.items():
            if n == name:
                btn.config(kind="active")
            else:
                btn.config(kind="ghost")

        page_titles = {
            "home": ("Overview", "A calmer workspace for homework, schedule, and notices."),
            "schedule": ("Weekly Schedule", "Your classes arranged in a cleaner studio-style grid."),
            "homework": ("Homework", "Focused course view with submission and score controls."),
            "notice": ("Notices", "A reading-first inbox for school announcements and updates."),
            "reminder": ("Alerts", "System reminders for homework, schedule, and school notices."),
        }
        title, subtitle = page_titles.get(name, ("BXB Client developed by IGpig", ""))
        self.page_title_var.set(title)
        self.page_subtitle_var.set(subtitle)
        self._transition_to_page(name)

    def _transition_to_page(self, name):
        new_page = self.pages[name]
        old_page = self.pages.get(self.current_page) if self.current_page in self.pages else None

        if self._page_transition_job is not None:
            try:
                self.root.after_cancel(self._page_transition_job)
            except Exception:
                pass
            self._page_transition_job = None

        for page in self.pages.values():
            page.pack_forget()
            page.place_forget()

        width = max(self.content.winfo_width(), 1)
        should_animate = old_page is not None and old_page is not new_page and width > 200

        self.current_page = name
        if not should_animate:
            new_page.pack(fill="both", expand=True)
            return

        offset = min(72, max(28, int(width * 0.07)))
        steps = 10
        old_page.place(in_=self.content, x=0, y=0, relwidth=1, relheight=1)
        new_page.place(in_=self.content, x=offset, y=0, relwidth=1, relheight=1)
        new_page.lift()

        def animate(step=0):
            progress = (step + 1) / steps
            ease = 1 - pow(1 - progress, 3)
            old_x = int(-offset * 0.55 * ease)
            new_x = int(offset * (1 - ease))
            old_page.place_configure(x=old_x)
            new_page.place_configure(x=new_x)

            if step + 1 < steps:
                self._page_transition_job = self.root.after(16, lambda: animate(step + 1))
                return

            old_page.place_forget()
            new_page.place_forget()
            new_page.pack(fill="both", expand=True)
            self._page_transition_job = None

        animate()

    # ============================================================
    # 主页
    # ============================================================
    def _build_home_page(self):
        page = tk.Frame(self.content, bg=self.ui["bg"])
        self.pages["home"] = page

        self.home_center = tk.Frame(page, bg=self.ui["bg"])
        self.home_center.pack(fill="both", expand=True)

        self._show_login_form()

    def _show_login_form(self):
        for w in self.home_center.winfo_children():
            w.destroy()

        shell = tk.Frame(self.home_center, bg=self.ui["bg"])
        shell.place(relx=0.5, rely=0.5, anchor="center")

        hero = tk.Frame(shell, bg=self.ui["bg"])
        hero.pack(side="left", padx=(0, 24))

        tk.Label(hero, text=APP_TITLE, bg=self.ui["bg"], fg=self.ui["text"], font=("", 34, "bold")).pack(anchor="w")
        tk.Label(hero, text=f"{APP_TAGLINE}  v{APP_VERSION}", bg=self.ui["bg"], fg=self.ui["muted"], font=("", 13)).pack(anchor="w", pady=(8, 18))

        feature_card = tk.Frame(hero, bg=self.ui["panel"], highlightbackground=self.ui["border"], highlightthickness=1, padx=22, pady=22)
        feature_card.pack(fill="x")
        for line in [
            "Focused homework workflows",
            "Readable weekly schedule",
            "Notice inbox with reading pane",
            "Cross-platform on macOS and Windows",
        ]:
            tk.Label(feature_card, text=f"•  {line}", bg=self.ui["panel"], fg=self.ui["text"], font=("", 11)).pack(anchor="w", pady=4)

        form = tk.Frame(shell, bg=self.ui["panel"], highlightbackground=self.ui["border"], highlightthickness=1, padx=28, pady=28)
        form.pack(side="left")

        tk.Label(form, text="Sign In", bg=self.ui["panel"], fg=self.ui["text"], font=("", 20, "bold")).grid(row=0, column=0, columnspan=2, sticky="w")
        tk.Label(form, text="Use your Banxuebang student account to continue.", bg=self.ui["panel"], fg=self.ui["muted"], font=("", 11)).grid(row=1, column=0, columnspan=2, sticky="w", pady=(6, 20))

        tk.Label(form, text="邮箱", bg=self.ui["panel"], fg=self.ui["muted"], font=("", 10, "bold")).grid(row=2, column=0, sticky="w", pady=8)
        self.username_var = tk.StringVar()
        ttk.Entry(form, textvariable=self.username_var, width=30).grid(row=2, column=1, padx=12, pady=8)

        tk.Label(form, text="密码", bg=self.ui["panel"], fg=self.ui["muted"], font=("", 10, "bold")).grid(row=3, column=0, sticky="w", pady=8)
        self.password_var = tk.StringVar()
        ttk.Entry(form, textvariable=self.password_var, show="●", width=30).grid(row=3, column=1, padx=12, pady=8)

        self.remember_var = tk.BooleanVar(value=True)
        ttk.Checkbutton(form, text="记住密码", variable=self.remember_var).grid(row=4, column=1, sticky="w", padx=12, pady=(6, 6))

        btn_frame = tk.Frame(form, bg=self.ui["panel"])
        btn_frame.grid(row=5, column=0, columnspan=2, sticky="ew", pady=(18, 0))
        self.login_btn = self._make_button(btn_frame, "Continue", self._on_login, kind="primary", width=240, height=44)
        self.login_btn.pack(fill="x")
        self.logout_btn = self._make_button(btn_frame, "Sign Out", self._on_logout, kind="secondary", width=240, height=44)
        self.logout_btn.config(state="disabled")
        self.logout_btn.pack(fill="x", pady=(10, 0))

    def _show_user_info(self, session):
        for w in self.home_center.winfo_children():
            w.destroy()

        shell = tk.Frame(self.home_center, bg=self.ui["bg"])
        shell.pack(fill="both", expand=True)

        hero = tk.Frame(shell, bg=self.ui["panel"], highlightbackground=self.ui["border"], highlightthickness=1, padx=28, pady=28)
        hero.pack(fill="x", pady=(0, 18))

        left = tk.Frame(hero, bg=self.ui["panel"])
        left.pack(side="left", fill="y")

        avatar_frame = tk.Frame(left, bg=self.ui["panel"])
        avatar_frame.pack(anchor="w", pady=(0, 14))

        avatar_image = self._load_avatar_image(session.get("user_avatar"))
        if avatar_image:
            avatar_lbl = tk.Label(avatar_frame, image=avatar_image, width=96, height=96, bg=self.ui["panel"])
            avatar_lbl.image = avatar_image
            self._avatar_photo = avatar_image
        else:
            avatar_lbl = tk.Label(
                avatar_frame,
                text=(session.get("user_name", "?")[:1] or "?").upper(),
                font=("", 32, "bold"),
                width=4,
                height=2,
                bg=self.ui["accent_soft"],
                fg=self.ui["accent"],
                relief="flat",
            )
        avatar_lbl.pack()

        name = session.get("user_name", "")
        tk.Label(left, text=name, bg=self.ui["panel"], fg=self.ui["text"], font=("", 24, "bold")).pack(anchor="w")
        tk.Label(left, text="Student workspace", bg=self.ui["panel"], fg=self.ui["muted"], font=("", 11)).pack(anchor="w", pady=(6, 0))

        sys_code = session.get("system_code", "")
        if sys_code:
            tk.Label(left, text=sys_code, bg=self.ui["panel"], fg=self.ui["muted"], font=("", 11)).pack(anchor="w", pady=(8, 0))

        self.home_status_card = RoundedPanel(hero, bg=self.ui["panel"], fill=self.ui["panel_alt"], outline=self.ui["border"], radius=24, padding=18, width=420, height=154)
        self.home_status_card.pack(side="left", fill="both", expand=True, padx=(28, 28))
        status_wrap = self.home_status_card.inner
        tk.Label(status_wrap, text="当前状态", bg=self.ui["panel_alt"], fg=self.ui["muted"], font=(self.font_family, 10, "bold")).pack(anchor="w")
        self.home_status_summary = tk.Label(
            status_wrap,
            text="正在整理你的课程和作业信息...",
            bg=self.ui["panel_alt"],
            fg=self.ui["text"],
            font=(self.font_family, 13, "bold"),
            justify="left",
            wraplength=360,
        )
        self.home_status_summary.pack(anchor="w", pady=(10, 0))
        self.home_status_hint = tk.Label(
            status_wrap,
            text="",
            bg=self.ui["panel_alt"],
            fg=self.ui["muted"],
            font=(self.font_family, 10),
            justify="left",
            wraplength=360,
        )
        self.home_status_hint.pack(anchor="w", pady=(10, 0))

        actions = tk.Frame(hero, bg=self.ui["panel"])
        actions.pack(side="right", anchor="n")
        self._make_button(actions, "Homework", lambda: self._show_page("homework"), kind="primary", width=170, height=44).pack(fill="x")
        self._make_button(actions, "Schedule", lambda: self._show_page("schedule"), kind="secondary", width=170, height=44).pack(fill="x", pady=(10, 0))
        self._make_button(actions, "Sign Out", self._on_logout, kind="secondary", width=170, height=44).pack(fill="x", pady=(10, 0))
        self._refresh_home_status_summary()

        cards_row = tk.Frame(shell, bg=self.ui["bg"])
        cards_row.pack(fill="x", pady=(0, 18))

        metrics = [
            ("School", session.get("school_name", "") or "Unknown"),
            ("Class", self._format_class_display(session) or "Unknown"),
            ("Messages", self._format_message_count(self._message_count) if self._message_count is not None else "Loading"),
        ]
        for title, value in metrics:
            card = tk.Frame(cards_row, bg=self.ui["panel"], highlightbackground=self.ui["border"], highlightthickness=1, padx=20, pady=18)
            card.pack(side="left", fill="both", expand=True, padx=(0, 12))
            tk.Label(card, text=title, bg=self.ui["panel"], fg=self.ui["muted"], font=("", 10, "bold")).pack(anchor="w")
            tk.Label(card, text=value, bg=self.ui["panel"], fg=self.ui["text"], font=("", 18, "bold"), wraplength=240, justify="left").pack(anchor="w", pady=(10, 0))

        cards_row.winfo_children()[-1].pack_configure(padx=(0, 0))

        lower_row = tk.Frame(shell, bg=self.ui["bg"])
        lower_row.pack(fill="both", expand=True)

        self.today_schedule_card = RoundedPanel(lower_row, bg=self.ui["bg"], fill=self.ui["panel"], outline=self.ui["border"], radius=28, padding=20, width=310)
        self.today_schedule_card.pack(side="left", fill="y", padx=(0, 18))
        today_inner = self.today_schedule_card.inner
        header_row = tk.Frame(today_inner, bg=self.ui["panel"])
        header_row.pack(fill="x")
        tk.Label(header_row, text="Today", bg=self.ui["panel"], fg=self.ui["text"], font=(self.font_family_display, 18, "bold")).pack(anchor="w")
        self.today_schedule_meta = tk.Label(header_row, text="", bg=self.ui["panel"], fg=self.ui["muted"], font=(self.font_family, 11), justify="left")
        self.today_schedule_meta.pack(anchor="w", pady=(6, 0))
        self.today_schedule_list = tk.Frame(today_inner, bg=self.ui["panel"])
        self.today_schedule_list.pack(fill="both", expand=True, pady=(14, 0))
        self._refresh_today_schedule_summary()

        info_frame = tk.Frame(lower_row, bg=self.ui["panel"], highlightbackground=self.ui["border"], highlightthickness=1, padx=24, pady=24)
        info_frame.pack(side="left", fill="both", expand=True)
        tk.Label(info_frame, text="Profile Details", bg=self.ui["panel"], fg=self.ui["text"], font=("", 18, "bold")).pack(anchor="w")
        tk.Label(info_frame, text="A cleaner overview of your current enrollment context.", bg=self.ui["panel"], fg=self.ui["muted"], font=("", 11)).pack(anchor="w", pady=(4, 18))
        details_grid = tk.Frame(info_frame, bg=self.ui["panel"])
        details_grid.pack(fill="x", anchor="w")
        rows = [
            ("学校", session.get("school_name", "")),
            ("校区", session.get("campus_name", "")),
            ("班级", self._format_class_display(session)),
            ("部门", session.get("org_name", "")),
        ]
        if self._message_count is not None:
            rows.append(("消息", self._format_message_count(self._message_count)))
        for i, (label, value) in enumerate(rows):
            tk.Label(details_grid, text=label, bg=self.ui["panel"], fg=self.ui["muted"], font=("", 10, "bold")).grid(row=i, column=0, sticky="w", pady=8, padx=(0, 18))
            tk.Label(details_grid, text=value, bg=self.ui["panel"], fg=self.ui["text"], font=("", 11), wraplength=600, justify="left").grid(row=i, column=1, sticky="w", pady=8)

    # ============================================================
    # 课表页面
    # ============================================================
    def _build_schedule_page(self):
        page = tk.Frame(self.content, bg=self.ui["bg"])
        self.pages["schedule"] = page

        toolbar = tk.Frame(page, bg=self.ui["bg"])
        toolbar.pack(fill="x", pady=(0, 12))
        self._make_button(toolbar, "Refresh Schedule", self._load_schedule, kind="primary", width=176, height=42).pack(side="left")

        self.schedule_card = RoundedPanel(page, bg=self.ui["bg"], fill=self.ui["panel"], outline=self.ui["border"], radius=28, padding=18)
        self.schedule_card.pack(fill="both", expand=True)
        schedule_inner = self.schedule_card.inner
        tk.Label(schedule_inner, text="Weekly Grid", bg=self.ui["panel"], fg=self.ui["text"], font=(self.font_family_display, 18, "bold")).pack(anchor="w")
        tk.Label(schedule_inner, text="Rounded timetable blocks with scroll support when the window gets tight.", bg=self.ui["panel"], fg=self.ui["muted"], font=(self.font_family, 11)).pack(anchor="w", pady=(4, 14))

        self.schedule_canvas = tk.Canvas(schedule_inner, bg=self.ui["panel"], highlightthickness=0, bd=0)
        self.schedule_canvas.pack(side="left", fill="both", expand=True)
        self.schedule_v_scroll = ttk.Scrollbar(schedule_inner, orient="vertical", command=self.schedule_canvas.yview, style="App.Vertical.TScrollbar")
        self.schedule_v_scroll.pack(side="right", fill="y")
        self.schedule_h_scroll = ttk.Scrollbar(schedule_inner, orient="horizontal", command=self.schedule_canvas.xview, style="App.Horizontal.TScrollbar")
        self.schedule_h_scroll.pack(fill="x", pady=(10, 0))
        self.schedule_canvas.configure(yscrollcommand=self.schedule_v_scroll.set, xscrollcommand=self.schedule_h_scroll.set)
        self.schedule_frame = tk.Frame(self.schedule_canvas, bg=self.ui["panel"])
        self.schedule_window = self.schedule_canvas.create_window((0, 0), window=self.schedule_frame, anchor="nw")
        self.schedule_frame.bind("<Configure>", lambda event: self.schedule_canvas.configure(scrollregion=self.schedule_canvas.bbox("all")))

    def _display_schedule(self, schedule, time_slots):
        self._schedule_cache = schedule or {}
        self._schedule_time_slots = time_slots or {}
        for w in self.schedule_frame.winfo_children():
            w.destroy()

        headers = ["节次", "周一", "周二", "周三", "周四", "周五"]
        ROW_HEIGHT = 82
        HEADER_BG = self.ui["panel_alt"]
        EMPTY_BG = self.ui["panel"]
        now_marker = self._get_current_schedule_marker(time_slots, schedule)

        self.schedule_frame.columnconfigure(0, weight=0)
        for c in range(1, 6):
            self.schedule_frame.columnconfigure(c, weight=1)

        for i, text in enumerate(headers):
            header = RoundedPanel(self.schedule_frame, bg=self.ui["panel"], fill=HEADER_BG, outline=self.ui["border"], radius=18, padding=0, height=50, width=184 if i else 128)
            header.grid(row=0, column=i, sticky="nsew", padx=6, pady=(0, 10))
            tk.Label(header.inner, text=text, font=(self.font_family, 10, "bold"), relief="flat", borderwidth=0, bg=HEADER_BG, fg=self.ui["muted"], anchor="center").pack(fill="both", expand=True)

        for lesson in range(9):
            row_idx = lesson + 1

            time_str = time_slots.get(lesson, "")
            if not time_str:
                for day in range(1, 6):
                    if lesson in schedule.get(day, {}):
                        time_str = schedule[day][lesson]["time"]
                        break

            time_cell = RoundedPanel(self.schedule_frame, bg=self.ui["panel"], fill=self.ui["panel_alt"], outline=self.ui["border"], radius=20, padding=0, height=ROW_HEIGHT, width=128)
            time_cell.grid(row=row_idx, column=0, sticky="nsew", padx=6, pady=6)
            time_fill = "#fff1ef" if now_marker and now_marker["lesson"] == lesson else self.ui["panel_alt"]
            time_cell.fill = time_fill
            time_cell.inner.config(bg=time_fill)
            time_cell._redraw()
            tk.Label(time_cell.inner, text=time_str or "-", font=(self.font_family, 9), relief="flat", borderwidth=0, bg=time_fill, fg="#ff3b30" if now_marker and now_marker["lesson"] == lesson else self.ui["muted"], anchor="center", justify="center").pack(fill="both", expand=True)
            if now_marker and now_marker["lesson"] == lesson:
                tk.Label(time_cell.inner, text="现在" if not now_marker.get("preview") else "演示", bg=time_fill, fg="#ff3b30", font=(self.font_family, 9, "bold")).place(relx=0.5, rely=0.72, anchor="center")

            for day in range(1, 6):
                slot = schedule.get(day, {}).get(lesson, {"courses": []})
                is_current = bool(now_marker and now_marker["lesson"] == lesson and now_marker["day"] == day)
                cell_fill = "#fff1ef" if is_current else (self.ui["panel_alt"] if slot["courses"] else EMPTY_BG)
                cell = RoundedPanel(self.schedule_frame, bg=self.ui["panel"], fill=cell_fill, outline=self.ui["border"], radius=22, padding=8, height=ROW_HEIGHT, width=184)
                cell.grid(row=row_idx, column=day, sticky="nsew", padx=6, pady=6)
                wrap = cell.inner

                if slot["courses"]:
                    for c in slot["courses"]:
                        color = c.get("color", "#666")
                        name = c["name"]
                        teacher = c["teacher"]
                        room = c["room"]
                        detail = f"{teacher} {room}".strip()
                        text = f"{name}\n{detail}" if detail else name
                        active_color = "#ff7a70" if is_current else color
                        pill = RoundedPanel(wrap, bg=cell_fill, fill=active_color, outline=active_color, radius=18, padding=10, height=62)
                        pill.pack(fill="both", expand=True)
                        lbl = tk.Label(pill.inner, text=text, font=(self.font_family, 9, "bold"), anchor="center",
                                      bg=active_color, fg="white", wraplength=140, justify="center")
                        lbl.pack(fill="both", expand=True)
                else:
                    tk.Label(wrap, text="Free", font=(self.font_family, 9), bg=cell_fill, fg="#c0c4cc").pack(expand=True)
                if is_current:
                    tag_text = "现在" if not now_marker.get("preview") else "演示"
                    tk.Label(wrap, text=tag_text, bg=cell_fill, fg="#ff3b30", font=(self.font_family, 9, "bold")).place(x=8, y=6)
        self.schedule_canvas.update_idletasks()
        self.schedule_canvas.configure(scrollregion=self.schedule_canvas.bbox("all"))
        self._refresh_today_schedule_summary()
        self._refresh_home_status_summary()

    # ============================================================
    # 作业页面
    # ============================================================
    def _build_homework_page(self):
        page = tk.Frame(self.content, bg=self.ui["bg"])
        self.pages["homework"] = page

        top_card = RoundedPanel(page, bg=self.ui["bg"], fill=self.ui["panel"], outline=self.ui["border"], radius=28, padding=18, height=126)
        top_card.pack(fill="x", pady=(0, 14))
        tk.Label(top_card.inner, text="Homework Studio", bg=self.ui["panel"], fg=self.ui["text"], font=(self.font_family_display, 18, "bold")).pack(anchor="w")
        tk.Label(top_card, text="按科目切换，在同一页里查看这门课的全部作业。", bg=self.ui["panel"], fg=self.ui["muted"], font=("", 11)).pack(anchor="w", pady=(4, 14))

        top_actions = tk.Frame(top_card.inner, bg=self.ui["panel"])
        top_actions.pack(fill="x")
        tk.Label(top_actions, text="成绩筛选", bg=self.ui["panel"], fg=self.ui["muted"], font=("", 10, "bold")).pack(side="left")
        self.score_filter = ttk.Combobox(top_actions, values=["全部", "仅 E+", "仅待点评", "仅已评分"], state="readonly", width=12)
        self.score_filter.configure(style="App.TCombobox")
        self.score_filter.pack(side="left", padx=8)
        self.score_filter.set("全部")
        self.score_filter.bind("<<ComboboxSelected>>", lambda event: self._refresh_homework_view())
        self._make_button(top_actions, "Refresh", self._load_homework, kind="secondary", width=120, height=40).pack(side="right")

        body = tk.Frame(page, bg=self.ui["bg"])
        body.pack(fill="both", expand=True)
        self.homework_body = body

        self.homework_subject_panel = RoundedPanel(body, bg=self.ui["bg"], fill=self.ui["panel"], outline=self.ui["border"], radius=28, padding=12, width=220)
        self.homework_subject_panel.pack(side="left", fill="y", padx=(0, 14))
        subject_panel = self.homework_subject_panel.inner
        tk.Label(subject_panel, text="科目", bg=self.ui["panel"], fg=self.ui["text"], font=("", 16, "bold")).pack(anchor="w")
        tk.Label(subject_panel, text="每门课分开查看", bg=self.ui["panel"], fg=self.ui["muted"], font=("", 10)).pack(anchor="w", pady=(4, 12))
        self.homework_subjects_canvas = tk.Canvas(subject_panel, bg=self.ui["panel"], highlightthickness=0, bd=0, width=196)
        self.homework_subjects_canvas.pack(side="left", fill="both", expand=True)
        self.homework_subjects_scrollbar = ttk.Scrollbar(subject_panel, orient="vertical", command=self.homework_subjects_canvas.yview, style="App.Vertical.TScrollbar")
        self.homework_subjects_scrollbar.pack(side="right", fill="y")
        self.homework_subjects_canvas.configure(yscrollcommand=self.homework_subjects_scrollbar.set)
        self.homework_subjects_wrap = tk.Frame(self.homework_subjects_canvas, bg=self.ui["panel"])
        self.homework_subjects_window = self.homework_subjects_canvas.create_window((0, 0), window=self.homework_subjects_wrap, anchor="nw")
        self.homework_subjects_wrap.bind("<Configure>", lambda event: self.homework_subjects_canvas.configure(scrollregion=self.homework_subjects_canvas.bbox("all")))
        self.homework_subjects_canvas.bind("<Configure>", lambda event: self.homework_subjects_canvas.itemconfigure(self.homework_subjects_window, width=event.width))

        self.homework_center_panel = RoundedPanel(body, bg=self.ui["bg"], fill=self.ui["panel"], outline=self.ui["border"], radius=28, padding=14)
        self.homework_center_panel.pack(side="left", fill="both", expand=True, padx=(0, 14))
        center_panel = self.homework_center_panel.inner
        self.homework_header_var = tk.StringVar(value="全部课程")
        tk.Label(center_panel, textvariable=self.homework_header_var, bg=self.ui["panel"], fg=self.ui["text"], font=("", 16, "bold")).pack(anchor="w")
        self.homework_subheader_var = tk.StringVar(value="选择左侧科目后，这里会显示这门课的作业。")
        tk.Label(center_panel, textvariable=self.homework_subheader_var, bg=self.ui["panel"], fg=self.ui["muted"], font=("", 10)).pack(anchor="w", pady=(4, 12))

        tabs_row = tk.Frame(center_panel, bg=self.ui["panel"])
        tabs_row.pack(fill="x", pady=(0, 10))
        self.homework_tab_btn = self._make_button(tabs_row, "作业", lambda: self._set_homework_view_mode("homework"), kind="active", width=110, height=38)
        self.homework_tab_btn.pack(side="left")
        self.gpa_tab_btn = self._make_button(tabs_row, "GPA", lambda: self._set_homework_view_mode("gpa"), kind="ghost", width=110, height=38)
        self.gpa_tab_btn.pack(side="left", padx=(8, 0))

        action_bar = tk.Frame(center_panel, bg=self.ui["panel"])
        action_bar.pack(fill="x", pady=(0, 10))
        self.detail_btn = self._make_button(action_bar, "View Details", self._show_selected_homework_detail, kind="secondary", width=140, height=40)
        self.detail_btn.config(state="disabled")
        self.detail_btn.pack(side="right")
        self.submit_btn = self._make_button(action_bar, "Submit Homework", self._open_submit_dialog, kind="primary", width=168, height=40)
        self.submit_btn.config(state="disabled")
        self.submit_btn.pack(side="right", padx=(0, 8))

        self.homework_list_canvas = tk.Canvas(center_panel, bg=self.ui["panel"], highlightthickness=0, bd=0)
        self.homework_list_canvas.pack(side="left", fill="both", expand=True)
        self.homework_list_scrollbar = ttk.Scrollbar(center_panel, orient="vertical", command=self.homework_list_canvas.yview, style="App.Vertical.TScrollbar")
        self.homework_list_scrollbar.pack(side="right", fill="y")
        self.homework_list_canvas.configure(yscrollcommand=self.homework_list_scrollbar.set)
        self.homework_list_inner = tk.Frame(self.homework_list_canvas, bg=self.ui["panel"])
        self.homework_list_window = self.homework_list_canvas.create_window((0, 0), window=self.homework_list_inner, anchor="nw")
        self.homework_list_inner.bind("<Configure>", lambda event: self.homework_list_canvas.configure(scrollregion=self.homework_list_canvas.bbox("all")))
        self.homework_list_canvas.bind("<Configure>", lambda event: self.homework_list_canvas.itemconfigure(self.homework_list_window, width=event.width))

        self.submit_center_canvas = tk.Canvas(center_panel, bg=self.ui["panel"], highlightthickness=0, bd=0)
        self.submit_center_scrollbar = ttk.Scrollbar(center_panel, orient="vertical", command=self.submit_center_canvas.yview, style="App.Vertical.TScrollbar")
        self.submit_center_canvas.configure(yscrollcommand=self.submit_center_scrollbar.set)
        self.submit_center_panel = tk.Frame(self.submit_center_canvas, bg=self.ui["panel"], padx=6, pady=6)
        self.submit_center_window = self.submit_center_canvas.create_window((0, 0), window=self.submit_center_panel, anchor="nw")
        self.submit_center_panel.bind("<Configure>", lambda event: self.submit_center_canvas.configure(scrollregion=self.submit_center_canvas.bbox("all")))
        self.submit_center_canvas.bind("<Configure>", lambda event: self.submit_center_canvas.itemconfigure(self.submit_center_window, width=event.width))
        self.submit_center_title = tk.Label(self.submit_center_panel, text="提交作业", bg=self.ui["panel"], fg=self.ui["text"], font=("", 18, "bold"))
        self.submit_center_title.pack(anchor="w")
        self.submit_center_meta = tk.Label(self.submit_center_panel, text="先选中一条作业。", bg=self.ui["panel"], fg=self.ui["muted"], font=("", 10), justify="left", wraplength=700)
        self.submit_center_meta.pack(anchor="w", pady=(6, 12))
        submit_body = tk.Frame(self.submit_center_panel, bg=self.ui["panel"])
        submit_body.pack(fill="both", expand=True)
        tk.Label(submit_body, text="作业内容", bg=self.ui["panel"], fg=self.ui["muted"], font=("", 10, "bold")).pack(anchor="w")
        self.submit_center_detail = tk.Text(submit_body, height=8, wrap="word", bg=self.ui["panel_alt"], fg=self.ui["text"], relief="flat", borderwidth=0, padx=12, pady=12)
        self.submit_center_detail.pack(fill="x", pady=(6, 12))
        self.submit_center_detail.insert("1.0", "点击提交后，这里会显示这份作业的正文。")
        self.submit_center_detail.config(state="disabled")
        teacher_attach = tk.Frame(submit_body, bg=self.ui["panel"])
        teacher_attach.pack(fill="x", pady=(0, 8))
        tk.Label(teacher_attach, text="老师附件", bg=self.ui["panel"], fg=self.ui["muted"], font=("", 10, "bold")).pack(side="left")
        self.submit_teacher_attach_hint = tk.Label(teacher_attach, text="", bg=self.ui["panel"], fg=self.ui["muted"], font=("", 10))
        self.submit_teacher_attach_hint.pack(side="left", padx=(8, 0))
        self._make_button(teacher_attach, "打开附件", self._open_selected_teacher_attachment, kind="secondary", width=110, height=34).pack(side="right")
        self.submit_assignment_file_list = tk.Listbox(submit_body, height=4, bg=self.ui["panel_alt"], fg=self.ui["text"], relief="flat", borderwidth=0)
        self.submit_assignment_file_list.pack(fill="x", pady=(0, 12))
        self.submit_assignment_file_list.bind("<Double-Button-1>", self._open_selected_teacher_attachment)
        tk.Label(submit_body, text="提交说明 / 备注", bg=self.ui["panel"], fg=self.ui["muted"], font=("", 10, "bold")).pack(anchor="w")
        self.submit_center_remark_text = tk.Text(submit_body, height=8, wrap="word", bg=self.ui["panel_alt"], fg=self.ui["text"], relief="flat", borderwidth=0, padx=12, pady=12)
        self.submit_center_remark_text.pack(fill="x", pady=(6, 12))
        submit_attach = tk.Frame(submit_body, bg=self.ui["panel"])
        submit_attach.pack(fill="x", pady=(0, 8))
        tk.Label(submit_attach, text="我的附件", bg=self.ui["panel"], fg=self.ui["muted"], font=("", 10, "bold")).pack(side="left")
        self._make_button(submit_attach, "添加附件", self._add_submit_files, kind="secondary", width=110, height=36).pack(side="left", padx=(8, 0))
        self._make_button(submit_attach, "移除附件", self._remove_selected_submit_file, kind="secondary", width=110, height=36).pack(side="left", padx=(8, 0))
        self.submit_center_file_list = tk.Listbox(submit_body, height=5, bg=self.ui["panel_alt"], fg=self.ui["text"], relief="flat", borderwidth=0)
        self.submit_center_file_list.pack(fill="x")
        tk.Label(self.submit_center_panel, text="可以只写说明，也可以只传附件；两者不能同时为空。", bg=self.ui["panel"], fg=self.ui["muted"], font=("", 10)).pack(anchor="w", pady=(10, 0))
        submit_btns = tk.Frame(self.submit_center_panel, bg=self.ui["panel"])
        submit_btns.pack(fill="x", pady=(14, 0))
        self._make_button(submit_btns, "取消", self._close_submit_panel, kind="secondary", width=96, height=40).pack(side="right")
        self._make_button(submit_btns, "提交作业", self._submit_selected_homework, kind="primary", width=120, height=40).pack(side="right", padx=(0, 8))

        self.homework_hint_var = tk.StringVar(value="选择一条作业后可以查看详情或提交作业。")
        tk.Label(center_panel, textvariable=self.homework_hint_var, anchor="w", bg=self.ui["panel"], fg=self.ui["muted"], font=("", 10)).pack(fill="x", pady=(10, 0))

        self.homework_right_panel = RoundedPanel(body, bg=self.ui["bg"], fill=self.ui["panel"], outline=self.ui["border"], radius=28, padding=18, width=360)
        self.homework_right_panel.pack(side="left", fill="y")
        right_panel = self.homework_right_panel.inner
        tk.Label(right_panel, text="Reading Pane", bg=self.ui["panel"], fg=self.ui["text"], font=("", 16, "bold")).pack(anchor="w")
        tk.Label(right_panel, text="Select an assignment to preview its metadata before opening the full detail view.", bg=self.ui["panel"], fg=self.ui["muted"], font=("", 11), wraplength=300, justify="left").pack(anchor="w", pady=(4, 14))
        self.homework_preview_title = tk.Label(right_panel, text="No Assignment Selected", bg=self.ui["panel"], fg=self.ui["text"], font=("", 18, "bold"), wraplength=300, justify="left")
        self.homework_preview_title.pack(anchor="w")
        self.homework_preview_meta = tk.Label(right_panel, text="Pick a row from the list to see the summary here.", bg=self.ui["panel"], fg=self.ui["muted"], font=("", 11), justify="left", wraplength=300)
        self.homework_preview_meta.pack(anchor="w", pady=(10, 14))
        self.homework_preview_body = tk.Text(right_panel, height=18, wrap="word", bg=self.ui["panel_alt"], fg=self.ui["text"], relief="flat", borderwidth=0, padx=16, pady=16)
        self.homework_preview_body.pack(fill="both", expand=True)
        self.homework_preview_body.insert("1.0", "Assignment previews will appear here.")
        self.homework_preview_body.config(state="disabled")
        self.root.after_idle(self._update_responsive_layout)

        self.submit_inline_panel = tk.Frame(right_panel, bg=self.ui["panel_alt"], highlightbackground=self.ui["border"], highlightthickness=1, padx=14, pady=14)
        tk.Label(self.submit_inline_panel, text="提交这份作业", bg=self.ui["panel_alt"], fg=self.ui["text"], font=("", 14, "bold")).pack(anchor="w")
        self.submit_inline_meta = tk.Label(self.submit_inline_panel, text="先选中一条作业。", bg=self.ui["panel_alt"], fg=self.ui["muted"], font=("", 10), justify="left", wraplength=300)
        self.submit_inline_meta.pack(anchor="w", pady=(4, 10))
        tk.Label(self.submit_inline_panel, text="提交说明 / 备注", bg=self.ui["panel_alt"], fg=self.ui["muted"], font=("", 10, "bold")).pack(anchor="w")
        self.submit_remark_text = tk.Text(self.submit_inline_panel, height=7, wrap="word", bg="#ffffff", fg=self.ui["text"], relief="flat", borderwidth=0)
        self.submit_remark_text.pack(fill="x", pady=(6, 10))
        inline_attach = tk.Frame(self.submit_inline_panel, bg=self.ui["panel_alt"])
        inline_attach.pack(fill="x", pady=(0, 8))
        tk.Label(inline_attach, text="附件", bg=self.ui["panel_alt"], fg=self.ui["muted"], font=("", 10, "bold")).pack(side="left")
        self._make_button(inline_attach, "添加附件", self._add_submit_files, kind="secondary", width=110, height=36).pack(side="left", padx=(8, 0))
        self._make_button(inline_attach, "移除附件", self._remove_selected_submit_file, kind="secondary", width=110, height=36).pack(side="left", padx=(8, 0))
        self.submit_file_list = tk.Listbox(self.submit_inline_panel, height=5, bg="#ffffff", fg=self.ui["text"], relief="flat", borderwidth=0)
        self.submit_file_list.pack(fill="both", expand=False)
        tk.Label(self.submit_inline_panel, text="可以只写说明，也可以只传附件。", bg=self.ui["panel_alt"], fg=self.ui["muted"], font=("", 10)).pack(anchor="w", pady=(8, 0))
        submit_actions = tk.Frame(self.submit_inline_panel, bg=self.ui["panel_alt"])
        submit_actions.pack(fill="x", pady=(12, 0))
        self._make_button(submit_actions, "收起", self._close_submit_panel, kind="secondary", width=96, height=38).pack(side="right")
        self._make_button(submit_actions, "提交作业", self._submit_selected_homework, kind="primary", width=120, height=38).pack(side="right", padx=(0, 8))

    # ============================================================
    # 通知页面
    # ============================================================
    def _build_notice_page(self):
        page = tk.Frame(self.content, bg=self.ui["bg"])
        self.pages["notice"] = page

        top_card = RoundedPanel(page, bg=self.ui["bg"], fill=self.ui["panel"], outline=self.ui["border"], radius=28, padding=18, height=126)
        top_card.pack(fill="x", pady=(0, 14))
        tk.Label(top_card.inner, text="Notice Inbox", bg=self.ui["panel"], fg=self.ui["text"], font=(self.font_family_display, 18, "bold")).pack(anchor="w")
        tk.Label(top_card.inner, text="A calmer split view for messages, with softer spacing and rounded containers.", bg=self.ui["panel"], fg=self.ui["muted"], font=(self.font_family, 11)).pack(anchor="w", pady=(4, 14))
        self._make_button(top_card.inner, "Refresh Notices", self._load_notices, kind="primary", width=168, height=42).pack(anchor="w")

        split = tk.Frame(page, bg=self.ui["bg"])
        split.pack(fill="both", expand=True)

        list_frame = RoundedPanel(split, bg=self.ui["bg"], fill=self.ui["panel"], outline=self.ui["border"], radius=28, padding=14)
        list_frame.pack(side="left", fill="both", expand=True, padx=(0, 14))
        list_inner = list_frame.inner
        tk.Label(list_inner, text="Messages", bg=self.ui["panel"], fg=self.ui["text"], font=(self.font_family_display, 16, "bold")).pack(anchor="w", pady=(0, 10))

        self.notice_tree = ttk.Treeview(list_inner, columns=("sender", "title", "time"), show="headings", height=20, style="App.Treeview")
        self.notice_tree.heading("sender", text="发件人")
        self.notice_tree.heading("title", text="标题")
        self.notice_tree.heading("time", text="时间")
        self.notice_tree.column("sender", width=120)
        self.notice_tree.column("title", width=500)
        self.notice_tree.column("time", width=140)
        self.notice_tree.pack(side="left", fill="both", expand=True)

        notice_scroll = ttk.Scrollbar(list_inner, orient="vertical", command=self.notice_tree.yview, style="App.Vertical.TScrollbar")
        self.notice_tree.configure(yscrollcommand=notice_scroll.set)
        notice_scroll.pack(side="right", fill="y")

        preview = RoundedPanel(split, bg=self.ui["bg"], fill=self.ui["panel"], outline=self.ui["border"], radius=28, padding=18, width=420)
        preview.pack(side="left", fill="y")
        preview_inner = preview.inner
        self.notice_title_label = tk.Label(preview_inner, text="Select a notice", bg=self.ui["panel"], fg=self.ui["text"], font=(self.font_family_display, 20, "bold"), wraplength=360, justify="left")
        self.notice_title_label.pack(anchor="w")
        self.notice_meta_label = tk.Label(preview_inner, text="Sender and date will appear here.", bg=self.ui["panel"], fg=self.ui["muted"], font=(self.font_family, 11), wraplength=360, justify="left")
        self.notice_meta_label.pack(anchor="w", pady=(8, 14))
        self.notice_detail = tk.Text(preview_inner, height=8, wrap="word", font=(self.font_family, 11), state="disabled", bg=self.ui["panel_alt"], relief="flat", borderwidth=0, padx=16, pady=16)
        self.notice_detail.pack(fill="both", expand=True)

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
            self.notice_title_label.config(text=notice["title"] or "Untitled Notice")
            self.notice_meta_label.config(text=f'{notice["sender"] or "Unknown sender"}  •  {notice["time"] or "-"}')
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
                self._call_in_ui(self._display_notices, notices)
            except Exception as e:
                self._call_in_ui(self._set_status, f"加载通知失败：{str(e)}")

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
            self.notice_title_label.config(text=notices[0]["title"] or "Untitled Notice")
            self.notice_meta_label.config(text=f'{notices[0]["sender"] or "Unknown sender"}  •  {notices[0]["time"] or "-"}')
            self.notice_detail.insert("1.0", notices[0]["content"])
            first = self.notice_tree.get_children()
            if first:
                self.notice_tree.selection_set(first[0])
        self.notice_detail.config(state="disabled")

        self._set_status(f"共 {len(notices)} 条通知")

    def _load_message_count(self):
        if not self.logged_in:
            return

        def do_load():
            try:
                count = self.api.get_undo_message_count()
                self._call_in_ui(self._display_message_count, count)
            except Exception:
                pass

        threading.Thread(target=do_load, daemon=True).start()

    def _display_message_count(self, count):
        self._message_count = count
        if self.api.session:
            self._show_user_info(self.api.session)

    # ============================================================
    # 提醒页面
    # ============================================================
    def _build_reminder_page(self):
        page = tk.Frame(self.content, bg=self.ui["bg"])
        self.pages["reminder"] = page

        hero = RoundedPanel(page, bg=self.ui["bg"], fill=self.ui["panel"], outline=self.ui["border"], radius=28, padding=18)
        hero.pack(fill="x", pady=(0, 14))
        tk.Label(hero.inner, text="Reminder Center", bg=self.ui["panel"], fg=self.ui["text"], font=(self.font_family_display, 18, "bold")).pack(anchor="w")
        tk.Label(
            hero.inner,
            text="把系统级提醒、提醒时间和提醒内容集中放在这里。支持固定时刻和循环间隔，适合没有开发环境的普通用户直接使用。",
            bg=self.ui["panel"],
            fg=self.ui["muted"],
            font=(self.font_family, 11),
            wraplength=960,
            justify="left",
        ).pack(anchor="w", pady=(4, 14))

        hero_actions = tk.Frame(hero.inner, bg=self.ui["panel"])
        hero_actions.pack(fill="x")
        self._make_button(hero_actions, "保存提醒设置", self._save_reminder_settings_from_form, kind="primary", width=160, height=42).pack(side="left")
        self._make_button(hero_actions, "立即测试提醒", self._send_test_reminder, kind="secondary", width=150, height=42).pack(side="left", padx=(10, 0))
        self._make_button(hero_actions, "刷新账号数据", self._refresh_reminder_sources, kind="secondary", width=150, height=42).pack(side="left", padx=(10, 0))

        body = tk.Frame(page, bg=self.ui["bg"])
        body.pack(fill="both", expand=True)

        left = RoundedPanel(body, bg=self.ui["bg"], fill=self.ui["panel"], outline=self.ui["border"], radius=28, padding=18, width=420)
        left.pack(side="left", fill="y", padx=(0, 14))
        left_inner = left.inner

        self.reminders_enabled_var = tk.BooleanVar(value=False)
        self.system_notify_var = tk.BooleanVar(value=True)
        self.reminder_mode_var = tk.StringVar(value="daily")
        self.reminder_times_var = tk.StringVar(value="07:20, 18:30, 21:00")
        self.reminder_interval_var = tk.StringVar(value="120")
        self.reminder_window_start_var = tk.StringVar(value="07:00")
        self.reminder_window_end_var = tk.StringVar(value="22:30")
        self.reminder_homework_var = tk.BooleanVar(value=True)
        self.reminder_schedule_var = tk.BooleanVar(value=True)
        self.reminder_notice_var = tk.BooleanVar(value=True)
        self.reminder_only_schooldays_var = tk.BooleanVar(value=False)
        self.reminder_allow_repeat_var = tk.BooleanVar(value=False)

        tk.Label(left_inner, text="总开关", bg=self.ui["panel"], fg=self.ui["text"], font=(self.font_family_display, 16, "bold")).pack(anchor="w")
        ttk.Checkbutton(left_inner, text="启用提醒中心", variable=self.reminders_enabled_var).pack(anchor="w", pady=(10, 4))
        ttk.Checkbutton(left_inner, text="启用系统级通知（Windows / macOS）", variable=self.system_notify_var).pack(anchor="w", pady=(0, 10))

        tk.Label(left_inner, text="提醒方式", bg=self.ui["panel"], fg=self.ui["text"], font=(self.font_family_display, 16, "bold")).pack(anchor="w", pady=(14, 0))
        ttk.Radiobutton(left_inner, text="固定时刻提醒", value="daily", variable=self.reminder_mode_var).pack(anchor="w", pady=(10, 2))
        tk.Label(left_inner, text="时间列表，多个时间用英文逗号分隔，例如 07:20, 12:40, 18:30", bg=self.ui["panel"], fg=self.ui["muted"], font=(self.font_family, 10), wraplength=340, justify="left").pack(anchor="w")
        ttk.Entry(left_inner, textvariable=self.reminder_times_var, width=36).pack(anchor="w", pady=(6, 10))

        ttk.Radiobutton(left_inner, text="循环间隔提醒", value="interval", variable=self.reminder_mode_var).pack(anchor="w", pady=(6, 2))
        interval_row = tk.Frame(left_inner, bg=self.ui["panel"])
        interval_row.pack(fill="x", pady=(6, 0))
        tk.Label(interval_row, text="每隔", bg=self.ui["panel"], fg=self.ui["muted"], font=(self.font_family, 10)).pack(side="left")
        ttk.Entry(interval_row, textvariable=self.reminder_interval_var, width=8).pack(side="left", padx=(8, 8))
        tk.Label(interval_row, text="分钟提醒一次", bg=self.ui["panel"], fg=self.ui["muted"], font=(self.font_family, 10)).pack(side="left")

        window_row = tk.Frame(left_inner, bg=self.ui["panel"])
        window_row.pack(fill="x", pady=(10, 0))
        tk.Label(window_row, text="生效时段", bg=self.ui["panel"], fg=self.ui["muted"], font=(self.font_family, 10)).pack(side="left")
        ttk.Entry(window_row, textvariable=self.reminder_window_start_var, width=8).pack(side="left", padx=(8, 6))
        tk.Label(window_row, text="到", bg=self.ui["panel"], fg=self.ui["muted"], font=(self.font_family, 10)).pack(side="left")
        ttk.Entry(window_row, textvariable=self.reminder_window_end_var, width=8).pack(side="left", padx=(6, 0))

        ttk.Checkbutton(left_inner, text="仅周一到周五提醒", variable=self.reminder_only_schooldays_var).pack(anchor="w", pady=(12, 4))
        ttk.Checkbutton(left_inner, text="允许同一分钟重复提醒一次以上", variable=self.reminder_allow_repeat_var).pack(anchor="w")

        right = RoundedPanel(body, bg=self.ui["bg"], fill=self.ui["panel"], outline=self.ui["border"], radius=28, padding=18)
        right.pack(side="left", fill="both", expand=True)
        right_inner = right.inner

        tk.Label(right_inner, text="提醒内容", bg=self.ui["panel"], fg=self.ui["text"], font=(self.font_family_display, 16, "bold")).pack(anchor="w")
        ttk.Checkbutton(right_inner, text="提醒我看未提交作业", variable=self.reminder_homework_var).pack(anchor="w", pady=(12, 4))
        ttk.Checkbutton(right_inner, text="提醒我看今天课表", variable=self.reminder_schedule_var).pack(anchor="w", pady=4)
        ttk.Checkbutton(right_inner, text="提醒我看老师通知 / 公告", variable=self.reminder_notice_var).pack(anchor="w", pady=4)

        tk.Label(right_inner, text="提示规则说明", bg=self.ui["panel"], fg=self.ui["text"], font=(self.font_family_display, 16, "bold")).pack(anchor="w", pady=(18, 0))
        for line in [
            "固定时刻模式：到点就提醒一次，适合早读、放学、睡前检查。",
            "循环间隔模式：在生效时段内按分钟循环，例如每 90 分钟提醒一次。",
            "作业提醒会优先展示未提交项，课表提醒会展示今天剩余 / 全部课程，通知提醒会展示最近公告标题。",
            "需要先登录账号，提醒中心才能自动拉取作业、课表和通知。",
        ]:
            tk.Label(right_inner, text=f"•  {line}", bg=self.ui["panel"], fg=self.ui["muted"], font=(self.font_family, 10), wraplength=700, justify="left").pack(anchor="w", pady=3)

        tk.Label(right_inner, text="当前状态", bg=self.ui["panel"], fg=self.ui["text"], font=(self.font_family_display, 16, "bold")).pack(anchor="w", pady=(18, 0))
        self.reminder_status_label = tk.Label(
            right_inner,
            text="提醒中心已待命。",
            bg=self.ui["panel_alt"],
            fg=self.ui["text"],
            font=(self.font_family, 11),
            justify="left",
            wraplength=720,
            padx=16,
            pady=16,
        )
        self.reminder_status_label.pack(fill="x", pady=(12, 0))

    def _default_reminder_config(self):
        return {
            "enabled": False,
            "system_notifications": True,
            "mode": "daily",
            "times": ["07:20", "18:30", "21:00"],
            "interval_minutes": 120,
            "active_hours_start": "07:00",
            "active_hours_end": "22:30",
            "include_homework": True,
            "include_schedule": True,
            "include_notice": True,
            "schooldays_only": False,
            "allow_repeat_same_minute": False,
        }

    def _load_reminder_settings(self):
        config = self._default_reminder_config()
        if os.path.exists(REMINDER_SETTINGS_FILE):
            try:
                with open(REMINDER_SETTINGS_FILE, "r", encoding="utf-8") as f:
                    saved = json.load(f)
                if isinstance(saved, dict):
                    config.update(saved)
            except Exception:
                pass
        self.reminder_config = config

    def _apply_reminder_config_to_form(self):
        if not hasattr(self, "reminders_enabled_var"):
            return
        config = self.reminder_config
        self.reminders_enabled_var.set(bool(config.get("enabled")))
        self.system_notify_var.set(bool(config.get("system_notifications", True)))
        self.reminder_mode_var.set(config.get("mode") or "daily")
        self.reminder_times_var.set(", ".join(config.get("times") or []))
        self.reminder_interval_var.set(str(config.get("interval_minutes", 120)))
        self.reminder_window_start_var.set(config.get("active_hours_start") or "07:00")
        self.reminder_window_end_var.set(config.get("active_hours_end") or "22:30")
        self.reminder_homework_var.set(bool(config.get("include_homework", True)))
        self.reminder_schedule_var.set(bool(config.get("include_schedule", True)))
        self.reminder_notice_var.set(bool(config.get("include_notice", True)))
        self.reminder_only_schooldays_var.set(bool(config.get("schooldays_only")))
        self.reminder_allow_repeat_var.set(bool(config.get("allow_repeat_same_minute")))
        self._update_reminder_status_card("提醒设置已加载。")

    def _save_reminder_settings_from_form(self):
        try:
            config = self._collect_reminder_config_from_form()
        except ValueError as exc:
            messagebox.showwarning("提醒设置", str(exc))
            return

        self.reminder_config = config
        try:
            with open(REMINDER_SETTINGS_FILE, "w", encoding="utf-8") as f:
                json.dump(config, f, ensure_ascii=False, indent=2)
        except Exception as exc:
            messagebox.showerror("保存失败", str(exc))
            return

        self._last_reminder_keys.clear()
        self._update_reminder_status_card("提醒设置已保存，新的规则会自动生效。")
        self._set_status("提醒设置已保存")

    def _collect_reminder_config_from_form(self):
        times = self._parse_reminder_times(self.reminder_times_var.get())
        interval = self._parse_positive_int(self.reminder_interval_var.get(), "循环分钟数")
        start_time = self._normalize_time_text(self.reminder_window_start_var.get(), "循环开始时间")
        end_time = self._normalize_time_text(self.reminder_window_end_var.get(), "循环结束时间")
        mode = self.reminder_mode_var.get().strip() or "daily"

        if mode == "daily" and not times:
            raise ValueError("固定时刻模式至少需要填写一个提醒时间。")
        if mode == "interval" and interval <= 0:
            raise ValueError("循环分钟数必须大于 0。")
        if not (self.reminder_homework_var.get() or self.reminder_schedule_var.get() or self.reminder_notice_var.get()):
            raise ValueError("至少勾选一种提醒内容。")

        return {
            "enabled": bool(self.reminders_enabled_var.get()),
            "system_notifications": bool(self.system_notify_var.get()),
            "mode": mode,
            "times": times,
            "interval_minutes": interval,
            "active_hours_start": start_time,
            "active_hours_end": end_time,
            "include_homework": bool(self.reminder_homework_var.get()),
            "include_schedule": bool(self.reminder_schedule_var.get()),
            "include_notice": bool(self.reminder_notice_var.get()),
            "schooldays_only": bool(self.reminder_only_schooldays_var.get()),
            "allow_repeat_same_minute": bool(self.reminder_allow_repeat_var.get()),
        }

    def _parse_reminder_times(self, text):
        values = []
        for raw in str(text or "").split(","):
            item = raw.strip()
            if not item:
                continue
            values.append(self._normalize_time_text(item, "提醒时间"))
        return values

    def _parse_positive_int(self, value, label):
        try:
            number = int(str(value).strip())
        except Exception:
            raise ValueError(f"{label}必须是整数。")
        return number

    def _normalize_time_text(self, value, label):
        text = str(value or "").strip()
        if not re.fullmatch(r"\d{1,2}:\d{2}", text):
            raise ValueError(f"{label}格式应为 HH:MM，例如 07:20。")
        hour, minute = [int(part) for part in text.split(":", 1)]
        if hour < 0 or hour > 23 or minute < 0 or minute > 59:
            raise ValueError(f"{label}超出正常时间范围。")
        return f"{hour:02d}:{minute:02d}"

    def _time_text_to_minutes(self, value):
        hour, minute = [int(part) for part in str(value).split(":", 1)]
        return hour * 60 + minute

    def _schedule_reminder_tick(self):
        self._reminder_job = None
        try:
            self._run_reminder_tick()
        finally:
            self._reminder_job = self.root.after(60000, self._schedule_reminder_tick)

    def _run_reminder_tick(self):
        config = self.reminder_config or {}
        now = datetime.now()
        minute_key = now.strftime("%Y-%m-%d %H:%M")
        self._last_reminder_keys = {key for key in self._last_reminder_keys if key.startswith(now.strftime("%Y-%m-%d"))}

        if not config.get("enabled"):
            self._update_reminder_status_card("提醒中心当前关闭。")
            return
        if not self.logged_in:
            self._update_reminder_status_card("提醒中心已开启，但需要先登录账号才能拉取作业、课表和通知。")
            return
        if config.get("schooldays_only") and now.isoweekday() > 5:
            self._update_reminder_status_card("今天不是周一到周五，已跳过提醒。")
            return
        if not self._should_trigger_reminder(now, config):
            return
        if (not config.get("allow_repeat_same_minute")) and minute_key in self._last_reminder_keys:
            return
        if self._reminder_running:
            return

        self._reminder_running = True
        self._last_reminder_keys.add(minute_key)
        threading.Thread(target=self._collect_and_send_reminder, args=(minute_key, config), daemon=True).start()

    def _should_trigger_reminder(self, now, config):
        current = now.hour * 60 + now.minute
        mode = config.get("mode") or "daily"
        if mode == "interval":
            start_minutes = self._time_text_to_minutes(config.get("active_hours_start", "07:00"))
            end_minutes = self._time_text_to_minutes(config.get("active_hours_end", "22:30"))
            if current < start_minutes or current > end_minutes:
                return False
            interval = max(int(config.get("interval_minutes", 120)), 1)
            return (current - start_minutes) % interval == 0
        return f"{now.hour:02d}:{now.minute:02d}" in set(config.get("times") or [])

    def _collect_and_send_reminder(self, minute_key, config):
        title = "BXB 提醒"
        lines = []
        status_bits = []
        try:
            if config.get("include_homework"):
                homework = self.api.get_homework(ALL_COURSES_LABEL)
                pending = [h for h in homework if h.get("is_na")]
                signature = "|".join(f"{h.get('course')}::{h.get('name')}" for h in pending[:8])
                if signature != self._last_homework_signature:
                    self._last_homework_signature = signature
                if pending:
                    lines.append(f"未交作业 {len(pending)} 条：")
                    for hw in pending[:3]:
                        lines.append(f"• {hw.get('course') or '-'} - {hw.get('name') or '-'}")
                else:
                    lines.append("未交作业：当前没有待交项目。")
                status_bits.append("作业")

            if config.get("include_schedule"):
                schedule, time_slots = self.api.get_schedule()
                day = datetime.now().isoweekday()
                day_slots = schedule.get(day, {}) if 1 <= day <= 5 else {}
                schedule_items = []
                for lesson in sorted(day_slots.keys()):
                    slot = day_slots.get(lesson, {})
                    courses = slot.get("courses") or []
                    if courses:
                        for course in courses[:2]:
                            schedule_items.append(f"{slot.get('time') or ''} {course.get('name') or '-'}".strip())
                signature = "|".join(schedule_items[:8])
                if signature != self._last_schedule_signature:
                    self._last_schedule_signature = signature
                if schedule_items:
                    lines.append("今日日程：")
                    for item in schedule_items[:3]:
                        lines.append(f"• {item}")
                else:
                    lines.append("今日日程：今天暂无课程安排。")
                self._schedule_cache = schedule
                self._schedule_time_slots = time_slots
                self._call_in_ui(self._refresh_today_schedule_summary)
                status_bits.append("课表")

            if config.get("include_notice"):
                notices = self.api.get_notices()
                signature = "|".join((n.get("title") or "") for n in notices[:5])
                if signature != self._last_notice_signature:
                    self._last_notice_signature = signature
                if notices:
                    lines.append("老师通知：")
                    for notice in notices[:3]:
                        sender = notice.get("sender") or "老师"
                        title_text = notice.get("title") or "未命名通知"
                        lines.append(f"• {sender}: {title_text}")
                else:
                    lines.append("老师通知：当前没有新的公告。")
                self._call_in_ui(self._display_notices, notices)
                status_bits.append("通知")

            body = "\n".join(lines).strip() or "提醒时间到了，记得看一下今天的学习安排。"
            if config.get("system_notifications"):
                self._notify(title, body)
            self._call_in_ui(self._update_reminder_status_card, f"{minute_key} 已发送提醒，内容包含：{' / '.join(status_bits) or '默认提醒'}。")
        except Exception as exc:
            self._call_in_ui(self._update_reminder_status_card, f"{minute_key} 提醒执行失败：{exc}")
        finally:
            self._reminder_running = False

    def _update_reminder_status_card(self, text):
        if hasattr(self, "reminder_status_label"):
            self.reminder_status_label.config(text=text)

    def _send_test_reminder(self):
        try:
            config = self._collect_reminder_config_from_form()
        except ValueError as exc:
            messagebox.showwarning("测试提醒", str(exc))
            return

        parts = []
        if config.get("include_homework"):
            parts.append("作业")
        if config.get("include_schedule"):
            parts.append("今天课表")
        if config.get("include_notice"):
            parts.append("老师通知")
        body = "这是一条测试提醒。\n当前会提醒：" + (" / ".join(parts) if parts else "默认内容")
        if config.get("system_notifications"):
            self._notify("BXB 测试提醒", body)
        self._update_reminder_status_card("测试提醒已触发。")
        self._set_status("测试提醒已触发")

    def _refresh_reminder_sources(self):
        if not self.logged_in:
            messagebox.showinfo("提醒中心", "请先登录账号，再刷新作业、课表和通知。")
            return
        self._set_status("正在刷新提醒所需数据...")
        self._update_reminder_status_card("正在刷新提醒所需数据...")

        def do_refresh():
            try:
                homework = self.api.get_homework(ALL_COURSES_LABEL)
                schedule, time_slots = self.api.get_schedule()
                notices = self.api.get_notices()
                self._call_in_ui(self._display_homework, homework)
                self._call_in_ui(self._display_schedule, schedule, time_slots)
                self._call_in_ui(self._display_notices, notices)
                self._call_in_ui(self._update_reminder_status_card, "提醒所需数据已刷新。")
                self._call_in_ui(self._set_status, "提醒所需数据已刷新")
            except Exception as exc:
                self._call_in_ui(self._update_reminder_status_card, f"刷新失败：{exc}")
                self._call_in_ui(self._set_status, f"刷新失败：{exc}")

        threading.Thread(target=do_refresh, daemon=True).start()

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
                self._call_in_ui(self._on_login_success, session)
            except Exception as e:
                self._call_in_ui(self._on_login_error, str(e))

        threading.Thread(target=do_login, daemon=True).start()

    def _on_login_success(self, session):
        self.logged_in = True
        self.login_btn.config(state="disabled")
        self.logout_btn.config(state="normal")

        name = session["user_name"]
        self._set_status(f"✅ 已登录：{name}")
        self.root.title(f"{WINDOW_TITLE} - {name}")
        self.topbar_user_badge.config(text=f"{name}  •  Signed In", bg=self.ui["panel"], fg=self.ui["text"])

        # 更新主页显示用户信息
        self._show_user_info(session)

        courses = self.api.get_courses()
        course_names = [c["name"] for c in courses["courses"]]
        self._populate_homework_subjects(course_names)
        self._homework_subject = ALL_COURSES_LABEL
        self.homework_header_var.set(ALL_COURSES_LABEL)
        self.homework_subheader_var.set("显示全部课程的作业")

        # 自动加载
        self._load_homework()
        self._load_schedule()
        self._load_notices()
        self._load_message_count()
        self._update_reminder_status_card("已登录。提醒中心会按你的设置自动检查作业、课表和通知。")

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
        self._homework_cache = []
        self._homework_by_item = {}
        self._selected_homework = None
        self._submit_files = []
        self._message_count = None

        self.login_btn.config(state="normal")
        self.logout_btn.config(state="disabled")
        self.root.title(WINDOW_TITLE)
        self._set_status(f"已退出 · v{APP_VERSION}")
        self.topbar_user_badge.config(text="Not Signed In", bg=self.ui["panel"], fg=self.ui["muted"])

        for widget in self.homework_list_inner.winfo_children():
            widget.destroy()
        for widget in self.homework_subjects_wrap.winfo_children():
            widget.destroy()
        for w in self.schedule_frame.winfo_children():
            w.destroy()
        for item in self.notice_tree.get_children():
            self.notice_tree.delete(item)

        self._update_reminder_status_card("已退出登录。提醒中心会在你重新登录后继续工作。")
        self._show_login_form()
        self._show_page("home")

    # ============================================================
    # 加载数据
    # ============================================================
    def _load_homework(self):
        if not self.logged_in:
            return
        course = self._homework_subject or ALL_COURSES_LABEL

        self._set_status("正在加载作业...")

        def do_load():
            try:
                homework = self.api.get_homework(course)
                self._call_in_ui(self._display_homework, homework)
            except Exception as e:
                self._call_in_ui(self._set_status, f"加载失败：{str(e)}")

        threading.Thread(target=do_load, daemon=True).start()

    def _display_homework(self, homework):
        self._homework_cache = homework
        self._homework_subject_loading = False
        self._refresh_homework_view()
        self._refresh_home_status_summary()

    def _populate_homework_subjects(self, course_names):
        for widget in self.homework_subjects_wrap.winfo_children():
            widget.destroy()
        self._homework_subject_buttons = {}

        subjects = [ALL_COURSES_LABEL] + list(course_names)
        for subject in subjects:
            btn = self._make_button(
                self.homework_subjects_wrap,
                subject,
                lambda s=subject: self._set_homework_subject(s),
                kind="active" if subject == self._homework_subject else "ghost",
                width=180,
                height=42,
            )
            btn.pack(fill="x", pady=4)
            self._homework_subject_buttons[subject] = btn

    def _set_homework_subject(self, subject):
        if subject == self._homework_subject and self._homework_cache:
            self._refresh_homework_view()
            return
        self._homework_subject = subject
        self._homework_subject_loading = True
        for name, btn in self._homework_subject_buttons.items():
            btn.config(kind="active" if name == subject else "ghost")
        self._selected_homework = None
        self.homework_header_var.set(subject)
        self.homework_subheader_var.set("正在切换科目并刷新作业...")
        self.homework_hint_var.set("正在加载当前科目的作业...")
        self.submit_btn.config(state="disabled")
        self.detail_btn.config(state="disabled")
        for widget in self.homework_list_inner.winfo_children():
            widget.destroy()
        self._load_homework()

    def _set_homework_view_mode(self, mode):
        self._homework_view_mode = mode
        self.homework_tab_btn.config(kind="active" if mode == "homework" else "ghost")
        self.gpa_tab_btn.config(kind="active" if mode == "gpa" else "ghost")
        self._refresh_homework_view()

    def _on_window_resize(self, event):
        if event.widget is not self.root:
            return
        self.root.after_idle(self._update_responsive_layout)

    def _update_responsive_layout(self):
        if not hasattr(self, "homework_body"):
            return
        width = self.root.winfo_width()
        if width < 1380:
            self._repack_homework_layout(vertical=True)
        else:
            self._repack_homework_layout(vertical=False)
        if hasattr(self, "schedule_canvas") and hasattr(self, "schedule_window"):
            self.schedule_canvas.itemconfigure(self.schedule_window, width=max(self.schedule_canvas.winfo_width() - 4, 760))
            self.schedule_canvas.configure(scrollregion=self.schedule_canvas.bbox("all"))

    def _repack_homework_layout(self, vertical=False):
        if not all(hasattr(self, name) for name in ("homework_subject_panel", "homework_center_panel", "homework_right_panel")):
            return
        for widget in (self.homework_subject_panel, self.homework_center_panel, self.homework_right_panel):
            widget.pack_forget()
        if vertical:
            self.homework_subject_panel.pack(fill="x", pady=(0, 14))
            self.homework_center_panel.pack(fill="both", expand=True, pady=(0, 14))
            self.homework_right_panel.pack(fill="x")
        else:
            self.homework_subject_panel.pack(side="left", fill="y", padx=(0, 14))
            self.homework_center_panel.pack(side="left", fill="both", expand=True, padx=(0, 14))
            self.homework_right_panel.pack(side="left", fill="y")

    def _get_current_schedule_marker(self, time_slots, schedule):
        now = datetime.now()
        day = now.isoweekday()
        if day < 1 or day > 5:
            return None
        current_minutes = now.hour * 60 + now.minute

        for lesson in range(9):
            time_str = (time_slots or {}).get(lesson)
            if not time_str:
                slot = (schedule or {}).get(day, {}).get(lesson, {})
                time_str = slot.get("time") or ""
            if "-" not in time_str:
                continue
            try:
                start_str, end_str = time_str.split("-", 1)
                start_hour, start_minute = [int(x) for x in start_str.split(":")]
                end_hour, end_minute = [int(x) for x in end_str.split(":")]
            except Exception:
                continue
            start_minutes = start_hour * 60 + start_minute
            end_minutes = end_hour * 60 + end_minute
            if start_minutes <= current_minutes <= end_minutes and end_minutes > start_minutes:
                progress = (current_minutes - start_minutes) / float(end_minutes - start_minutes)
                return {"day": day, "lesson": lesson, "progress": progress}
        return None

    def _refresh_today_schedule_summary(self):
        if not hasattr(self, "today_schedule_list"):
            return

        for widget in self.today_schedule_list.winfo_children():
            widget.destroy()

        now = datetime.now()
        day = now.isoweekday()
        day_names = {1: "周一", 2: "周二", 3: "周三", 4: "周四", 5: "周五", 6: "周六", 7: "周日"}
        self.today_schedule_meta.config(text=f"{now.month}/{now.day} {day_names.get(day, '')}")

        if day < 1 or day > 5 or not self._schedule_cache:
            tk.Label(self.today_schedule_list, text="今天没有课，或者课表还没加载完成。", bg=self.ui["panel"], fg=self.ui["muted"], font=(self.font_family, 11)).pack(anchor="w")
            return

        now_marker = self._get_current_schedule_marker(self._schedule_time_slots, self._schedule_cache)
        today_slots = self._schedule_cache.get(day, {})
        visible = []
        for lesson in sorted(today_slots.keys()):
            slot = today_slots.get(lesson, {})
            courses = slot.get("courses") or []
            if courses:
                visible.append((lesson, slot))

        if not visible:
            tk.Label(self.today_schedule_list, text="今天没有安排课程。", bg=self.ui["panel"], fg=self.ui["muted"], font=(self.font_family, 11)).pack(anchor="w")
            return

        for lesson, slot in visible[:6]:
            is_current = bool(now_marker and now_marker["day"] == day and now_marker["lesson"] == lesson)
            card_fill = "#fff1ef" if is_current else self.ui["panel_alt"]
            card = RoundedPanel(self.today_schedule_list, bg=self.ui["panel"], fill=card_fill, outline=self.ui["border"], radius=18, padding=12, height=82)
            card.pack(fill="x", pady=(0, 8))
            wrap = card.inner
            course = slot["courses"][0]
            title = tk.Label(wrap, text=course.get("name") or "课程", bg=card_fill, fg=self.ui["text"], font=(self.font_family, 11, "bold"), justify="left", wraplength=230)
            title.pack(anchor="w")
            detail = f"{slot.get('time') or '-'}\n{((course.get('teacher') or '').strip() + ' ' + (course.get('room') or '')).strip()}".strip()
            tk.Label(wrap, text=detail, bg=card_fill, fg=self.ui["muted"], font=(self.font_family, 10), justify="left", wraplength=230).pack(anchor="w", pady=(4, 0))
            if is_current:
                tk.Label(wrap, text="现在", bg=card_fill, fg="#ff3b30", font=(self.font_family, 9, "bold")).place(x=8, y=8)

    def _refresh_home_status_summary(self):
        if not hasattr(self, "home_status_summary"):
            return

        session = self.api.session or {}
        name = session.get("user_name") or "你"
        risk_count = len([
            hw for hw in self._homework_cache
            if str(hw.get("score")) == "E+" or (hw.get("is_na") and str(hw.get("score")) not in {"N/A", "n/a"})
        ])
        current_course = self._get_current_course_status()

        if current_course:
            room = current_course.get("room") or "教室待定"
            course_name = current_course.get("name") or "当前课程"
            self.home_status_summary.config(
                text=f"{name}，你现在有去{room}的{course_name}课，这门课你还有{risk_count}次作业未提交或E+。"
            )
            self.home_status_hint.config(
                text=f"当前时段：{current_course.get('time') or '-'}"
            )
            return

        self.home_status_summary.config(
            text=f"{name}，你现在没有课，但是有{risk_count}次作业未提交或E+,请前往作业页面查看。"
        )
        self.home_status_hint.config(
            text="切到 Homework 页面可以直接处理这些作业。"
        )

    def _get_current_course_status(self):
        now = datetime.now()
        day = now.isoweekday()
        if day < 1 or day > 5:
            return None
        current_minutes = now.hour * 60 + now.minute

        for lesson, slot in sorted((self._schedule_cache.get(day) or {}).items()):
            time_str = slot.get("time") or (self._schedule_time_slots.get(lesson) or "")
            if "-" not in time_str:
                continue
            try:
                start_str, end_str = time_str.split("-", 1)
                start_hour, start_minute = [int(x) for x in start_str.split(":")]
                end_hour, end_minute = [int(x) for x in end_str.split(":")]
            except Exception:
                continue
            start_minutes = start_hour * 60 + start_minute
            end_minutes = end_hour * 60 + end_minute
            if start_minutes <= current_minutes <= end_minutes:
                courses = slot.get("courses") or []
                if courses:
                    course = courses[0]
                    return {
                        "name": course.get("name") or "",
                        "room": course.get("room") or "",
                        "teacher": course.get("teacher") or "",
                        "time": time_str,
                    }
        return None

    def _create_homework_card(self, hw, index):
        card_bg = self.ui["panel_alt"]
        panel = RoundedPanel(
            self.homework_list_inner,
            bg=self.ui["panel"],
            fill=card_bg,
            outline=self.ui["border"],
            radius=20,
            padding=14,
            height=96,
        )
        panel.pack(fill="x", pady=(0, 10))
        card = panel.inner

        color_block = tk.Frame(card, bg=self.ui["accent"], width=28, height=54)
        color_block.pack(side="left", padx=(0, 12), pady=2)
        color_block.pack_propagate(False)

        middle = tk.Frame(card, bg=card_bg)
        middle.pack(side="left", fill="both", expand=True)
        title_row = tk.Frame(middle, bg=card_bg)
        title_row.pack(fill="x")
        title = tk.Label(title_row, text=hw["name"], bg=card_bg, fg=self.ui["text"], font=(self.font_family, 13, "bold"), anchor="w", justify="left")
        title.pack(side="left", anchor="w")

        tag_text = hw.get("type") or "作业"
        tag = tk.Label(title_row, text=tag_text, bg=self.ui["accent_soft"], fg=self.ui["accent"], font=(self.font_family, 9, "bold"), padx=8, pady=4)
        tag.pack(side="left", padx=(10, 0))

        meta = tk.Label(
            middle,
            text=f"{hw.get('course') or '-'}  发布于 {hw.get('publish_time') or '-'}    截止时间：{hw.get('deadline') or '-'}",
            bg=card_bg,
            fg=self.ui["muted"],
            font=(self.font_family, 10),
            anchor="w",
            justify="left",
        )
        meta.pack(fill="x", pady=(6, 0))

        score_color = self.ui["danger"] if str(hw.get("score")) == "E+" else self.ui["muted"]
        score = tk.Label(card, text=str(hw.get("score") or "-"), bg=card_bg, fg=score_color, font=(self.font_family_display, 18, "bold"))
        score.pack(side="right", padx=(12, 0))

        labels = [middle, title_row, title, tag, meta, score]
        for widget in [panel, card, color_block] + labels:
            widget.bind("<Button-1>", lambda event, item=hw: self._on_homework_select(item))
            widget.bind("<Double-1>", lambda event, item=hw: [self._on_homework_select(item), self._show_selected_homework_detail()])

        self._homework_card_widgets[id(hw)] = {"homework": hw, "frame": panel, "inner": card, "labels": labels, "color_block": color_block}

    def _create_gpa_card(self, title, value, subtitle="", accent=None):
        card = RoundedPanel(
            self.homework_list_inner,
            bg=self.ui["panel"],
            fill=self.ui["panel_alt"],
            outline=self.ui["border"],
            radius=20,
            padding=18,
            height=110,
        )
        card.pack(fill="x", pady=(0, 10))
        wrap = card.inner
        tk.Label(wrap, text=title, bg=self.ui["panel_alt"], fg=self.ui["muted"], font=(self.font_family, 10, "bold")).pack(anchor="w")
        tk.Label(wrap, text=value, bg=self.ui["panel_alt"], fg=accent or self.ui["text"], font=(self.font_family_display, 24, "bold")).pack(anchor="w", pady=(8, 2))
        if subtitle:
            tk.Label(wrap, text=subtitle, bg=self.ui["panel_alt"], fg=self.ui["muted"], font=(self.font_family, 10), justify="left", wraplength=540).pack(anchor="w")

    def _render_gpa_view(self, homework):
        graded = [hw for hw in homework if not hw.get("is_na")]
        pending = [hw for hw in homework if hw.get("is_na")]
        academic_scores = [float(hw.get("academic_score")) for hw in graded if hw.get("academic_score") not in (None, "")]
        numeric_scores = [float(hw.get("numeric_score")) for hw in graded if hw.get("numeric_score") not in (None, "")]
        avg_academic = f"{sum(academic_scores) / len(academic_scores):.1f}" if academic_scores else "-"
        avg_numeric = f"{sum(numeric_scores) / len(numeric_scores):.1f}" if numeric_scores else "-"
        top_grade = next((g for g in ["A+", "A", "B+", "B", "C+", "C", "E+"] if any(str(hw.get("score")) == g for hw in graded)), "-")

        self._create_gpa_card("Academic Average", avg_academic, "基于当前科目里可见的 academic score 计算。", self.ui["accent"])
        self._create_gpa_card("Numeric Average", avg_numeric, "基于当前科目里可见的 numeric score 计算。", self.ui["text"])
        self._create_gpa_card("Best Visible Grade", top_grade, f"已评分 {len(graded)} 项，待处理 {len(pending)} 项。", self.ui["success"] if top_grade in {"A+", "A"} else self.ui["text"])

        for hw in homework[:12]:
            subtitle = f"成绩：{hw.get('score') or '-'}    发布时间：{hw.get('publish_time') or '-'}"
            self._create_gpa_card(hw["name"], hw.get("course") or "-", subtitle, self.ui["danger"] if str(hw.get("score")) == "E+" else self.ui["text"])

    def _refresh_homework_view(self):
        for widget in self.homework_list_inner.winfo_children():
            widget.destroy()
        self._homework_card_widgets = {}
        self._homework_by_item = {}
        self._selected_homework = None
        self.submit_btn.config(state="disabled")
        self.detail_btn.config(state="disabled")
        self.homework_hint_var.set("选择一条作业后可以查看详情或提交作业。")

        filtered_homework = self._apply_homework_filters(self._homework_cache)

        if self._homework_view_mode == "homework":
            for idx, hw in enumerate(filtered_homework):
                self._create_homework_card(hw, idx)
        else:
            self.homework_hint_var.set("GPA 页面显示这一科的成绩概览。")
            self._render_gpa_view(filtered_homework)

        current_course = (self._homework_subject or "").strip()
        if current_course and current_course != ALL_COURSES_LABEL:
            self._set_status(f"{current_course}：共 {len(filtered_homework)} 条作业")
            self.homework_header_var.set(current_course)
            suffix = "GPA 概览" if self._homework_view_mode == "gpa" else "作业列表"
            self.homework_subheader_var.set(f"当前科目共有 {len(filtered_homework)} 条记录，正在查看{suffix}")
        else:
            self._set_status(f"共 {len(filtered_homework)} 条作业")
            self.homework_header_var.set(ALL_COURSES_LABEL)
            suffix = "GPA 概览" if self._homework_view_mode == "gpa" else "作业列表"
            self.homework_subheader_var.set(f"显示全部课程，共 {len(filtered_homework)} 条记录，正在查看{suffix}")

    def _apply_homework_filters(self, homework):
        score_filter = self.score_filter.get() if hasattr(self, "score_filter") else "全部"
        if score_filter == "仅 E+":
            return [hw for hw in homework if str(hw.get("score")) == "E+"]
        if score_filter == "仅待点评":
            return [hw for hw in homework if str(hw.get("score")) == "待点评"]
        if score_filter == "仅已评分":
            return [hw for hw in homework if str(hw.get("score")) not in {"待点评", "N/A", ""}]
        return homework

    def _on_homework_select(self, hw=None):
        if not hw:
            self._selected_homework = None
            self.submit_btn.config(state="disabled")
            self.detail_btn.config(state="disabled")
            self.homework_hint_var.set("选择一条作业后可以查看详情或提交作业。")
            self._update_homework_preview(None)
            return

        self._selected_homework = hw
        for widgets in self._homework_card_widgets.values():
            selected = widgets["homework"] is hw
            fill = self.ui["accent_soft"] if selected else self.ui["panel_alt"]
            border = self.ui["accent"] if selected else self.ui["border"]
            widgets["frame"].fill = fill
            widgets["frame"].outline = border
            widgets["frame"].inner.config(bg=fill)
            widgets["frame"]._redraw()
            for label in widgets["labels"]:
                try:
                    label.config(bg=fill)
                except Exception:
                    pass
        if hw:
            self.submit_btn.config(state="normal")
            self.detail_btn.config(state="normal")
            suffix = "未提交，支持直接提交。" if hw.get("is_na") else "可再次提交，服务器会决定是否允许。"
            self.homework_hint_var.set(f"已选中：[{hw['course']}] {hw['name']}，{suffix}")
            self._update_homework_preview(hw)

    def _show_selected_homework_detail(self):
        hw = self._selected_homework
        if not hw:
            messagebox.showinfo("提示", "请先选中一条作业")
            return

        self._set_status("正在获取作业详情...")

        def do_load():
            try:
                detail = self.api.get_homework_detail(hw["id"])
                submitted = self.api.get_homework_submitted_list(hw["id"], hw["class_id"])
                last_score = self.api.get_homework_last_score(hw["id"], hw["class_id"])
                self._call_in_ui(self._show_homework_detail_dialog, hw, detail, submitted, last_score)
            except Exception as e:
                self._call_in_ui(messagebox.showerror, "获取详情失败", str(e))
                self._call_in_ui(self._set_status, "获取作业详情失败")

        threading.Thread(target=do_load, daemon=True).start()

    def _show_homework_detail_dialog(self, hw, detail, submitted, last_score):
        dialog = tk.Toplevel(self.root)
        dialog.title(f"作业详情 - {hw['name']}")
        dialog.geometry("760x560")
        dialog.transient(self.root)

        container = ttk.Frame(dialog, padding=12)
        container.pack(fill="both", expand=True)

        info_lines = [
            f"课程：{hw['course']}",
            f"作业：{hw['name']}",
            f"发布时间：{hw.get('publish_time') or '-'}",
            f"截止时间：{hw.get('deadline') or '-'}",
            f"当前成绩：{hw.get('score') or '-'}",
        ]
        ttk.Label(container, text="\n".join(info_lines), justify="left").pack(fill="x", anchor="w")

        detail_box = tk.Text(container, height=16, wrap="word")
        detail_box.pack(fill="both", expand=True, pady=(10, 10))
        detail_box.insert("1.0", self._format_homework_detail_text(detail))
        detail_box.config(state="disabled")

        meta_lines = [
            f"已提交人数记录：{len(submitted)}",
            f"最近成绩接口返回：{last_score if last_score else '暂无'}",
        ]
        teacher_files = detail.get("fileList") or []
        if teacher_files:
            meta_lines.append("老师附件：" + " / ".join((f.get("name") or f.get("fileName") or "未命名附件") for f in teacher_files))
        ttk.Label(container, text="\n".join(meta_lines), justify="left").pack(fill="x", anchor="w")

        btns = ttk.Frame(container)
        btns.pack(fill="x", pady=(10, 0))
        self._make_button(btns, "提交这份作业", lambda: [dialog.destroy(), self._open_submit_dialog()], kind="primary", width=180, height=40).pack(side="left")
        self._make_button(btns, "关闭", dialog.destroy, kind="secondary", width=96, height=40).pack(side="right")
        self._set_status("作业详情加载完成")

    def _open_submit_dialog(self):
        hw = self._selected_homework
        if not hw:
            messagebox.showinfo("提示", "请先选中一条作业")
            return

        if self._submit_dialog and self._submit_dialog.winfo_exists():
            self._submit_dialog.focus_force()
            return

        self._submit_files = []
        dialog = tk.Toplevel(self.root)
        self._submit_dialog = dialog
        dialog.title(f"提交作业 - {hw['name']}")
        dialog.geometry("720x520")
        dialog.transient(self.root)

        container = ttk.Frame(dialog, padding=14)
        container.pack(fill="both", expand=True)

        info = [
            f"课程：{hw['course']}",
            f"作业：{hw['name']}",
            f"截止：{hw.get('deadline') or '-'}",
        ]
        ttk.Label(container, text="\n".join(info), justify="left").pack(fill="x", anchor="w")

        ttk.Label(container, text="提交说明 / 备注：").pack(anchor="w", pady=(10, 4))
        self.submit_remark_text = tk.Text(container, height=10, wrap="word")
        self.submit_remark_text.pack(fill="x")

        attachment_header = ttk.Frame(container)
        attachment_header.pack(fill="x", pady=(10, 4))
        ttk.Label(attachment_header, text="附件：").pack(side="left")
        self._make_button(attachment_header, "添加附件", self._add_submit_files, kind="secondary", width=110, height=36).pack(side="left", padx=(8, 0))
        self._make_button(attachment_header, "移除选中附件", self._remove_selected_submit_file, kind="secondary", width=140, height=36).pack(side="left", padx=(8, 0))

        self.submit_file_list = tk.Listbox(container, height=8)
        self.submit_file_list.pack(fill="both", expand=True)

        note = "可提交文字说明，也可只提交附件；两者不能同时为空。"
        ttk.Label(container, text=note, foreground="#666").pack(fill="x", pady=(8, 0))

        btns = ttk.Frame(container)
        btns.pack(fill="x", pady=(12, 0))
        self._make_button(btns, "取消", dialog.destroy, kind="secondary", width=96, height=40).pack(side="right")
        self._make_button(btns, "提交作业", self._submit_selected_homework, kind="primary", width=120, height=40).pack(side="right", padx=(0, 8))

        dialog.protocol("WM_DELETE_WINDOW", dialog.destroy)

    def _add_submit_files(self):
        file_paths = filedialog.askopenfilenames(parent=self._submit_dialog, title="选择要提交的附件")
        for path in file_paths:
            if path not in self._submit_files:
                self._submit_files.append(path)
                self.submit_center_file_list.insert("end", os.path.basename(path))

    def _remove_selected_submit_file(self):
        selection = list(self.submit_center_file_list.curselection())
        if not selection:
            return
        for idx in reversed(selection):
            del self._submit_files[idx]
            self.submit_center_file_list.delete(idx)

    def _submit_selected_homework(self):
        hw = self._selected_homework
        if not hw:
            messagebox.showinfo("提示", "请先选中一条作业")
            return

        remark = self.submit_center_remark_text.get("1.0", "end").strip()
        if not remark and not self._submit_files:
            messagebox.showwarning("提示", "内容和附件不能都为空")
            return

        if not messagebox.askyesno("确认提交", f"确认提交作业《{hw['name']}》吗？"):
            return

        self._set_status("正在提交作业...")

        def do_submit():
            try:
                self.api.submit_homework(
                    activity_id=hw["id"],
                    class_id=hw["class_id"],
                    remark=remark,
                    file_paths=list(self._submit_files),
                )
                self._call_in_ui(self._on_submit_success)
            except Exception as e:
                self._call_in_ui(self._on_submit_error, str(e))

        threading.Thread(target=do_submit, daemon=True).start()

    def _on_submit_success(self):
        if self._submit_dialog and self._submit_dialog.winfo_exists():
            self._submit_dialog.destroy()
        self._submit_dialog = None
        self._close_submit_panel()
        self._set_status("作业提交成功")
        messagebox.showinfo("提交成功", "作业已提交成功")
        self._load_homework()

    def _on_submit_error(self, error):
        self._set_status("作业提交失败")
        messagebox.showerror("提交失败", error)

    def _open_submit_dialog(self):
        hw = self._selected_homework
        if not hw:
            messagebox.showinfo("提示", "请先选中一条作业")
            return

        self._submit_files = []
        self.submit_center_meta.config(
            text=f"课程：{hw['course']}\n作业：{hw['name']}\n截止：{hw.get('deadline') or '-'}"
        )
        self.submit_center_remark_text.delete("1.0", "end")
        self.submit_center_file_list.delete(0, "end")
        self.submit_assignment_file_list.delete(0, "end")
        self.submit_teacher_attach_hint.config(text="正在加载...")
        self.submit_center_detail.config(state="normal")
        self.submit_center_detail.delete("1.0", "end")
        self.submit_center_detail.insert("1.0", "正在加载作业内容...")
        self.submit_center_detail.config(state="disabled")
        self.homework_list_canvas.pack_forget()
        self.homework_list_scrollbar.pack_forget()
        self.submit_center_canvas.pack(side="left", fill="both", expand=True)
        self.submit_center_scrollbar.pack(side="right", fill="y")
        self.submit_center_canvas.yview_moveto(0)

        def do_load_detail():
            try:
                detail = self.api.get_homework_detail(hw["id"])
                text = self._format_homework_detail_text(detail)
                teacher_files = detail.get("fileList") or []
                self._call_in_ui(self._set_submit_detail_text, text)
                self._call_in_ui(self._set_submit_assignment_files, teacher_files)
            except Exception as e:
                self._call_in_ui(self._set_submit_detail_text, f"加载作业内容失败：{str(e)}")
                self._call_in_ui(self._set_submit_assignment_files, [])

        threading.Thread(target=do_load_detail, daemon=True).start()

    def _close_submit_panel(self):
        self.submit_center_canvas.pack_forget()
        self.submit_center_scrollbar.pack_forget()
        self._submit_files = []
        self.submit_center_file_list.delete(0, "end")
        self.submit_assignment_file_list.delete(0, "end")
        self.submit_teacher_attach_hint.config(text="")
        self.homework_list_canvas.pack(side="left", fill="both", expand=True)
        self.homework_list_scrollbar.pack(side="right", fill="y")

    def _set_submit_detail_text(self, text):
        self.submit_center_detail.config(state="normal")
        self.submit_center_detail.delete("1.0", "end")
        self.submit_center_detail.insert("1.0", text)
        self.submit_center_detail.config(state="disabled")

    def _set_submit_assignment_files(self, files):
        self._submit_assignment_files = list(files or [])
        self.submit_assignment_file_list.delete(0, "end")
        if files:
            self.submit_teacher_attach_hint.config(text=f"{len(files)} 个")
            for file_info in files:
                name = file_info.get("name") or file_info.get("fileName") or "未命名附件"
                size = file_info.get("fileSize")
                suffix = f"  ({self._format_file_size(size)})" if size else ""
                self.submit_assignment_file_list.insert("end", f"{name}{suffix}")
        else:
            self.submit_teacher_attach_hint.config(text="无")
            self.submit_assignment_file_list.insert("end", "这份作业没有老师附件")

    def _format_homework_detail_text(self, detail):
        lines = []
        title = (detail.get("activityName") or "").strip()
        teacher = (detail.get("creatorName") or "").strip()
        content = (detail.get("activityContent") or "").strip()
        if title:
            lines.append(title)
        if teacher:
            lines.append(f"发布老师：{teacher}")
        if lines and content:
            lines.append("")
        if content:
            lines.append(content)
        if detail.get("submitDate"):
            lines.extend(["", f"提交时间：{detail.get('submitDate')}"])
        elif detail.get("endTime"):
            lines.extend(["", f"截止时间：{detail.get('endTime')}"])
        return "\n".join(lines).strip() or "暂无作业内容说明"

    def _format_file_size(self, size_value):
        try:
            size = float(size_value)
        except Exception:
            return str(size_value or "-")
        units = ["B", "KB", "MB", "GB"]
        idx = 0
        while size >= 1024 and idx < len(units) - 1:
            size /= 1024.0
            idx += 1
        return f"{size:.1f} {units[idx]}"

    def _open_selected_teacher_attachment(self, event=None):
        idx = None
        if event is not None and getattr(event, "widget", None) is self.submit_assignment_file_list:
            try:
                idx = self.submit_assignment_file_list.nearest(event.y)
                self.submit_assignment_file_list.selection_clear(0, "end")
                self.submit_assignment_file_list.selection_set(idx)
                self.submit_assignment_file_list.activate(idx)
            except Exception:
                idx = None
        if idx is None:
            selection = list(self.submit_assignment_file_list.curselection())
            if not selection:
                messagebox.showinfo("提示", "请先选中一个老师附件。")
                return
            idx = selection[0]

        files = getattr(self, "_submit_assignment_files", [])
        if idx >= len(files):
            messagebox.showinfo("提示", "这条不是可打开的老师附件。")
            return

        file_info = files[idx]
        name = file_info.get("name") or file_info.get("fileName") or "attachment"
        file_id = file_info.get("fileId")
        if not file_id:
            messagebox.showerror("打开失败", "这个附件缺少 fileId，暂时无法打开。")
            return

        self._set_status(f"正在打开附件：{name}")

        def do_open():
            try:
                download_dir = os.path.join(tempfile.gettempdir(), "banxuebang_teacher_files")
                os.makedirs(download_dir, exist_ok=True)
                target_path = os.path.join(download_dir, name)
                self.api.download_remote_file(file_id, target_path)
                self._call_in_ui(self._open_local_file, target_path)
                self._call_in_ui(self._set_status, f"已打开附件：{name}")
            except Exception as e:
                self._call_in_ui(messagebox.showerror, "打开附件失败", str(e))
                self._call_in_ui(self._set_status, "打开附件失败")

        threading.Thread(target=do_open, daemon=True).start()

    def _open_local_file(self, file_path):
        if sys.platform == "win32":
            os.startfile(file_path)
            return
        if sys.platform == "darwin":
            subprocess.Popen(["open", file_path])
            return
        subprocess.Popen(["xdg-open", file_path])

    def _add_submit_files(self):
        file_paths = filedialog.askopenfilenames(parent=self.root, title="选择要提交的附件")
        for path in file_paths:
            if path not in self._submit_files:
                self._submit_files.append(path)
                self.submit_center_file_list.insert("end", os.path.basename(path))

    def _on_submit_success(self):
        self._close_submit_panel()
        self._submit_dialog = None
        self._submit_files = []
        self._set_status("作业提交成功")
        messagebox.showinfo("提交成功", "作业已提交成功")
        self._load_homework()

    def _load_schedule(self):
        if not self.logged_in:
            return

        self._set_status("正在加载课表...")

        def do_load():
            try:
                schedule, time_slots = self.api.get_schedule()
                self._call_in_ui(self._display_schedule, schedule, time_slots)
                self._call_in_ui(self._set_status, "课表加载完成")
            except Exception as e:
                self._call_in_ui(self._set_status, f"加载课表失败：{str(e)}")

        threading.Thread(target=do_load, daemon=True).start()

    # ============================================================
    # 工具
    # ============================================================
    def _call_in_ui(self, callback, *args, **kwargs):
        self._ui_queue.put((callback, args, kwargs))

    def _drain_ui_queue(self):
        while True:
            try:
                callback, args, kwargs = self._ui_queue.get_nowait()
            except queue.Empty:
                break
            try:
                callback(*args, **kwargs)
            except Exception:
                traceback.print_exc()
        self.root.after(50, self._drain_ui_queue)

    def _set_status(self, text):
        if threading.current_thread() is not threading.main_thread():
            self._call_in_ui(self._set_status, text)
            return
        self.status_var.set(text)
        self.root.update_idletasks()

    def _update_homework_preview(self, hw):
        if not hasattr(self, "homework_preview_title"):
            return
        self.homework_preview_body.config(state="normal")
        self.homework_preview_body.delete("1.0", "end")
        if not hw:
            self.homework_preview_title.config(text="No Assignment Selected")
            self.homework_preview_meta.config(text="Pick a row from the list to see the summary here.")
            self.homework_preview_body.insert("1.0", "Assignment previews will appear here.")
        else:
            self.homework_preview_title.config(text=hw.get("name") or "Untitled Assignment")
            meta = [
                f'Course: {hw.get("course") or "-"}',
                f'Published: {hw.get("publish_time") or "-"}',
                f'Deadline: {hw.get("deadline") or "-"}',
                f'Score: {hw.get("score") or "-"}',
            ]
            self.homework_preview_meta.config(text="\n".join(meta))
            body = [
                f'Type: {hw.get("type") or "-"}',
                f'Letter Grade: {hw.get("score_level") or "-"}',
            ]
            if hw.get("is_na"):
                body.append("Status: Not submitted yet")
            self.homework_preview_body.insert("1.0", "\n".join(body))
        self.homework_preview_body.config(state="disabled")

    def _format_class_display(self, session):
        raw = " ".join([
            session.get("class_alias", "") or "",
            session.get("class_name", "") or "",
        ]).strip()
        if not raw:
            return ""

        grade_match = re.search(r"G\s*(\d{1,2})", raw, flags=re.I)
        grade = f"G{grade_match.group(1)}" if grade_match else None

        track_match = re.search(r"(AP\s*/\s*A-?LEVEL|A-?LEVEL\s*/\s*AP|AP|A-?LEVEL)", raw, flags=re.I)
        track = None
        if track_match:
            text = track_match.group(1).upper().replace(" ", "")
            if "AP" in text and "A-LEVEL" in text:
                track = "AP/A-Level"
            elif text == "AP":
                track = "AP"
            else:
                track = "A-Level"

        group_match = re.search(r"(?:AP|A-?LEVEL|AP\s*/\s*A-?LEVEL)\s*0*(\d{1,2})", raw, flags=re.I)
        if not group_match:
            group_match = re.search(r"[（(]\s*(\d{1,2})\s*[)）]", raw)
        if not group_match:
            group_match = re.search(r"\b0*(\d{1,2})\b", raw)

        group_no = group_match.group(1) if group_match else None

        parts = [p for p in [grade, track, group_no] if p]
        if parts:
            return " ".join(parts)

        return raw

    def _format_message_count(self, count):
        if isinstance(count, dict):
            total = count.get("totalCount")
            unread = count.get("msgUnreadCount")
            process = count.get("processCount")
            parts = []
            if total is not None:
                parts.append(f"总计 {total}")
            if unread is not None:
                parts.append(f"未读 {unread}")
            if process is not None:
                parts.append(f"待处理 {process}")
            return " / ".join(parts) if parts else str(count)
        return str(count)

    def _load_avatar_image(self, avatar_url):
        if not avatar_url:
            return None
        try:
            if avatar_url.startswith("/"):
                avatar_url = f"{BASE}{avatar_url}"
            resp = self.api.http.get(avatar_url, timeout=10)
            resp.raise_for_status()
            encoded = base64.b64encode(resp.content).decode("ascii")
            return tk.PhotoImage(data=encoded)
        except Exception:
            return None

    def _load_saved_creds(self):
        if os.path.exists(CREDENTIALS_FILE):
            try:
                with open(CREDENTIALS_FILE) as f:
                    creds = json.load(f)
                self.username_var.set(creds.get("username", ""))
                self.password_var.set(creds.get("password", ""))
            except:
                pass

    def _version_tuple(self, version_text):
        parts = []
        for chunk in re.split(r"[.-]", str(version_text or "")):
            if chunk.isdigit():
                parts.append(int(chunk))
        return tuple(parts or [0])

    def _check_for_updates(self):
        if not UPDATE_FEED_URL:
            messagebox.showinfo(
                "版本信息",
                f"当前版本：v{APP_VERSION}\n\n更新检查入口已经预留好，后面只需要配置更新地址就可以接入在线检查。",
            )
            return

        self._set_status("正在检查更新...")

        def do_check():
            try:
                resp = requests.get(UPDATE_FEED_URL, timeout=10)
                resp.raise_for_status()
                payload = resp.json()
                latest_version = str(payload.get("version") or "").strip()
                notes = str(payload.get("notes") or "").strip()
                download_url = str(payload.get("download_url") or "").strip()
                has_update = self._version_tuple(latest_version) > self._version_tuple(APP_VERSION)
                self._call_in_ui(self._show_update_result, latest_version, notes, download_url, has_update)
            except Exception as e:
                self._call_in_ui(self._show_update_error, str(e))

        threading.Thread(target=do_check, daemon=True).start()

    def _show_update_result(self, latest_version, notes, download_url, has_update):
        if has_update:
            message = f"当前版本：v{APP_VERSION}\n最新版本：v{latest_version or '?'}"
            if notes:
                message += f"\n\n更新内容：\n{notes}"
            if download_url:
                message += f"\n\n下载地址：\n{download_url}"
            self._set_status(f"发现新版本：v{latest_version}")
            messagebox.showinfo("发现新版本", message)
            return

        self._set_status(f"当前已是最新版本 · v{APP_VERSION}")
        messagebox.showinfo("版本信息", f"当前已是最新版本：v{APP_VERSION}")

    def _show_update_error(self, error):
        self._set_status(f"检查更新失败 · v{APP_VERSION}")
        messagebox.showerror("检查更新失败", error)

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
