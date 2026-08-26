#!/usr/bin/env python3
"""保存小米 Mimo API 配置到 Electron 位置"""
import json
from pathlib import Path

# Electron 的 userDataRoot 在 macOS 上通常是 ~/Library/Application Support/bxb-homework-electron
user_data_root = Path.home() / "Library" / "Application Support" / "bxb-homework-electron"
config_path = user_data_root / "model-config.json"

# 确保目录存在
user_data_root.mkdir(parents=True, exist_ok=True)

# Mimo API 配置
config = {
    "apiKey": "sk-ce6baojo3r5868obyu7sevd7u4vwn8ga5kz3n65mcxit2fqk",
    "baseUrl": "https://api.xiaomimimo.com/v1",
    "modelName": "mimo-v2.5-pro",
    "contextLength": 128000,
    "chatTemperature": 0.2,
    "compactTemperature": 0.1,
    "longPasteThreshold": 4000,
    "maxToolRounds": 6,
    "systemPrompt": "你是伴学邦桌面助手，运行在一个本地 UI 中。你的职责：优先通过工具读取真实数据，不要猜测课程、学期、任务内容。回答要简洁、直接、可执行。需要伴学邦数据时，先确认会话是否可用；如果没有登录态，就明确提示用户先点击浏览器登录。只使用提供给你的工具，不要编造不存在的能力。"
}

# 保存配置
config_path.write_text(json.dumps(config, ensure_ascii=False, indent=2), encoding="utf-8")
print(f"✓ 配置已保存到: {config_path}")
print(f"  API Key: {config['apiKey'][:4]}...{config['apiKey'][-4:]}")
print(f"  Base URL: {config['baseUrl']}")
print(f"  Model: {config['modelName']}")