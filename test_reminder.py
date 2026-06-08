import json
import os
import time
from datetime import datetime, timedelta

import reminder

def trigger_instant_test():
    now = datetime.now()
    target_time = now + timedelta(minutes=4)
    target_time_str = target_time.strftime("%H:%M")
    
    today_name = now.strftime("%A")
    
    print("-" * 50)
    print(f" 当前系统精准时间: {now.strftime('%H:%M:%S')}")
    print(f"📅今天是: {today_name}")
    print(f" 正在往课表写入测试课程 -> 触发时间: {target_time_str}")
    print("-" * 50)

    timetable_data = reminder.load_timetable()
    
    timetable_data[today_name] = [
        {
            "time": target_time_str,
            "course": "提醒功能测试",
            "room": "我的电脑前"
        }
    ]
    
    with open('timetable.json', 'w', encoding='utf-8') as f:
        json.dump(timetable_data, f, indent=4, ensure_ascii=False)
        
    print("📋 1. 本地数据库 timetable.json 更新成功！")
    
    reminder.setup_daily_jobs()
    print(" 2. 后台定时器排期成功！")
    
    print("\n==================================================")
    print("等一会呗。。。")
    print("==================================================\n")
    
    import schedule
    while True:
        schedule.run_pending()
        time.sleep(1)

if __name__ == "__main__":
    trigger_instant_test()