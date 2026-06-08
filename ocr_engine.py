import json
import base64
import urllib.request

def parse_timetable_with_umi(image_path):
    url = "http://127.0.0.1:1224/api/ocr"
    
    time_slots = [
        "08:00", "08:50", "10:05", "10:55", "11:40", 
        "14:30", "15:20", "16:15", "17:05"
    ]
    days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]
    
    timetable_data = {}
    for day in days:
        timetable_data[day] = []
        for time_str in time_slots:
            timetable_data[day].append({
                "time": time_str,
                "course": "未识别到课程",  
                "room": "教室未识别"     
            })
    
    try:
        with open(image_path, "rb") as f:
            img_base64 = base64.b64encode(f.read()).decode('utf-8')
            
        payload = {"base64": img_base64, "options": {"data.format": "dict"}}
        data = json.dumps(payload).encode('utf-8')
        req = urllib.request.Request(url, data=data, headers={'Content-Type': 'application/json'})
        
        with urllib.request.urlopen(req) as response:
            res_json = json.loads(response.read().decode('utf-8'))
            if res_json.get("code") != 100:
                return False, f"OCR 识别失败: {res_json.get('data')}"
                
            raw_data = res_json.get("data", [])
    except Exception as e:
        return False, f"连接本地 Umi-OCR 失败，请确保软件已打开内置HTTP服务！\n错误: {e}"

    valid_blocks = []
    for item in raw_data:
        text = item["text"].strip()
        if any(w in text for w in ["星期", "课节", "上午", "下午", "下", "上", "第", "08:", "09:", "10:", "11:", "14:", "15:", "16:", "17:"]):
            continue
        box = item["box"]
        cx = (box[0][0] + box[2][0]) / 2
        cy = (box[0][1] + box[2][1]) / 2
        valid_blocks.append({"text": text, "cx": cx, "cy": cy})
        
    if not valid_blocks:
        return False, "未能从图片中解析出任何有效内容。"

    all_x = [b["cx"] for b in valid_blocks]
    all_y = [b["cy"] for b in valid_blocks]
    min_x, max_x = min(all_x), max(all_x)
    min_y, max_y = min(all_y), max(all_y)
    table_width = max_x - min_x if max_x != min_x else 1
    table_height = max_y - min_y if max_y != min_y else 1

    grid_buckets = {}
    for b in valid_blocks:
        pct_x = (b["cx"] - min_x) / table_width
        day_idx = int(pct_x * 4.99)
        
        pct_y = (b["cy"] - min_y) / table_height
        class_idx = int(pct_y * 8.99)
        
        grid_key = (day_idx, class_idx)
        if grid_key not in grid_buckets:
            grid_buckets[grid_key] = []
        grid_buckets[grid_key].append(b["text"])

    for (day_idx, class_idx), text_list in grid_buckets.items():
        if 0 <= day_idx < 5 and 0 <= class_idx < 9:
            day_name = days[day_idx]
            
            course_name = text_list[0] if len(text_list) > 0 else "未识别到课程"
            classroom = text_list[-1] if len(text_list) > 1 else "教室未识别"
            
            timetable_data[day_name][class_idx] = {
                "time": time_slots[class_idx],
                "course": course_name,
                "room": classroom if classroom != course_name else "教室未识别"
            }

    with open('timetable.json', 'w', encoding='utf-8') as f:
        json.dump(timetable_data, f, indent=4, ensure_ascii=False)
        
    return True, "🎉 课表全自动识别并同步成功！"