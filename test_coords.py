import json
import base64
import urllib.request

def debug_ocr_coordinates(image_path):
    url = "http://127.0.0.1:1224/api/ocr"
    
    with open(image_path, "rb") as f:
        img_base64 = base64.b64encode(f.read()).decode('utf-8')
        
    payload = {"base64": img_base64, "options": {"data.format": "dict"}}
    data = json.dumps(payload).encode('utf-8')
    req = urllib.request.Request(url, data=data, headers={'Content-Type': 'application/json'})
    
    try:
        with urllib.request.urlopen(req) as response:
            res = json.loads(response.read().decode('utf-8'))
            if res.get("code") == 100:
                print(f"{'识别文本':<15} | {'中心点 X':<10} | {'中心点 Y':<10}")
                print("-" * 45)
                for item in res["data"]:
                    text = item["text"]
                    box = item["box"]
                    cx = (box[0][0] + box[2][0]) / 2
                    cy = (box[0][1] + box[2][1]) / 2
                    print(f"{text:<15} | {cx:<10.1f} | {cy:<10.1f}")
            else:
                print("识别失败")
    except Exception as e:
        print(f"请确保后台打开了 Umi-OCR！错误: {e}")

if __name__ == "__main__":
    debug_ocr_coordinates("timetable.png")