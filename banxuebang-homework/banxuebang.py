#!/usr/bin/env python3
"""
伴学邦作业查询工具
支持 macOS / Windows / Linux
用法: python3 banxuebang.py -u 邮箱 -p 密码
"""

import argparse
import json
import sys
import time

try:
    from playwright.sync_api import sync_playwright
except ImportError:
    print("需要安装 playwright:")
    print("  pip install playwright")
    print("  playwright install chromium")
    sys.exit(1)

BASE = "https://student.banxuebang.com"


def login(page, username, password):
    """登录伴学邦，返回 access_token"""
    page.goto(f"{BASE}/login", wait_until="load", timeout=30000)
    page.wait_for_timeout(5000)

    # Vue2 Element UI checkbox: 需要触发 JS 事件
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

    # 等待登录完成（跳转到 achievement_list）
    page.wait_for_url("**/achievement_list", timeout=15000)
    page.wait_for_timeout(3000)

    # 从 localStorage 读取 token
    token = page.evaluate("() => { const t = localStorage.getItem('tokens'); return t ? JSON.parse(t).access_token : ''; }")
    if not token:
        raise RuntimeError("登录成功但无法获取 token")

    # 读取用户信息和课程列表
    user_info = page.evaluate("() => { const u = localStorage.getItem('userInfo'); return u ? JSON.parse(u) : {}; }")
    courses = page.evaluate("() => { const c = localStorage.getItem('subjectList'); return c ? JSON.parse(c) : []; }")
    class_info = page.evaluate("() => { const c = localStorage.getItem('curClass'); return c ? JSON.parse(c) : {}; }")
    terms = page.evaluate("() => { const t = localStorage.getItem('termList'); return t ? JSON.parse(t) : []; }")

    return {
        "token": token,
        "student_id": user_info.get("id"),
        "user_name": user_info.get("userName"),
        "org_name": user_info.get("orgName"),
        "class_id": class_info.get("id"),
        "courses": courses,
        "terms": terms,
    }


def api_get(page, url):
    """通过页面上下文调用 API（使用 localStorage 中的 token）"""
    return page.evaluate(f"""async () => {{
        const t = localStorage.getItem('tokens');
        const token = t ? JSON.parse(t).access_token : '';
        const r = await fetch("{url}", {{
            credentials: "include",
            headers: {{ "Authorization": "Bearer " + token }}
        }});
        return await r.json();
    }}""")


def get_course_list(page, session):
    """获取课程列表（带老师信息）"""
    sid = session["student_id"]
    class_id = session["class_id"]
    cur_term = next((t for t in session["terms"] if t.get("status")), session["terms"][0] if session["terms"] else {})
    term_id = cur_term["id"]

    courses = session["courses"]
    result = []
    for c in courses:
        result.append({
            "name": c["cnName"],
            "name_en": c.get("enName", ""),
            "id": c["id"],
            "class_id": c.get("classId", ""),
            "teachers": [t["userName"] for t in c.get("teacherList", [])],
            "un_submit_count": c.get("unSubmitCount", 0),
        })
    return {
        "student": session["user_name"],
        "school": session["org_name"],
        "term": cur_term.get("termName", ""),
        "courses": result,
    }


def get_homework(page, session, course=None, page_size=20):
    """获取作业列表"""
    courses = session["courses"]
    cur_term = next((t for t in session["terms"] if t.get("status")), session["terms"][0] if session["terms"] else {})
    term_id = cur_term["id"]

    if course:
        courses = [c for c in courses if course in c["cnName"]]
        if not courses:
            print(f"未找到课程: {course}", file=sys.stderr)
            return []

    results = []
    for c in courses:
        course_id = c["id"]
        class_id = c.get("classId", "")

        # 获取作业列表
        url = f"{BASE}/gateway/bxb/student/{session['student_id']}/course/{course_id}/page-query-homework?page=1&size={page_size}&leamTermIds={term_id}&classId={class_id}"
        resp = api_get(page, url)

        if isinstance(resp.get("data"), dict) and resp["data"].get("aaData"):
            for hw in resp["data"]["aaData"]:
                results.append({
                    "course": c["cnName"],
                    "teachers": [t["userName"] for t in c.get("teacherList", [])],
                    "name": hw.get("activityName", ""),
                    "type": hw.get("activityTypeName", "") or hw.get("scoreTypeName", ""),
                    "publish_time": hw.get("endTime") or hw.get("releaseTime") or hw.get("createTime") or "",
                    "deadline": hw.get("submitDate") or hw.get("endTime"),
                    "score": hw.get("academicScore") or hw.get("scoreLevel") or hw.get("score") or "N/A",
                })

    return results


