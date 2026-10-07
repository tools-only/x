"""Installed Pi context diagnostic with scripted provider and loopback ARC state.

No paid model or environment action; exact decoding does not prove perception.
"""
import base64
import json
import re
import struct
import threading
import zlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from test_arc_capability_surface_native import _run_arc_parent


def png_pixels(image, expected):
    data = base64.b64decode(image["data"])
    assert data[:8] == b"\x89PNG\r\n\x1a\n"
    assert struct.unpack(">II", data[16:24]) == (64, 64)
    compressed, offset = bytearray(), 8
    while offset < len(data):
        length = struct.unpack(">I", data[offset:offset + 4])[0]
        if data[offset + 4:offset + 8] == b"IDAT":
            compressed.extend(data[offset + 8:offset + 8 + length])
        offset += length + 12
    palette = {0: b"\x12\x12\x12", 2: b"\xff\x41\x36"}
    assert zlib.decompress(compressed) == b"".join(
        b"\x00" + b"".join(palette[color] for color in row) for row in expected)


def test_actual_pi_context_contains_reversible_peak_full_current_and_original_images(tmp_path):
    current = [[0] * 64 for _ in range(64)]
    peak = [row.copy() for row in current]
    for y in range(32, 40):
        peak[y][32:42] = [2] * 10
    state = {"frames": [current], "state": "NOT_FINISHED", "levels_completed": 0,
             "available_actions": ["ACTION1"], "action_budget": {"total_used": 1}}
    event = {"event": "action", "index": 1, "action": "ACTION1", "level_before": 0,
             "state_before": "NOT_FINISHED", "observation_delta": {"changed_cells": 0},
             "frame": {**state, "frames": [peak, current]}}

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args): pass
        def do_GET(self):
            body = json.dumps(state if self.path == "/state" else {"events": [event], "next": 1}).encode()
            self.send_response(200)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        events = _run_arc_parent(tmp_path, [], extra_env={
            "PI_ARC_BRIDGE_URL": f"http://127.0.0.1:{server.server_port}",
            "PI_ARC_INPUT_MODALITIES": "text,image"})
        assert not [item for item in events if item.get("isError") or item.get("type") == "error"]
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)
    contexts = [json.loads(line)["context"] for line in
                (tmp_path / "provider-contexts.jsonl").read_text(encoding="utf-8").splitlines()]
    assert len(contexts) == 1
    content = [part for message in contexts[0]["messages"] for part in message.get("content", [])]
    text = "\n".join(part["text"] for part in content if part.get("type") == "text")
    match = re.search(r"(?m)^Grid arc-action-1_frame_0 .*relative to current_state_frame.*\n(\[\[.*\]\])", text)
    assert match
    recovered = [row.copy() for row in current]
    spans = json.loads(match.group(1))
    assert spans == [[y, 32, "2222222222"] for y in range(32, 40)]
    for y, x, values in spans:
        recovered[y][x:x + len(values)] = [int(value, 16) for value in values]
    assert recovered == peak
    current_text = text.split("Grid current_state_frame (64x64) [hex 0-f = color 0-15]:\n",1)[1].split("\n\n",1)[0]
    current_lines = current_text.splitlines()
    assert current_lines[:2] == [''.join(str(x//10) for x in range(64))+' x tens',
                                ''.join(str(x%10) for x in range(64))+' x ones']
    assert len(current_lines[2:]) == 64
    assert current_lines[2:] == ['0'*64+(f' y={y:02d}' if y%8==0 else '') for y in range(64)]
    assert "peak_changed=80, peak_frame_index=0" in text
    assert "final_grid_changed=false; transient_animation=true" in text
    images = [part for part in content if part.get("type") == "image"]
    assert len(images) == 2
    png_pixels(images[0], peak)
    png_pixels(images[1], current)
