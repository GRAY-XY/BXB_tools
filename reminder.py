import json
import time
import schedule
from datetime import datetime, timedelta

import win32gui
import win32con

def load_timetable():
    try:
        with open('timetable.json', 'r', encoding='utf-8') as f:
            return json.load(f)
    except FileNotFoundError:
        return {}

def show_notification(course, room):
    """
    【核心修复】主程序也同步使用测试成功的 Windows 原生底层 MessageBox。
    这样到了上课前 3 分钟，就会像测试脚本一样，直接在屏幕中央逼出置顶大弹窗！
    """
    try:
        win32gui.MessageBox(
            0, 
            f"你的【{course}】将在3分钟后开始！\n\n 上课教室：{room}", 
            "上课提醒", 
            win32con.MB_OK | win32con.MB_ICONWARNING | win32con.MB_SYSTEMMODAL
        )
    except Exception as e:
        print(f"原生弹窗触发失败: {e}")

def setup_daily_jobs():
    """根据今天星期的课程表，重新计算排期"""
    schedule.clear()
    timetable = load_timetable()
    
    today_str = datetime.now().strftime('%A')
    todays_classes = timetable.get(today_str, [])
    
    for cls in todays_classes:
        if cls['course'] == "未识别到课程" or cls['course'] == "空课程":
            continue
            
        try:
            class_time = datetime.strptime(cls['time'], '%H:%M')
            reminder_time = (class_time - timedelta(minutes=3)).strftime('%H:%M')
            
            schedule.every().day.at(reminder_time).do(
                show_notification, course=cls['course'], room=cls['room']
            )
            print(f"已成功排期主提醒: {reminder_time} 对应课程【{cls['course']}】")
        except Exception as e:
            print(f"排期课程失败: {cls.get('course')}，原因: {e}")

def run_scheduler():
    setup_daily_jobs()
    
    last_run_date = datetime.now().strftime('%Y-%m-%d')
    
    while True:
        current_date = datetime.now().strftime('%Y-%m-%d')
        
        if current_date != last_run_date:
            print(f"刷新今日课表...")
            setup_daily_jobs()
            last_run_date = current_date
            
        schedule.run_pending()
        time.sleep(1)