"""Report prescribed historical reachability or evidence for new harness creation and use."""
from __future__ import annotations

import argparse
import json
from pathlib import Path


def rows(path: Path) -> list[dict]:
    if not path.exists():
        return []
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def historical(root: Path) -> dict:
    lifecycle = rows(root / "harness/lifecycle.jsonl")
    calls = rows(root / "harness/component_runs.jsonl")
    consults = rows(root / "harness/consult_runs.jsonl")
    changes = [r for r in lifecycle if r.get("event") == "reflective_change" and r.get("op") == "redefine"]
    consumed = [r for r in lifecycle if r.get("event") == "component_consumed"]
    consumed += [{**r, "kind": "tool"} for r in calls if r.get("kind") == "program_result" and r.get("ok") is True]
    consumed += [{**r, "kind": "subagent", "name": r.get("role")} for r in consults if r.get("role")]
    per_kind = {}
    for kind in ("prompt", "skill", "tool", "subagent", "memory"):
        matched = []
        for change in changes:
            if change.get("kind") != kind:
                continue
            use = next((r for r in consumed if r.get("kind") == kind and r.get("name") == change.get("name")
                        and r.get("version") == change.get("version") and r.get("session_id") == change.get("session_id")
                        and r.get("time", "") >= change.get("time", "")), None)
            if use:
                matched.append({"name": change.get("name"), "version": change.get("version"), "boundary": use.get("boundary", use.get("kind"))})
        per_kind[kind] = {"pass": bool(matched), "consumed": matched}
    passed = all(v["pass"] for v in per_kind.values())
    return {"mode": "historical_prescribed_redefine", "pass": passed, "per_kind": per_kind,
            "reflective_redefinitions": len(changes), "reason": "all five redefined versions were consumed" if passed else "each kind requires redefine followed by same-session consumption at that version"}


def creation(root: Path) -> dict:
    life = rows(root / "harness/lifecycle.jsonl")
    calls, consults = rows(root / "harness/component_runs.jsonl"), rows(root / "harness/consult_runs.jsonl")
    snapshots = [r for r in life if r.get("event") == "initial_registry"]
    initial = {(c.get("kind"), c.get("name"), c.get("hash")) for c in (snapshots[0].get("components", []) if snapshots else [])}
    changes = [r for r in life if r.get("event") == "reflective_change" and r.get("op") in ("define", "redefine", "restore")]
    creations = []
    for change in changes:
        is_new = change.get("op") == "define" and change.get("kind") in ("tool", "skill", "subagent") and not any(
            kind == change.get("kind") and (name == change.get("name") or (digest and digest == change.get("hash")))
            for kind, name, digest in initial)
        if not is_new:
            continue
        kind, name, version, session, time = (change.get(k) for k in ("kind", "name", "version", "session_id", "time"))
        same = lambda r: r.get("session_id") == session and r.get("name") == name and r.get("version") == version and r.get("time", "") >= (time or "")
        uses = []
        if kind == "tool":
            uses = [r for r in calls if r.get("kind") in ("program_result", "tool") and r.get("ok") is True and same(r)]
        elif kind == "skill":
            reads = [r for r in life if r.get("event") == "component_consumed" and r.get("boundary") == "read_component" and same(r)]
            uses = [{"boundary": "read_component; procedure-following evidence unavailable"} for _ in reads]
        else:
            cs = [r for r in consults if r.get("role") == name and r.get("version") == version and r.get("session_id") == session and r.get("time", "") >= (time or "") and r.get("ok") is not False]
            later_work = any(r.get("time", "") > c.get("time", "") and r.get("session_id") == session for c in cs for r in calls if r.get("ok") is True)
            uses = ([{"boundary": "consult; followed by parent tool work"}] if cs and later_work else [])
        status = "pass" if uses and (kind != "skill") else "uncertain" if uses else "fail"
        if change.get("ok") is False:
            status = "fail"
        creations.append({"name": name, "kind": kind, "version": version, "note_present": bool(str(change.get("note", "")).strip()),
                          "definition": "pass" if change.get("ok") is not False and change.get("note", "").strip() else "fail", "same_session_use": status,
                          "use_evidence": uses, "source_hash": change.get("hash")})
    defined = [c for c in creations if c["definition"] == "pass"]
    created_used = any(c["definition"] == "pass" and c["same_session_use"] == "pass" for c in creations)
    return {"mode": "new_creation", "claims": {
        "initial_registry_snapshot": "pass" if snapshots else "uncertain",
        "genuinely_new_definition_with_note": "pass" if defined else "fail",
        "same_session_real_use": "pass" if created_used else ("uncertain" if any(c["same_session_use"] == "uncertain" for c in creations) else "fail")},
        "pass": bool(snapshots and defined and created_used), "creations": creations,
        "all_changes_including_non_define": changes,
        "limits": ["skill procedure-following requires semantic review", "subagent parent use is inferred from subsequent successful tool work", "creation/use does not establish task quality or net benefit"]}


def check(root: Path, mode: str = "historical") -> dict:
    result = historical(root) if mode == "historical" else creation(root)
    print(json.dumps(result, indent=2))
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("root", type=Path)
    parser.add_argument("--mode", choices=("historical", "new-creation"), default="historical")
    args = parser.parse_args()
    raise SystemExit(0 if check(args.root, args.mode)["pass"] else 1)
