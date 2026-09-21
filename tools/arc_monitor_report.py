#!/usr/bin/env python3
"""Generate a compact ARC run monitoring report from run artifacts.

The report is intentionally read-only. It prefers the current bridge/state
files over historical conversation context.
"""

from __future__ import annotations

import argparse
import collections
import datetime as dt
import json
import re
import sys
from pathlib import Path
from typing import Any, Iterable


def load_jsonl(path: Path, *, limit: int | None = None) -> list[dict[str, Any]]:
    if not path.exists() or path.stat().st_size == 0:
        return []
    rows: list[dict[str, Any]] = []
    with path.open("r", encoding="utf-8", errors="replace") as fh:
        for line in fh:
            if not line.strip():
                continue
            try:
                rows.append(json.loads(line))
            except json.JSONDecodeError:
                rows.append({"_raw": line.strip()})
            if limit is not None and len(rows) >= limit:
                break
    return rows


def latest_run(runs_dir: Path) -> Path:
    candidates = [p for p in runs_dir.glob("arc-live-*") if p.is_dir()]
    if not candidates:
        raise SystemExit(f"no arc-live-* directories under {runs_dir}")
    return max(candidates, key=lambda p: p.stat().st_mtime)


def tail_jsonl(path: Path, count: int = 5) -> list[dict[str, Any]]:
    rows = load_jsonl(path)
    return rows[-count:]


def compact_value(value: Any, max_len: int = 180) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        text = value
    else:
        text = json.dumps(value, ensure_ascii=False, sort_keys=True)
    text = re.sub(r"\s+", " ", text).strip()
    return text if len(text) <= max_len else text[: max_len - 1] + "…"


def first_present(row: dict[str, Any], keys: Iterable[str]) -> Any:
    for key in keys:
        if key in row and row[key] not in (None, "", [], {}):
            return row[key]
    return None


def coalesce_present(*values: Any) -> Any:
    for value in values:
        if value not in (None, "", [], {}):
            return value
    return None


def summarize_bridge(run_dir: Path) -> dict[str, Any]:
    rows = load_jsonl(run_dir / "bridge-events.jsonl")
    counts = collections.Counter(row.get("event", "unknown") for row in rows)
    action_rows = [row for row in rows if row.get("event") == "action"]
    last = action_rows[-1] if action_rows else {}
    frame = last.get("frame") or {}
    delta = last.get("observation_delta") or frame.get("observation_delta") or {}
    budget = last.get("action_budget") or frame.get("action_budget") or {}
    return {
        "event_counts": dict(counts),
        "action_event_count": len(action_rows),
        "last_action": last.get("action"),
        "last_log_index": last.get("index"),
        "state": coalesce_present(frame.get("state"), last.get("state_after"), last.get("state_before")),
        "levels_completed": coalesce_present(frame.get("levels_completed"), last.get("level_after"), last.get("level_before")),
        "budget": budget,
        "changed_cells": delta.get("changed_cells"),
        "bbox": delta.get("bbox"),
    }


def summarize_terminal(run_dir: Path) -> dict[str, Any]:
    summary_path = run_dir / "summary.json"
    error_path = run_dir / "runner-error.json"
    out: dict[str, Any] = {
        "has_summary": summary_path.exists(),
        "has_runner_error": error_path.exists(),
    }
    if summary_path.exists():
        summary = json.loads(summary_path.read_text(encoding="utf-8"))
        runtime = summary.get("runtime") or {}
        benchmark = summary.get("benchmark_evaluation") or {}
        out.update(
            {
                "completion_status": runtime.get("completion_status"),
                "run_complete": runtime.get("run_complete"),
                "pi_returncode": runtime.get("pi_returncode"),
                "agent_actions": runtime.get("agent_actions"),
                "provider_error_count": runtime.get("provider_error_count"),
                "last_provider_error": runtime.get("last_provider_error"),
                "environment_error_count": runtime.get("environment_error_count"),
                "last_environment_error": runtime.get("last_environment_error"),
                "terminal_state": benchmark.get("terminal_state"),
                "passed": benchmark.get("passed"),
                "benchmark_levels_completed": benchmark.get("levels_completed"),
            }
        )
    if error_path.exists():
        out["runner_error"] = compact_value(json.loads(error_path.read_text(encoding="utf-8")), 300)
    return out