def get_unsubmitted(page, session):
    """获取未提交的作业"""
    courses = session["courses"]
    cur_term = next((t for t in session["terms"] if t.get("status")), session["terms"][0] if session["terms"] else {})
    term_id = cur_term["id"]

    results = []
    for c in courses:
        course_id = c["id"]
        class_id = c.get("classId", "")
        url = f"{BASE}/gateway/bxb/student/{session['student_id']}/course/{course_id}/un-submit-homework?leamTermIds={term_id}&classId={class_id}"
        resp = api_get(page, url)

        if resp.get("data") and isinstance(resp["data"], list) and len(resp["data"]) > 0:
            for item in resp["data"]:
                results.append({
                    "course": c["cnName"],
                    "name": item.get("activityName", ""),
                })

    return results


def format_output(schedule, unsubmitted, homework):
    """格式化输出"""
    lines = []
    lines.append(f"{'='*50}")
    lines.append(f"📚 伴学邦 - {schedule['student']} ({schedule['school']})")
    lines.append(f"📅 学期: {schedule['term']}")
    lines.append(f"{'='*50}")

    # 课程列表
    lines.append(f"\n📋 课程 ({len(schedule['courses'])} 门):")
    for c in schedule["courses"]:
        teachers = ", ".join(c["teachers"]) if c["teachers"] else "未知"
        lines.append(f"  • {c['name']} ({teachers})")

    # 未提交作业
    lines.append(f"\n⚠️  未提交作业 ({len(unsubmitted)} 项):")
    if unsubmitted:
        for u in unsubmitted:
            lines.append(f"  🔴 {u['course']} - {u['name']}")
    else:
        lines.append("  ✅ 无未提交作业")

    # 全部作业
    lines.append(f"\n📝 最近作业 ({len(homework)} 项):")
    for hw in homework:
        dl = f"截止: {hw['deadline']}" if hw["deadline"] else ""
        lines.append(f"  • [{hw['course']}] {hw['name']}")
        lines.append(f"    {hw['publish_time']} | {dl} | 成绩: {hw['score']}")

    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(description="伴学邦作业查询工具")
    parser.add_argument("-u", "--username", required=True, help="伴学邦账号 (邮箱)")
    parser.add_argument("-p", "--password", required=True, help="伴学邦密码")
    parser.add_argument("--course", help="只查指定课程")
    parser.add_argument("--json", action="store_true", help="输出 JSON 格式")
    parser.add_argument("--no-homework", action="store_true", help="不查作业，只看课程")
    parser.add_argument("--save", help="保存登录状态到文件（下次免登录）")
    args = parser.parse_args()

    with sync_playwright() as pw:
        browser = pw.chromium.launch(
            headless=True,
            args=["--no-sandbox"],
        )
        context = browser.new_context(viewport={"width": 1280, "height": 800})
        page = context.new_page()

        try:
            # 登录
            print("登录中...", file=sys.stderr)
            session = login(page, args.username, args.password)
            print(f"登录成功! 欢迎 {session['user_name']}", file=sys.stderr)

            # 课程
            schedule = get_course_list(page, session)

            # 未提交作业
            unsubmitted = get_unsubmitted(page, session)

            # 作业列表
            homework = []
            if not args.no_homework:
                homework = get_homework(page, session, course=args.course)

            # 保存登录状态
            if args.save:
                storage = context.storage_state()
                with open(args.save, "w") as f:
                    json.dump(storage, f)
                print(f"登录状态已保存到 {args.save}", file=sys.stderr)

            # 输出
            if args.json:
                print(json.dumps({
                    "schedule": schedule,
                    "unsubmitted": unsubmitted,
                    "homework": homework,
                }, ensure_ascii=False, indent=2))
            else:
                print(format_output(schedule, unsubmitted, homework))

        finally:
            browser.close()


if __name__ == "__main__":
    main()
