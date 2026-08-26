#!/usr/bin/env python3
"""保存小米 Mimo API 配置"""
import sys
sys.path.insert(0, "frontend/tk")

from banxuebang_homework.model_config import ModelConfig, save_model_config

# 保存 Mimo API 配置
config = ModelConfig(
    api_key="sk-ce6baojo3r5868obyu7sevd7u4vwn8ga5kz3n65mcxit2fqk",
    base_url="https://api.xiaomimimo.com/v1",
    model_name="mimo-v2.5-pro",
    context_length=128000,
)

config_path = save_model_config(config)
print(f"✓ 配置已保存到: {config_path}")
print(f"  API Key: {config.api_key[:4]}...{config.api_key[-4:]}")
print(f"  Base URL: {config.base_url}")
print(f"  Model: {config.model_name}")
print(f"  Context Length: {config.context_length}")