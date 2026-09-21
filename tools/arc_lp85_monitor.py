#!/usr/bin/env python3
"""Read-only progress/acceptance report for one ARC treatment run.

The monitor never mutates ARC/Pi artifacts.  It writes a report beside the
run when ``--out`` is supplied; the report is suitable for periodic delivery.
"""

from __future__ import annotations

import argparse
import collections
import datetime as dt
import json
from pathlib import Path
from typing import Any, Iterable


def rows(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    result: list[dict[str, Any]] = []
    with path.open("r", encoding="utf-8", errors="replace") as stream:
        for line in stream:
            if not line.strip():
                continue
            try:
                value = json.loads(line)
            except json.JSONDecodeError:
                continue
            if isinstance(value, dict):
                result.append(value)
    return result


def one(value: Any, limit: int = 220) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        text = value
    else:
        text = json.dumps(value, ensure_ascii=False, sort_keys=True)
    text = " ".join(text.split())
    return text if len(text) <= limit else text[: limit - 1] + "…"


def first(record: dict[str, Any], keys: Iterable[str]) -> Any:
    for key in keys:
        value = record.get(key)
        if value not in (None, "", [], {}):
            return value
    return None


def latest_by(records: list[dict[str, Any]], keys: Iterable[str]) -> list[dict[str, Any]]:
    latest: dict[str, dict[str, Any]] = {}
    for record in records:
        identity = first(record, keys)
        if not identity:
            continue
        key = str(identity)
        old = latest.get(key)
        if old is None or int(record.get("version", 0) or 0) >= int(old.get("version", 0) or 0):
            latest[key] = record
    return list(latest.values())


def bridge_summary(run: Path) -> tuple[int | None, int | None, str, str]:
    events = rows(run / "bridge-events.jsonl")
    actions = [item for item in events if item.get("event") == "action"]
    if not actions:
        return None, None, "UNKNOWN", "暂无 ARC action"
    last = actions[-1]
    frame = last.get("frame") or {}
    budget = last.get("action_budget") or frame.get("action_budget") or {}
    level = frame.get("levels_completed", last.get("level_after"))
    step = budget.get("total_used", budget.get("used"))
    state = frame.get("state", last.get("state_after", "UNKNOWN"))
    action = last.get("action", "?")
    return level, step, str(state), f"{action} (log index {last.get('index', '?')})"


def research_summary(run: Path) -> dict[str, Any]:
    files = {
        "history": "auto-research-runs.jsonl",
        "reports": "auto-research-reports.jsonl",
        "sessions": "auto-research-sessions.jsonl",
        "handoffs": "auto-research-handoffs.jsonl",
        "exposures": "research-exposures.jsonl",
        "windows": "research-validation-windows.jsonl",
        "candidates": "pattern-candidates.jsonl",
        "validations": "task-validations.jsonl",
    }
    loaded = {name: rows(run / filename) for name, filename in files.items()}
    all_records = [record for values in loaded.values() for record in values]
    pending = [
        record for record in all_records
        if str(first(record, ("status", "state", "verdict", "phase")) or "").lower()
        in {"pending", "open", "waiting", "yielded", "inconclusive"}
        or bool(record.get("pending"))
    ]
    current = latest_by(loaded["candidates"], ("candidate_id", "pattern_key", "candidate_key"))
    conclusions: list[str] = []
    for record in loaded["reports"] + loaded["validations"]:
        value = first(record, ("conclusion", "finding", "claim", "summary", "result", "verdict"))
        if value:
            conclusions.append(one(value))
    return {
        "counts": {name: len(value) for name, value in loaded.items()},
        # A research history includes durable sessions/handoffs even when a
        # child has not emitted a final report yet.
        "historical": sum(len(loaded[name]) for name in ("history", "reports", "sessions", "handoffs")),
        "current": len(current),
        "pending": len(pending),
        "conclusions": list(dict.fromkeys(conclusions))[-8:],
        "loaded": loaded,
    }


def harness_summary(run: Path) -> tuple[list[str], list[str]]:
    specs = [
        ("system_prompt", "task-system-prompt-assemblies.jsonl", ("name", "prompt", "summary", "event"), "system prompt/context assembly"),
        ("skill", "task-skills.jsonl", ("name", "skill", "summary", "description"), "skill resource"),
        ("memory", "task-memory.jsonl", ("key", "memory", "summary", "content", "text"), "task memory"),
        ("tool", "task-resource-access.jsonl", ("name", "tool", "resource", "summary", "event"), "task tool/resource"),
        ("subagent", "auto-research-handoffs.jsonl", ("name", "goal", "question", "summary", "event"), "research/subagent handoff"),
    ]
    persisted: list[str] = []
    used: list[str] = []
    for kind, filename, keys, label in specs:
        values = rows(run / filename)
        if values:
            samples = [one(first(item, keys)) for item in values[-3:] if first(item, keys)]
            persisted.append(f"{kind}: {label}，记录 {len(values)} 条；最近：{'；'.join(samples) or '有记录但无摘要字段'}。")
        event_files = [
            run / "task-harness-context-exposures.jsonl",
            run / "task-resource-access.jsonl",
            run / "task-skill-events.jsonl",
            run / "task-harness-control-events.jsonl",
        ]
        if any(any(kind in json.dumps(item, ensure_ascii=False).lower() for kind in (kind, label.split()[0])) for path in event_files for item in rows(path)):
            used.append(kind)
    return persisted, list(dict.fromkeys(used))


def check(label: str, status: str, basis: str) -> str:
    return f"- [{status}] {label}：{basis}"


def acceptance(run: Path, research: dict[str, Any], used: list[str]) -> list[str]:
    control = rows(run / "auto-research-child-control.jsonl")
    actions = rows(run / "bridge-events.jsonl")
    reports = rows(run / "auto-research-reports.jsonl")
    validations = rows(run / "task-validations.jsonl")
    exposures = rows(run / "research-exposures.jsonl")
    text = json.dumps(control + reports + validations + exposures, ensure_ascii=False).lower()
    blocking_yield = any(str(first(item, ("mode", "event", "status", "phase")) or "").lower() in {"blocking", "pending", "yield", "yielded"} for item in control)
    nonblocking = "non_blocking" in text or "non-blocking" in text
    has_action_after = bool(actions) and bool(control)
    checks = [
        ("blocking yield → 父动作 → 研究恢复 → 结构化结论 → harness 变更 → 后续父轮使用", "PASS" if blocking_yield and has_action_after and reports and used else "NOT_EXERCISED", "需同时看到 child control、后续 ARC action、report、harness 使用记录。"),
        ("non_blocking 同链路且 pending 不占槽", "PASS" if nonblocking and has_action_after else "NOT_EXERCISED", "本 run 未强制 research；只按真实产物判断。"),
        ("report/资源读取不唤醒环境等待且同事件只恢复一次", "UNKNOWN", "需要明确 resume/claim receipt；当前监测器不从计数推断。"),
        ("拒绝、延期到期、终止、重复投递、重启与启动失败有限收尾", "UNKNOWN", "未发现足够的专门终止/重启验收回执。"),
        ("历史足够时不额外消耗环境动作；跨窗口保留竞争解释与下一检验", "UNKNOWN" if research["historical"] else "NOT_EXERCISED", "已有研究历史记录，但当前产物不足以证明没有额外环境动作且语义连续性完整。"),
        ("成功条件对照：比较成功/失败状态，而非只总结动作顺序", "PASS" if any(key in text for key in ("success condition", "successful", "对照", "状态差异")) else "NOT_EXERCISED", "未检测到显式成功条件对照证据。"),
        ("反例触发问题重定义并区分原始观测与父解释", "PASS" if any(key in text for key in ("reframe", "redefine", "问题重定义", "原始观测")) else "NOT_EXERCISED", "未检测到显式问题重定义证据。"),
        ("child 可读取原始图像/空间/图案观测", "PASS" if any("trajectory" in json.dumps(item, ensure_ascii=False).lower() or "observation" in json.dumps(item, ensure_ascii=False).lower() for item in exposures) else "NOT_EXERCISED", "以 research exposure/trajectory 记录为依据。"),
    ]
    return [check(*item) for item in checks]


def render(run: Path) -> str:
    level, step, state, action = bridge_summary(run)
    research = research_summary(run)
    persisted, used = harness_summary(run)
    summary_path = run / "summary.json"
    summary = json.loads(summary_path.read_text(encoding="utf-8")) if summary_path.exists() else {}
    runtime = summary.get("runtime") or {}
    conclusion_lines = [f"- 结论：{item}" for item in research["conclusions"][-8:]]
    if not conclusion_lines:
        conclusion_lines = ["- 当前没有可引用的结构化结论。"]
    lines = [
        f"ARC lp85 treatment 监测｜{dt.datetime.now().isoformat(timespec='seconds')}",
        f"run: {run}",
        f"level: {level if level is not None else '暂无'}；step: {step if step is not None else '暂无'}；state: {state}；last action: {action}",
        f"进程终态: {'已生成 summary.json' if summary_path.exists() else '运行中/尚未生成终态'}；agent_actions={runtime.get('agent_actions', '暂无')}；timed_out={runtime.get('timed_out', '暂无')}",
        "",
        "已沉淀 harness（每条一句摘要）:",
        *(persisted or ["- 暂无沉淀记录。"]),
        f"装载/使用过的 harness: {', '.join(used) if used else '暂无可确认的使用记录'}",
        "",
        "auto-research:",
        f"历史数量={research['historical']}；当前候选数量={research['current']}；pending 数量={research['pending']}；分文件计数={json.dumps(research['counts'], ensure_ascii=False)}",
        *conclusion_lines,
        "",
        "验收案逐项 check:",
        *acceptance(run, research, used),
    ]
    return "\n".join(lines) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("run", type=Path)
    parser.add_argument("--out", type=Path)
    args = parser.parse_args()
    report = render(args.run.resolve())
    if args.out:
        args.out.write_text(report, encoding="utf-8")
    print(report, end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
