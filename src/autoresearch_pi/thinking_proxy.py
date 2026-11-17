"""Forward chat requests while normalizing assistant history for AZ chat endpoints."""
from __future__ import annotations

import argparse
import json
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import requests

HOP_BY_HOP = {"connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
              "te", "trailers", "transfer-encoding", "upgrade", "content-length", "content-encoding"}


def rewrite(payload: dict) -> dict:
    for message in payload.get("messages", []):
        if message.get("role") != "assistant":
            continue
        reasoning = message.pop("reasoning_content", None)
        text = message.get("content")
        blocks = []
        if reasoning:
            blocks.append({"type": "text", "text": reasoning})
        if isinstance(text, list):
            for block in text:
                if isinstance(block, dict) and block.get("type") == "thinking":
                    blocks.append({"type": "text", "text": block.get("thinking", "")})
                elif isinstance(block, dict):
                    blocks.append(block)
        elif isinstance(text, str) and text:
            blocks.append({"type": "text", "text": text})
        if reasoning or isinstance(text, list):
            message["content"] = blocks or [{"type": "text", "text": ""}]
    return payload


class Handler(BaseHTTPRequestHandler):
    upstream = ""
    protocol_version = "HTTP/1.1"

    def log_message(self, *args):
        return

    def send_body(self, status: int, body: bytes, content_type: str) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)
        self.wfile.flush()

    def relay(self, response) -> None:
        body = response.content
        self.send_response(response.status_code)
        for key, value in response.headers.items():
            if key.lower() not in HOP_BY_HOP:
                self.send_header(key, value)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)
        self.wfile.flush()

    def do_POST(self):
        body = self.rfile.read(int(self.headers.get("Content-Length", "0")))
        payload = rewrite(json.loads(body))
        data = json.dumps(payload).encode("utf-8")
        headers = {key: value for key, value in self.headers.items() if key.lower() not in HOP_BY_HOP}
        for attempt in range(15):
            response = requests.post(self.upstream + self.path, headers=headers,
                                     data=data, stream=True, timeout=1800)
            if response.status_code != 400:
                return self.relay(response)
            rejection = response.content
            response.close()
            return self.send_body(400, rejection, "application/json")
        self.send_body(400, rejection, "application/json")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, required=True)
    parser.add_argument("--upstream", required=True)
    args = parser.parse_args()
    Handler.upstream = args.upstream.rstrip("/")
    ThreadingHTTPServer(("127.0.0.1", args.port), Handler).serve_forever()
    return 0


if __name__ == "__main__":
    sys.exit(main())
