---
name: banxuebang-homework
description: 伴学邦作业助手 - 桌面版，支持 macOS/Windows/Linux，图形化界面，输入账号密码即可查看作业、课表、班级文件。
allowed-tools: Bash
---

# 伴学邦作业助手 - 桌面版

图形化界面，双击即可运行，自动安装依赖。

## 安装

```bash
pip install playwright
playwright install chromium
```

## 启动

```bash
python3 banxuebang_gui.py
```

## 功能

- ✅ 图形化界面，无需终端操作
- ✅ 自动安装依赖（首次启动）
- ✅ 登录状态保存（记住密码）
- ✅ 课程列表
- ✅ 作业列表（含成绩、截止时间）
- ✅ 未提交作业高亮（红色）+ 桌面通知
- ✅ 班级文件浏览和下载
- ✅ 课程筛选
- ✅ 支持 macOS / Windows / Linux

## 技术说明

- 使用 tkinter 构建 GUI（Python 内置）
- 使用 Playwright 处理伴学邦的 Vue2 SPA 登录流程
- 登录后直接调用伴学邦 API 获取数据
- macOS 使用 osascript 发送桌面通知
- Windows 使用 win10toast 发送通知（需 pip install win10toast）
