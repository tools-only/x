"""Fetch the pinned PresentBench case locally without redistributing its assets."""
from __future__ import annotations

import argparse
import hashlib
import json
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
MANIFEST = json.loads((HERE / "case.json").read_text(encoding="utf-8"))
BASE = "https://huggingface.co/datasets/PresentBench/PresentBench/resolve/"


def prepare(output: Path) -> None:
    if output.exists() and any(output.iterdir()):
        raise ValueError(f"Output directory must be empty: {output}")
    output.mkdir(parents=True, exist_ok=True)
    revision = MANIFEST["revision"]
    for name, entry in MANIFEST["files"].items():
        url = f"{BASE}{revision}/{entry['path']}"
        request = urllib.request.Request(url, headers={"User-Agent": "ppt-production-demo/1.0"})
        with urllib.request.urlopen(request, timeout=60) as response:
            payload = response.read()
        digest = hashlib.sha256(payload).hexdigest()
        if digest != entry["sha256"]:
            raise ValueError(f"SHA-256 mismatch for {name}: {digest}")
        (output / name).write_bytes(payload)

    import fitz

    document = fitz.open(output / "material.pdf")
    (output / "material.txt").write_text("\n\n".join(page.get_text() for page in document), encoding="utf-8")
    print(json.dumps({"case": MANIFEST["case"], "revision": revision, "directory": str(output)}, ensure_ascii=False))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True, type=Path, help="empty local directory for downloaded case files")
    args = parser.parse_args()
    prepare(args.output.resolve())
