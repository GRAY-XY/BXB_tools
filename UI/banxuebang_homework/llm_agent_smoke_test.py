from __future__ import annotations

import json
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

from .agent_smoke_test import FakeBackend
from .llm_agent import LlmConversationAgent
from .model_config import ModelConfig, clear_model_config, load_model_config, save_model_config


class Handler(BaseHTTPRequestHandler):
    def do_POST(self) -> None:  # noqa: N802
        if self.path != "/v1/chat/completions":
            self.send_response(404)
            self.end_headers()
            return

        length = int(self.headers.get("Content-Length", "0"))
        payload = json.loads(self.rfile.read(length).decode("utf-8"))
        messages = payload.get("messages", [])

        tool_messages = [message for message in messages if message.get("role") == "tool"]
        if not tool_messages:
            body = {
                "choices": [
                    {
                        "message": {
                            "role": "assistant",
                            "content": "",
                            "tool_calls": [
                                {
                                    "id": "call_1",
                                    "type": "function",
                                    "function": {
                                        "name": "list_courses",
                                        "arguments": "{}",
                                    },
                                }
                            ],
                        }
                    }
                ]
            }
        else:
            tool_payload = json.loads(tool_messages[-1]["content"])
            course_names = [item.get("name", "") for item in tool_payload.get("courses", []) if item.get("name")]
            body = {
                "choices": [
                    {
                        "message": {
                            "role": "assistant",
                            "content": "可用课程：" + "、".join(course_names),
                        }
                    }
                ]
            }

        encoded = json.dumps(body, ensure_ascii=False).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def log_message(self, format: str, *args: object) -> None:
        return


def main() -> int:
    backend = FakeBackend()
    server = HTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    port = server.server_address[1]
    original_config = load_model_config()

    try:
        save_model_config(
            ModelConfig(
                api_key="test-key",
                base_url=f"http://127.0.0.1:{port}/v1",
                model_name="demo-model",
            )
        )
        agent = LlmConversationAgent(backend)
        reply = agent.handle("列出课程")
        print(
            json.dumps(
                {
                    "message": reply.message,
                    "calls": backend.calls,
                    "recent_turns": [{"role": turn.role, "text": turn.text} for turn in agent.recent_turns()],
                },
                ensure_ascii=False,
                indent=2,
            )
        )
    finally:
        if original_config.api_key or original_config.base_url or original_config.model_name:
            save_model_config(original_config)
        else:
            clear_model_config()
        server.shutdown()
        server.server_close()

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