def summarize_provider(run_dir: Path) -> dict[str, Any]:
    paths = [run_dir / "provider-telemetry.jsonl", run_dir / "subagent-provider-telemetry.jsonl"]
    counts: collections.Counter[str] = collections.Counter()
    status_counts: collections.Counter[str] = collections.Counter()
    length_records: list[str] = []
    error_records: list[str] = []
    last_records: list[dict[str, Any]] = []
    for path in paths:
        rows = load_jsonl(path)
        for row in rows:
            counts[row.get("event", path.name)] += 1
            if "status" in row:
                status_counts[str(row.get("status"))] += 1
            text = compact_value(row, 1000).lower()
            finish = str(first_present(row, ["finish_reason", "stop_reason", "termination_reason", "reason"]) or "").lower()
            if finish == "length" or "length" in text:
                length_records.append(compact_value(row, 260))
            if row.get("error") or ("status" in row and str(row.get("status")) not in {"200", "ok", "completed"}):
                error_records.append(compact_value(row, 260))
        last_records.extend(rows[-3:])
    return {
        "event_counts": dict(counts),
        "status_counts": dict(status_counts),
        "length_anomaly_count": len(length_records),
        "length_examples": length_records[-3:],
        "provider_error_count": len(error_records),
        "provider_error_examples": error_records[-3:],
        "last_provider_events": [
            {
                k: row.get(k)
                for k in ["event", "status", "model", "provider", "recordedAt", "timestamp", "total_tokens", "error"]
                if k in row
            }
            for row in last_records[-6:]
        ],
    }


def summarize_failures(run_dir: Path) -> dict[str, Any]:
    rows = load_jsonl(run_dir / "task-operation-failures.jsonl")
    grouped = collections.Counter(compact_value(first_present(row, ["error", "message", "reason"]) or row, 180) for row in rows)
    signals = load_jsonl(run_dir / "execution-signals.jsonl")
    signal_errors = [
        row
        for row in signals
        if row.get("outcome") in {"error", "failed"} or "error" in [str(x).lower() for x in row.get("labels", [])]
    ]
    return {
        "operation_failure_count": len(rows),
        "operation_failures": dict(grouped),
        "execution_error_signal_count": len(signal_errors),
        "latest_error_signals": [compact_value(row, 260) for row in signal_errors[-3:]],
    }


def summarize_research(run_dir: Path) -> dict[str, Any]:
    files = [
        "research-exposures.jsonl",
        "research-validation-windows.jsonl",
        "pattern-candidates.jsonl",
        "task-harness-opportunities.jsonl",
    ]
    items: list[str] = []
    counts: dict[str, int] = {}
    for name in files:
        rows = load_jsonl(run_dir / name)
        counts[name] = len(rows)
        for row in rows[-5:]:
            candidate = first_present(
                row,
                [
                    "goal",
                    "research_goal",
                    "question",
                    "hypothesis",
                    "pattern_key",
                    "candidate",
                    "summary",
                    "title",
                    "kind",
                    "opportunity",
                ],
            )
            items.append(f"{name}: {compact_value(candidate or row, 220)}")
    # Deduplicate while preserving order, then keep the recent useful slice.
    deduped = list(dict.fromkeys([item for item in items if item.strip()]))
    return {"counts": counts, "recent_items": deduped[-12:]}


def summarize_module_file(run_dir: Path, name: str, keys: list[str]) -> dict[str, Any]:
    rows = load_jsonl(run_dir / name)
    samples: list[str] = []
    for row in rows[-8:]:
        value = first_present(row, keys)
        samples.append(compact_value(value or row, 220))
    return {"count": len(rows), "samples": list(dict.fromkeys(samples))[-5:]}


def one_line_module_summaries(run_dir: Path) -> dict[str, str]:
    skills = summarize_module_file(run_dir, "task-skills.jsonl", ["skill", "name", "slug", "summary", "description", "event"])
    skill_events = summarize_module_file(run_dir, "task-skill-events.jsonl", ["skill", "name", "event", "summary"])
    tools = summarize_module_file(run_dir, "task-resource-access.jsonl", ["tool", "resource", "kind", "summary", "name", "event"])
    memory = summarize_module_file(run_dir, "task-memory.jsonl", ["memory", "summary", "content", "text", "event"])
    harness = summarize_module_file(run_dir, "task-harness-entry.jsonl", ["system_prompt", "task_prompt", "prompt", "summary"])
    context_exposure = summarize_module_file(run_dir, "task-harness-context-exposures.jsonl", ["summary", "kind", "context", "prompt"])
    return {
        "skills": f"沉淀/调用技能记录 {skills['count']} 条，最近技能事件 {skill_events['count']} 条；最近样例：{'; '.join((skills['samples'] + skill_events['samples'])[:3]) or '暂无'}。",
        "tools": f"工具/资源访问记录 {tools['count']} 条；最近样例：{'; '.join(tools['samples'][:3]) or '暂无'}。",
        "memory": f"任务记忆记录 {memory['count']} 条，用于保存当前假设、观察和后续决策线索；最近样例：{'; '.join(memory['samples'][:3]) or '暂无'}。",
        "system_prompt": f"system/上下文暴露记录 {harness['count'] + context_exposure['count']} 条；最近样例：{'; '.join((harness['samples'] + context_exposure['samples'])[:3]) or '暂无'}。",
        "user_task_prompt": f"用户任务入口/任务范围来自 task-scope 与 harness entry；当前 run 任务是 ARC ls20 treatment 监测与求解，后续报告聚焦进度、异常和沉淀模块。",
    }


