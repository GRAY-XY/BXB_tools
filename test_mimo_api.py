#!/usr/bin/env python3
"""测试小米 Mimo API 连接"""

import json
import ssl
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError

# 禁用 SSL 验证（仅用于测试）
ssl_context = ssl._create_unverified_context()

API_KEY = "sk-ce6baojo3r5868obyu7sevd7u4vwn8ga5kz3n65mcxit2fqk"
BASE_URL = "https://api.xiaomimimo.com/v1"
MODEL_NAME = "mimo-v2.5"

def test_models_endpoint():
    """测试 models 端点"""
    print(f"测试 {BASE_URL}/models ...")
    request = Request(
        f"{BASE_URL}/models",
        headers={
            "Authorization": f"Bearer {API_KEY}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
        method="GET",
    )
    
    try:
        with urlopen(request, timeout=30, context=ssl_context) as response:
            status_code = getattr(response, "status", response.getcode())
            raw = response.read().decode("utf-8", errors="replace")
            print(f"✓ Models 端点响应: HTTP {status_code}")
            payload = json.loads(raw)
            print(f"可用模型数量: {len(payload.get('data', []))}")
            for model in payload.get('data', [])[:5]:
                print(f"  - {model.get('id')}")
            return True
    except HTTPError as error:
        print(f"✗ Models 端点错误: HTTP {error.code}")
        detail = error.read().decode("utf-8", errors="replace") if getattr(error, "fp", None) else ""
        print(f"  详情: {detail[:500]}")
        return False
    except URLError as error:
        print(f"✗ 连接错误: {error.reason}")
        return False

def test_chat_completion():
    """测试 chat completions 端点"""
    print(f"\n测试 {BASE_URL}/chat/completions ...")
    payload = {
        "model": MODEL_NAME,
        "messages": [
            {"role": "user", "content": "你好，请简单介绍一下你自己。"}
        ],
        "max_tokens": 100,
        "temperature": 0.7,
    }
    
    request = Request(
        f"{BASE_URL}/chat/completions",
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {API_KEY}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
        method="POST",
    )
    
    try:
        with urlopen(request, timeout=60, context=ssl_context) as response:
            status_code = getattr(response, "status", response.getcode())
            raw = response.read().decode("utf-8", errors="replace")
            print(f"✓ Chat completions 响应: HTTP {status_code}")
            result = json.loads(raw)
            content = result.get("choices", [{}])[0].get("message", {}).get("content", "")
            print(f"模型回复: {content[:200]}")
            usage = result.get("usage", {})
            print(f"Token 使用: {usage}")
            return True
    except HTTPError as error:
        print(f"✗ Chat completions 错误: HTTP {error.code}")
        detail = error.read().decode("utf-8", errors="replace") if getattr(error, "fp", None) else ""
        print(f"  详情: {detail[:500]}")
        return False
    except URLError as error:
        print(f"✗ 连接错误: {error.reason}")
        return False

if __name__ == "__main__":
    print("=" * 60)
    print("小米 Mimo API 连接测试")
    print("=" * 60)
    
    models_ok = test_models_endpoint()
    chat_ok = test_chat_completion()
    
    print("\n" + "=" * 60)
    if models_ok and chat_ok:
        print("✓ 所有测试通过")
    else:
        print("✗ 部分测试失败")
    print("=" * 60)