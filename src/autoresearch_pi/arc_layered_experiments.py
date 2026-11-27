"""Offline preparation and accounting for layered Phase 3 experiments; never sends model or ARC requests."""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
from pathlib import Path


def snapshot_prefix(root: Path, target: Path, game: str, events: list[dict], session: Path) -> dict:
    """Freeze an idle segment. Continuations explicitly restart transient Python/scheduler state in both arms."""
    if target.exists():
        raise ValueError("snapshot destination already exists")
    if any(event.get("event") == "environment_error" for event in events):
        raise ValueError("cannot snapshot uncertain environment history")
    actions = [event for event in events if event.get("event") == "action"]
    replay = []
    for index, event in enumerate(actions, 1):
        frame = event["frame"]
        if event["index"] != index or not frame.get("frames"):
            raise ValueError("incomplete canonical action prefix")
        replay.append({"action": event["action"], **{k: v for k, v in (event.get("coordinates") or {}).items() if k in ("x", "y")},
                       "grid": frame["frames"][-1]})
    target.mkdir(parents=True)
    shutil.copy2(session, target / "session.jsonl")
    for name in ("work", "harness"):
        if (root / name).exists():
            shutil.copytree(root / name, target / name, ignore=shutil.ignore_patterns(".git", "heartbeat"))
    encoded = "".join(json.dumps(row, separators=(",", ":")) + "\n" for row in replay)
    (target / "replay.jsonl").write_text(encoded, encoding="utf-8")
    files = {path.relative_to(target).as_posix(): hashlib.sha256(path.read_bytes()).hexdigest()
             for path in target.rglob("*") if path.is_file()}
    meta = {"format": "arc-layered-prefix-v1", "game": game, "actions": len(actions), "files": files,
            "continuation_mode": "matched-cold-runtime", "limitations": "Python namespace and transient scheduler state restart equally in both arms"}
    (target / "snapshot.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
    return meta


def seed_prefix(snapshot: Path, root: Path, game: str) -> dict:
    meta = json.loads((snapshot / "snapshot.json").read_text(encoding="utf-8"))
    if meta.get("format") != "arc-layered-prefix-v1" or meta.get("game") != game:
        raise ValueError("snapshot game/format mismatch")
    if not {"session.jsonl", "replay.jsonl"}.issubset(meta["files"]):
        raise ValueError("snapshot is missing canonical prefix files")
    for relative, digest in meta["files"].items():
        path = (snapshot / relative).resolve()
        if not path.is_relative_to(snapshot.resolve()) or hashlib.sha256(path.read_bytes()).hexdigest() != digest:
            raise ValueError("snapshot integrity mismatch")
    if root.exists() and any(root.iterdir()):
        raise ValueError("fork requires a fresh run directory")
    root.mkdir(parents=True, exist_ok=True)
    for name in ("work", "harness"):
        if (snapshot / name).exists():
            shutil.copytree(snapshot / name, root / name)
    shutil.copy2(snapshot / "session.jsonl", root / "session.jsonl")
    shutil.copy2(snapshot / "replay.jsonl", root / "fork-replay.jsonl")
    usage = root / "harness" / "usage.jsonl"
    prefix_tokens = sum(int(json.loads(line).get("total") or 0) for line in usage.read_text(encoding="utf-8").splitlines() if line.strip()) if usage.exists() else 0
    receipt = {"prefix_reported_tokens": prefix_tokens, "source": str(snapshot.resolve()), "prefix_actions": meta["actions"],
               "prefix_digest": hashlib.sha256(json.dumps(meta["files"], sort_keys=True).encode()).hexdigest(),
               "continuation_mode": meta["continuation_mode"]}
    (root / "fork.json").write_text(json.dumps(receipt), encoding="utf-8")
    return receipt


def compare_pair(left: Path, right: Path, switch: str = "ARC_LAYERED_RECOVERABLE_FOLD") -> dict:
    configs = [json.loads((root / "run-config.json").read_text(encoding="utf-8")) for root in (left, right)]
    forks = [json.loads((root / "fork.json").read_text(encoding="utf-8")) for root in (left, right)]
    if forks[0]["prefix_digest"] != forks[1]["prefix_digest"]:
        raise ValueError("pair does not share a verified prefix")
    for key in ("game", "model", "provider", "thinking", "profile", "config", "max_actions", "max_reported_tokens",
                "wall_seconds", "segment_seconds", "segment_tokens", "max_output_tokens", "benchmark_only"):
        if configs[0].get(key) != configs[1].get(key):
            raise ValueError(f"pair configuration mismatch: {key}")
    environments = [dict(config.get("extension_env") or {}) for config in configs]
    values = [environment.pop(switch, "0") for environment in environments]
    if environments[0] != environments[1] or set(values) != {"0", "1"}:
        raise ValueError(f"pair must differ only in {switch} switch")
    summaries = [json.loads((root / "summary.json").read_text(encoding="utf-8")) for root in (left, right)]
    return {"format": "arc-layered-pair-v1", "switch": switch, "prefix_digest": forks[0]["prefix_digest"],
            "continuation_mode": "matched-cold-runtime", "arms": [
                {"root": str(root.resolve()), "switch_enabled": value == "1",
                 **({"recoverable_fold": value == "1"} if switch == "ARC_LAYERED_RECOVERABLE_FOLD" else {}),
                 "stop_reason": summary["stop_reason"],
                 "levels_completed": summary.get("levels_completed"), "continuation": summary.get("continuation"),
                 "wall_seconds": summary.get("wall_seconds"), "error": summary.get("error")}
                for root, value, summary in zip((left, right), values, summaries)],
            "evidence": "single paired observation; no general net-benefit claim"}


def export_transfer(source: Path, destination: Path) -> dict:
    """Export only confirmed game-scoped capabilities, excluding task history and credentials."""
    config = json.loads((source / "run-config.json").read_text(encoding="utf-8"))
    component_root = source / "harness" / "components"
    heads = json.loads((component_root / "HEAD.json").read_text(encoding="utf-8"))
    items = []
    for key, version in sorted(heads.items()):
        item = json.loads((component_root / key / f"v{version}.json").read_text(encoding="utf-8"))
        if item.get("retired") or item.get("scope") != "game" or item.get("status") != "confirmed":
            continue
        payload = item["body"]
        rules = item.get("verify") or {}
        if rules:
            payload += "\0" + json.dumps(sorted(rules.items()), ensure_ascii=False, separators=(",", ":"))
        if hashlib.sha256(payload.encode()).hexdigest() != item["hash"]:
            raise ValueError(f"source integrity mismatch: {key}")
        items.append(item)
    result = {"format": "arc-layered-transfer-v1", "source_game": config["game"], "items": items,
              "evidence": "source confirmation is not target-task validation"}
    with destination.open("x", encoding="utf-8") as stream:
        json.dump(result, stream, ensure_ascii=False, indent=2)
    return result


def seed_transfer(manifest: Path, root: Path, game: str) -> dict:
    data = json.loads(manifest.read_text(encoding="utf-8"))
    if data.get("format") != "arc-layered-transfer-v1" or data.get("source_game") == game:
        raise ValueError("independent-task transfer requires a different source game")
    prepared = []
    references = set()
    for original in data["items"]:
        kind, name = original["kind"], original["name"]
        if kind not in ("memory", "tool", "skill", "prompt", "subagent") or not re.fullmatch(r"[a-z][a-z0-9_]{0,40}", name):
            raise ValueError("invalid transfer component reference")
        if (kind, name) in references or original.get("scope") != "game" or original.get("status") != "confirmed" or original.get("retired"):
            raise ValueError("transfer requires unique confirmed game-scoped components")
        references.add((kind, name))
        payload = original["body"]
        if original.get("verify"):
            payload += "\0" + json.dumps(sorted(original["verify"].items()), ensure_ascii=False, separators=(",", ":"))
        if hashlib.sha256(payload.encode()).hexdigest() != original["hash"]:
            raise ValueError("transfer integrity mismatch")
        item = {**original, "version": 1, "scope": "game", "status": "provisional", "last_promoted_level": 0,
                "source_game": data["source_game"], "source_version": original["version"]}
        prepared.append((kind, name, item))
    components = root / "harness" / "components"
    if components.exists():
        raise ValueError("transfer target must have fresh component storage")
    heads = {}
    for kind, name, item in prepared:
        folder = components / kind / name
        folder.mkdir(parents=True)
        (folder / "v1.json").write_text(json.dumps(item, ensure_ascii=False), encoding="utf-8")
        heads[f"{kind}/{name}"] = 1
        if kind == "tool":
            library = root / "work" / "lib"
            library.mkdir(parents=True, exist_ok=True)
            (library / f"{name}.py").write_text(item["body"], encoding="utf-8")
    components.mkdir(parents=True, exist_ok=True)
    (components / "HEAD.json").write_text(json.dumps(heads), encoding="utf-8")
    receipt = {"source_game": data["source_game"], "target_game": game, "components": list(heads), "status": "provisional"}
    (root / "transfer.json").write_text(json.dumps(receipt), encoding="utf-8")
    return receipt


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("destination", type=Path)
    parser.add_argument("--compare", action="store_true", help="Compare two completed paired arms instead of exporting transfer")
    parser.add_argument("--switch", default="ARC_LAYERED_RECOVERABLE_FOLD", help="Single extension_env switch differing between paired arms")
    args = parser.parse_args()
    result = compare_pair(args.source, args.destination, switch=args.switch) if args.compare else export_transfer(args.source, args.destination)
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