def file_activity(run_dir: Path) -> list[tuple[str, int, str]]:
    rows = []
    for path in sorted(run_dir.iterdir(), key=lambda p: p.stat().st_mtime if p.exists() else 0, reverse=True):
        if path.is_file():
            mtime = dt.datetime.fromtimestamp(path.stat().st_mtime).strftime("%Y-%m-%d %H:%M:%S")
            rows.append((path.name, path.stat().st_size, mtime))
    return rows[:10]


def render_report(run_dir: Path, *, process_note: str = "") -> str:
    now = dt.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    bridge = summarize_bridge(run_dir)
    terminal = summarize_terminal(run_dir)
    provider = summarize_provider(run_dir)
    failures = summarize_failures(run_dir)
    research = summarize_research(run_dir)
    modules = one_line_module_summaries(run_dir)
    budget = bridge.get("budget") or {}

    lines = [
        f"ARC 监测报告｜{run_dir.name}｜{now}",
        "",
        "一、当前运行情况",
        f"- run 目录：{run_dir}",
        f"- 进程状态：{process_note or '未在本脚本中查询进程；以 run 文件持续更新和 summary/error 状态推断。'}",
        f"- 终态文件：summary.json={'有' if terminal['has_summary'] else '无'}；runner-error.json={'有' if terminal['has_runner_error'] else '无'}",
        f"- ARC 状态：{bridge.get('state') or terminal.get('terminal_state') or 'unknown'}；已完成游戏关卡数={bridge.get('levels_completed')}",
        f"- 已执行步数：ARC 动作预算计数 当前关卡 {budget.get('used', 'n/a')}/{budget.get('maximum', 'n/a')}，累计 {budget.get('total_used', 'n/a')}/{budget.get('total_maximum', 'n/a')}；runner agent_actions={terminal.get('agent_actions', 'n/a')}；bridge action events={bridge.get('action_event_count')}",
        f"- 内部预算关卡索引：{budget.get('level', 'n/a')}（仅用于预算分段，不等同于“已完成游戏关卡数”）",
        f"- 最新动作：{bridge.get('last_action')}（log index={bridge.get('last_log_index')}），changed_cells={bridge.get('changed_cells')}，bbox={compact_value(bridge.get('bbox')) or '无'}",
        "",
        "二、异常与 length 检查",
        f"- runner error：{terminal.get('runner_error') or '未发现'}",
        f"- provider 非正常/错误记录：telemetry={provider['provider_error_count']}；summary={terminal.get('provider_error_count', 'n/a')}；last_provider_error={terminal.get('last_provider_error') or '未发现'}；HTTP/status 分布：{provider['status_counts'] or '暂无 status'}",
        f"- environment error：summary={terminal.get('environment_error_count', 'n/a')}；last_environment_error={terminal.get('last_environment_error') or '未发现'}",
        f"- length 异常记录：{provider['length_anomaly_count']}；样例：{'; '.join(provider['length_examples']) or '未发现'}",
        f"- task operation failures：{failures['operation_failure_count']}；{compact_value(failures['operation_failures']) or '未发现'}",
        f"- execution error signals：{failures['execution_error_signal_count']}；{'; '.join(failures['latest_error_signals']) or '未发现'}",
        "",
        "三、auto-research / goal 发起情况",
        f"- 记录计数：{compact_value(research['counts'])}",
        *[f"- {item}" for item in research["recent_items"][:10]],
        "",
        "四、沉淀模块一句话摘要",
        f"- skills：{modules['skills']}",
        f"- tools：{modules['tools']}",
        f"- memory：{modules['memory']}",
        f"- system prompt：{modules['system_prompt']}",
        f"- user task prompt：{modules['user_task_prompt']}",
        "",
        "五、最近活跃文件",
        *[f"- {name}: {size} bytes, updated {mtime}" for name, size, mtime in file_activity(run_dir)],
    ]
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("run_dir", nargs="?", type=Path)
    parser.add_argument("--runs-dir", type=Path, default=Path("runs"))
    parser.add_argument("--process-note", default="")
    parser.add_argument("--out", type=Path)
    args = parser.parse_args()

    run_dir = (args.run_dir or latest_run(args.runs_dir)).resolve()
    report = render_report(run_dir, process_note=args.process_note)
    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(report, encoding="utf-8")
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
    sys.stdout.write(report + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
