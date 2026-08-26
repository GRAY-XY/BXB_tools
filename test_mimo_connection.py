#!/usr/bin/env python3
"""测试小米 Mimo API 连接"""
import json
import ssl
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

# Mimo API 配置
API_KEY = "sk-ce6baojo3r5868obyu7sevd7u4vwn8ga5kz3n65mcxit2fqk"
BASE_URL = "https://api.xiaomimimo.com/v1"
MODEL_NAME = "mimo-v2.5-pro"

# 创建 SSL 上下文，处理证书验证问题
ssl_context = ssl.create_default_context()
ssl_context.check_hostname = False
ssl_context.verify_mode = ssl.CERT_NONE

def test_models_endpoint():
    """测试 /models 端点"""
    models_url = f"{BASE_URL}/models"
    print(f"测试 {models_url} ...")
    
    request = Request(
        models_url,
        headers={
            "Authorization": f"Bearer {API_KEY}",
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": "BXB-Homework-UI/1.0",
        },
        method="GET",
    )
    
    try:
        with urlopen(request, context=ssl_context, timeout=30) as response:
            status_code = getattr(response, "status", response.getcode())
            raw = response.read().decode("utf-8", errors="replace")
            print(f"状态码: {status_code}")
            print(f"响应: {raw[:1000]}")
            
            payload = json.loads(raw) if raw else {}
            data = payload.get("data", [])
            print(f"\n可用模型数量: {len(data)}")
            print("可用模型列表:")
            for model in data[:10]:
                model_id = model.get("id", "unknown")
                print(f"  - {model_id}")
            return True
    except HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace") if getattr(error, "fp", None) else ""
        print(f"HTTP 错误 {error.code}: {detail[:500]}")
        return False
    except URLError as error:
        print(f"连接错误: {error.reason}")
        return False
    except Exception as error:
        print(f"未知错误: {error}")
        return False

def test_chat_completion():
    """测试 chat/completions 端点"""
    chat_url = f"{BASE_URL}/chat/completions"
    print(f"\n测试 {chat_url} ...")
    
    payload = {
        "model": MODEL_NAME,
        "messages": [
            {
                "role": "system",
                "content": "You are MiMo, an AI assistant developed by Xiaomi. Today is Wednesday, August 26, 2026. Your knowledge cutoff date is December 2024."
            },
            {
                "role": "user",
                "content": "please introduce yourself in Chinese"
            }
        ],
        "max_completion_tokens": 200,
        "temperature": 0.7,
    }
    
    request = Request(
        chat_url,
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {API_KEY}",
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": "BXB-Homework-UI/1.0",
        },
        method="POST",
    )
    
    try:
        with urlopen(request, context=ssl_context, timeout=30) as response:
            status_code = getattr(response, "status", response.getcode())
            raw = response.read().decode("utf-8", errors="replace")
            print(f"状态码: {status_code}")
            
            result = json.loads(raw) if raw else {}
            message = (((result.get("choices") or [{}])[0]).get("message") or {})
            content = message.get("content", "")
            usage = result.get("usage", {})
            
            print(f"\n模型回复: {content}")
            print(f"Token 使用: {usage}")
            return True
    except HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace") if getattr(error, "fp", None) else ""
        print(f"HTTP 错误 {error.code}: {detail[:500]}")
        return False
    except URLError as error:
        print(f"连接错误: {error.reason}")
        return False
    except Exception as error:
        print(f"未知错误: {error}")
        return False

if __name__ == "__main__":
    print("=" * 60)
    print("小米 Mimo API 连接测试")
    print("=" * 60)
    
    # 测试 models 端点
    models_ok = test_models_endpoint()
    
    # 测试 chat completions 端点
    chat_ok = test_chat_completion()
    
    print("\n" + "=" * 60)
    if models_ok and chat_ok:
        print("✓ 所有测试通过")
    else:
        print("✗ 部分测试失败")
    print("=" * 60)