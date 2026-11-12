"""Bounded single-session FINAL v1 PPT runner. Never changes provider/model or pushes Git."""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import re
import shutil
import subprocess
import time
import urllib.error
import urllib.request
from pathlib import Path

from .pi_kernel import PiKernel
from .ppt_demo import prepare
from .ppt_demo_html import render, _browser
from .project import load_project_dotenv
from .resource_daemon import refresh_resource_daemon

PROJECT = Path(__file__).resolve().parents[2]
MODEL = "glm-5.3-flash"
BASE = "https://az.gptplus5.com/v1"
INPUT_RATE = 0.15
OUTPUT_RATE = 0.5
CACHE_RATE = 0.0


def digest(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode()).hexdigest()


def file_hash(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def write(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")


def persist_resource_daemon(root: Path):
    """Refresh the shared daemon resource mount. Heartbeat stays off in this runner."""
    return refresh_resource_daemon(root)


def resource_usage(root: Path, reserve: dict):
    rows = [json.loads(line) for line in (root / "harness/model-usage.jsonl").read_text(encoding="utf-8").splitlines()] if (root / "harness/model-usage.jsonl").exists() else []
    dispatched = [json.loads(line) for line in (root / "harness/provider-requests.jsonl").read_text(encoding="utf-8").splitlines()] if (root / "harness/provider-requests.jsonl").exists() else []
    settled = {r["request"] for r in rows}
    missing = [r.get("permit",reserve) for r in dispatched if r["request"] not in settled]
    return {"requests":len(dispatched), "tokens":sum(r["tokens_used"] for r in rows)+sum(p["tokens"] for p in missing),
            "usd":(rows[-1]["conservative_usd"] if rows else 0)+sum(p["usd"] for p in missing), "requests_with_missing_usage":len(missing),
            "storage_bytes":sum(p.stat().st_size for p in root.rglob('*') if p.is_file()),
            "billing":"conservative estimate; actual invoice unknown"}


def local_settings(registration: Path):
    """Use the existing exact model definition; rename its local provider handle to az."""
    data = json.loads(registration.read_text(encoding="utf-8"))
    found = []
    for name, provider in data.get("providers", {}).items():
        if provider.get("baseUrl", "").rstrip("/") != BASE:
            continue
        for model in provider.get("models", []):
            if model.get("id") == MODEL:
                found.append((name, provider, model))
    if not found:
        raise ValueError("az/glm-5.3-flash unavailable in the existing local registration; no substitution")
    name, provider, model = found[0]
    return {"registration": str(registration), "original_provider_handle": name, "provider": "az", "baseUrl": BASE,
            "api": provider["api"], "compat": provider.get("compat", {}), "model": model, "thinking": "low",
            "request_output_tokens": 8192,
            "request_reserve": {"tokens": model["contextWindow"] + model["maxTokens"],
                                "usd": (model["contextWindow"]*INPUT_RATE + model["maxTokens"]*OUTPUT_RATE)/1e6,
                                "basis": "registered maximum input/output; GLM-5.3-Flash rates 0.15/0.50 USD per million and zero cache rates; unknown invoice"},
            "sampling": {"temperature": "provider default; not supplied", "top_p": "provider default; not supplied"},
            # Pi's HTTP dispatcher resets its headers/body idle clock on received
            # bytes. A silent call fails before the 300s turn watchdog; Pi then
            # retries that failed assistant request in the same serial session.
            "agent_settings": {"compaction": {"enabled": False}, "httpIdleTimeoutMs": 240_000,
                               "retry": {"enabled": True, "maxRetries": 2, "baseDelayMs": 2000,
                                         "maxAgentDelayMs": 4000, "provider": {"maxRetries": 0}}}}


def content_units(material: str):
    pages = re.split(r"(?m)^## Source page (\d+)\s*$", material)
    if len(pages) < 21:
        raise ValueError("existing real source must contain at least ten distinct source-page units")
    units = []
    for n in range(1, 20, 2):
        number, body = pages[n], pages[n + 1]
        compact = " ".join(body.split())
        # Frozen literal probes are transparent and narrow, never a semantic quality score.
        numbers = list(dict.fromkeys(re.findall(r"\$\d[\d,]*(?:\.\d+)?|\d[\d,]*(?:\.\d+)?\s*%", compact)))[:3]
        units.append({"id": f"unit-{len(units)+1:02}", "title": compact[:100], "source_page": int(number),
                      "required": numbers, "citation": f"Source page {number}"})
    return units


def renderer_preflight(root: Path):
    """Real local renderer only; outside the task workspace, no provider request."""
    probe = root / "renderer-preflight"
    source = probe / "workspace/artifacts/presentation.html"
    source.parent.mkdir(parents=True)
    source.write_text('<!doctype html><html><body><section class="slide"><h1>Renderer preflight</h1><p>123.4 source</p></section></body></html>',encoding="utf-8")
    started = time.monotonic()
    receipt = render(probe,source,1)
    result = {"status":"passed", "exit":0, "elapsed_seconds":time.monotonic()-started, "receipt":receipt,
              "browser":str(_browser()), "source_sha256":file_hash(source),
              "image_sha256":file_hash(probe / "exports/v001/slide-01.png"),
              "acceptance_preflight":"tests/test_evo_ppt_pi.py runs the protected checker through actual Pi/render/delivery"}
    write(root / "renderer-preflight.json",result)
    return result


def freeze(root: Path, source: Path, registration: Path, caps: dict, authority: str, arm="B"):
    root = root.resolve()
    if not root.is_relative_to(PROJECT):
        raise ValueError("experiment writes must remain in this worktree")
    # The frozen runtime requires finite numbers. An explicit null means no
    # token cap; its compatibility value cannot bind within the request cap.
    unlimited_tokens = "tokens" in caps and caps["tokens"] is None
    unlimited_usd = "usd" in caps and caps["usd"] is None
    if unlimited_tokens:
        caps = {**caps, "tokens": 2**53 - 1}
    if unlimited_usd:
        caps = {**caps, "usd": 2**53 - 1}
    for key in ("requests", "tokens", "seconds", "usd", "storage_bytes"):
        if isinstance(caps.get(key),bool) or not isinstance(caps.get(key), (int, float)) or not math.isfinite(caps[key]) or caps[key] <= 0:
            raise ValueError(f"authorized numeric cap missing: {key}")
        if key in ("requests","tokens","storage_bytes") and not isinstance(caps[key],int):
            raise ValueError(f"cap must be an integer: {key}")
    if not authority.strip():
        raise ValueError("numeric resource authorization provenance required")
    settings = local_settings(registration)
    if unlimited_tokens and caps["requests"] * settings["request_reserve"]["tokens"] >= caps["tokens"]:
        raise ValueError("token-free compatibility value must exceed all authorized request permits")
    if unlimited_usd and caps["requests"] * settings["request_reserve"]["usd"] >= caps["usd"]:
        raise ValueError("usd-free compatibility value must exceed all authorized request permits")
    prepare(root, source)
    if arm == "B":
        (root / "workspace/AGENTS.md").unlink()
    units = content_units((root / "workspace/data/material.txt").read_text(encoding="utf-8"))
    unit_text = "\n".join(f"- {u['id']}: {u['title']} (cite {u['citation']})." for u in units)
    brief = root / "workspace/data/instructions.md"
    brief.write_text(brief.read_text(encoding="utf-8") + "\n\nFrozen content units for this production run (units may span slides; retain the 15-slide brief):\n" + unit_text +
                     "\nDeliver the complete presentation with the existing office interface; submit_unit, when available, supports partial handover.\n", encoding="utf-8")
    # The development AGENTS.md and constitution are never task context.
    sources = {f"data/{p.name}": file_hash(p) for p in (root / "workspace/data").iterdir() if p.is_file()}
    body = {"source": "user_contract", "authority": authority, "decisions": "FINAL 2.1 G1/G5/G7; explicit round authority above",
            "readonly_reason": "user authorization, total resources, evidence integrity and acceptance cannot be rewritten by the task Agent",
            "boundaries": ["window_entry", "before_delivery", "before_active_reset", "before_batch_switch", "before_session_end"],
            "capabilities": ["read", "write", "edit", "ls", "grep", "python", "office.render", "office.look", "office.deliver", "acceptance", "submit_unit", "agent_tools"],
            "writable": ["components.tool", "components.prompt", "components.skill", "components.memory", "policy", "orchestration"],
            "budget": caps, "acceptance": {"brief_sha256": sources["data/instructions.md"], "original_brief_sha256": file_hash(source / "production_brief.md"), "units_sha256": digest(units), "checker_version": "literal-normalized-render-v2", "expected_slides":15},
            "inherit_defaults": False, "heartbeat": False}
    manifest = {"experiment_id": root.name, "arm": arm, "provider": "az", "model": MODEL, "contract": {**body, "content_hash": digest(body)},
                "sources": sources, "units": units, "checker": {"version": "literal-normalized-render-v2", "sha256": file_hash(PROJECT / "demo/self_root_ppt.ts")}, "settings": settings,
                "engineering_commit": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=PROJECT, text=True).strip(),
            "engineering_tag": "v3 candidate; exact final commit recorded by local tag v3", "seed_hashes": {p: file_hash(PROJECT / p) for p in [
                    "demo/self_root.ts", "demo/self_root_ppt.ts", "demo/provider_permit.ts", "demo/ppt_demo_extension.ts", "demo/live_orchestration_core.ts", "demo/prompts/ppt_demo_system.md", "demo/prompts/self_root_system.md", "demo/arc_thin_native_runtime.ts", "demo/arc_thin_workspace.ts", "src/autoresearch_pi/ppt_demo_html.py", "src/autoresearch_pi/evo_ppt.py"]},
                "comparison": "A calibration excluded; B1/B2 same frozen source and seed; no automatic inheritance; stage2 conditional on autonomous-change/use evidence",
                "acceptance_limitations": "literal probes and renderer facts; semantic attribution, narrative, aesthetics and net benefit are not established"}
    if unlimited_tokens:
        manifest["token_budget"] = {"authorized_cap": None, "runtime_nonbinding_value": caps["tokens"],
            "maximum_permit_tokens_across_request_cap": caps["requests"] * settings["request_reserve"]["tokens"],
            "metering": "unchanged; token dimension cannot deny any authorized request permit"}
    if unlimited_usd:
        manifest["usd_budget"] = {"authorized_cap": None, "runtime_nonbinding_value": caps["usd"],
            "maximum_permit_usd_across_request_cap": caps["requests"] * settings["request_reserve"]["usd"],
            "metering": "unchanged; usd dimension cannot deny any authorized request permit"}
    manifest["renderer_preflight"] = renderer_preflight(root)
    write(root / "manifest.json", manifest)
    write(root / "units.json", units)
    return manifest


def model_preflight(root: Path, manifest: dict, values: dict, inference=False, deadline: float | None = None):
    """No fallback/retry. Optional tiny connectivity probe is separately accounted."""
    sent = False
    if values.get("OPENAI_API_BASE", "").rstrip("/") != BASE or not values.get("OPENAI_API_KEY"):
        result = {"status": "az_unavailable", "reason": "existing endpoint/key missing"}
    else:
        key = values["OPENAI_API_KEY"]
        headers = {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}
        url = BASE + ("/chat/completions" if inference else "/models")
        probe_payload = {"model": MODEL, "messages": [{"role": "user", "content": "Reply OK."}], "max_completion_tokens": 16,
                         "reasoning_effort": manifest["settings"]["thinking"], "stream": False}
        data = json.dumps(probe_payload).encode() if inference else None
        started = time.monotonic()
        try:
            timeout = min(45,manifest["contract"]["budget"]["seconds"],deadline-time.time() if deadline is not None else 45)
            if timeout <= 0:
                raise TimeoutError("authorized round wall clock exhausted before preflight dispatch")
            if inference:
                write(root / "inference-preflight.json", {"status":"pending", "accounting":{"requests":1,
                    "tokens":len(data)+4096+16,"usd":((len(data)+4096)*INPUT_RATE+16*OUTPUT_RATE)/1e6,"usage_status":"unknown_reserved"}})
            sent = True
            with urllib.request.urlopen(urllib.request.Request(url, data=data, headers=headers), timeout=timeout) as response:
                body = json.load(response)
                listed = any(m.get("id") == MODEL for m in body.get("data", [])) if not inference else None
                result = {"status": "available" if (body.get("model") == MODEL if inference else listed) else "model_mismatch_or_not_listed",
                          "http_status": response.status, "returned_model": body.get("model"), "model_listed": listed,
                          "usage": body.get("usage"), "error":body.get("error"), "elapsed_seconds": time.monotonic()-started,
                          "kind": "separate inference connectivity probe" if inference else "read-only model listing"}
        except urllib.error.HTTPError as error:
            result = {"status": "az_unavailable", "http_status": error.code, "error": error.read().decode(errors="replace").replace(key, "[redacted]")[:2000], "elapsed_seconds": time.monotonic()-started}
        except Exception as error:
            result = {"status": "az_unavailable", "error": str(error).replace(key, "[redacted]"), "elapsed_seconds": time.monotonic()-started}
    if inference:
        usage = result.get("usage") or {}
        result["accounting"]={"requests":int(sent),"tokens":usage.get("total_tokens",(len(data)+4096+16) if sent else 0),
                              "usd":(usage["prompt_tokens"]*INPUT_RATE+usage["completion_tokens"]*OUTPUT_RATE)/1e6 if "prompt_tokens" in usage and "completion_tokens" in usage else (((len(data)+4096)*INPUT_RATE+16*OUTPUT_RATE)/1e6 if sent else 0),
                              "seconds":result.get("elapsed_seconds",0),"usage_status":"reported" if usage else "unknown_reserved"}
    write(root / ("inference-preflight.json" if inference else "provider-preflight.json"), result)
    persist_resource_daemon(root)
    return result


def run(root: Path, *, round_deadline: float | None = None):
    manifest = json.loads((root / "manifest.json").read_text(encoding="utf-8"))
    if manifest["provider"] != "az" or manifest["model"] != MODEL:
        raise ValueError("provider/model substitution refused")
    if (root / "session.jsonl").exists():
        raise ValueError("use a fresh independent root; automatic retries/resumes are not permitted")
    for relative, expected in manifest["seed_hashes"].items():
        if file_hash(PROJECT / relative) != expected:
            raise ValueError(f"frozen engineering source changed: {relative}")
    for relative, expected in manifest["sources"].items():
        if file_hash(root / "workspace" / relative) != expected:
            raise ValueError(f"frozen task source changed: {relative}")
    contract = manifest["contract"]
    if contract["content_hash"] != digest({k:v for k,v in contract.items() if k != "content_hash"}):
        raise ValueError("contract changed after freeze")
    if not manifest.get("renderer_preflight",{}).get("status") == "passed":
        raise ValueError("actual renderer preflight missing")
    values = load_project_dotenv(Path("D:/autoresearch_pi_project"))
    # This connectivity probe is not a task Agent. Charge it to the same total
    # authorization, record the actual returned model, and never retry/fallback.
    b = contract["budget"]
    if round_deadline is not None and time.time() >= round_deadline:
        result={"stop":"round_wall_clock_before_preflight", "resources":{"requests":0,"tokens":0,"usd":0},
                "units":[{"id":u["id"],"status":"not_run"} for u in manifest["units"]]}
        write(root / "summary.json",result); persist_resource_daemon(root); return result
    if b["requests"] < 2 or b["tokens"] < 4352 or b["usd"] < (4336*INPUT_RATE+16*OUTPUT_RATE)/1e6:
        result={"stop":"insufficient_preflight_budget","units":[{"id":u["id"],"status":"not_run"} for u in manifest["units"]]}
        write(root / "summary.json",result); persist_resource_daemon(root); return result
    probe = model_preflight(root,manifest,values,inference=True,deadline=round_deadline)
    if probe["status"] != "available":
        result = {"stop":"az_inference_unavailable", "preflight":probe, "provider":"az", "model":MODEL,
                  "resources":probe["accounting"],"units":[{"id":u["id"],"status":"not_run"} for u in manifest["units"]]}
        write(root / "summary.json",result)
        persist_resource_daemon(root)
        return result
    probe_tokens,probe_usd = probe["accounting"]["tokens"],probe["accounting"]["usd"]
    runtime_manifest = json.loads(json.dumps(manifest))
    caps = runtime_manifest["contract"]["budget"]
    caps.update(requests=caps["requests"]-1,tokens=caps["tokens"]-probe_tokens,usd=caps["usd"]-probe_usd,
                seconds=caps["seconds"]-probe["elapsed_seconds"])
    if round_deadline is not None:
        caps["seconds"] = min(caps["seconds"],round_deadline-time.time())
        runtime_manifest["round_deadline_epoch"] = round_deadline
    if any(v <= 0 for v in caps.values()):
        result={"stop":"preflight_exhausted_budget","preflight":probe,"units":[{"id":u["id"],"status":"not_run"} for u in manifest["units"]]}
        write(root / "summary.json",result); persist_resource_daemon(root); return result
    runtime_manifest["preflight_allocation"]={"original_contract_hash":contract["content_hash"],"requests":1,"tokens":probe_tokens,"usd":probe_usd,"ref":"inference-preflight.json"}
    runtime_manifest["contract"]["content_hash"]=digest({k:v for k,v in runtime_manifest["contract"].items() if k != "content_hash"})
    write(root / "runtime-manifest.json",runtime_manifest)
    agent = root / ".pi-agent"
    agent.mkdir()
    settings = manifest["settings"]
    write(agent / "models.json", {"providers": {"az": {"baseUrl": BASE, "api": settings["api"], "apiKey": "$OPENAI_API_KEY", "authHeader": True,
          "compat": settings["compat"], "models": [settings["model"]]}}})
    write(agent / "settings.json",settings["agent_settings"])
    env = {"PI_CODING_AGENT_DIR": str(agent), "OPENAI_API_KEY": values["OPENAI_API_KEY"], "PPT_DEMO_ROOT": str(root), "PPT_DEMO_PYTHON": os.sys.executable,
           "PPT_DEMO_MODEL": MODEL, "PPT_DEMO_THINKING": settings["thinking"], "PPT_FRESH_BATCH": "0", "PPT_DEMO_DEADLINE": str(int((time.time()+caps["seconds"])*1000)),
           "PPT_DEMO_BUDGET_USD": str(caps["usd"]), "PPT_DEMO_REQUEST_RESERVE_USD": str(settings["request_reserve"]["usd"]),
           "PPT_DEMO_REQUEST_RESERVE_TOKENS": str(settings["request_reserve"]["tokens"]), "PPT_DEMO_INPUT_USD_PER_MILLION": str(INPUT_RATE),
           "PPT_DEMO_OUTPUT_USD_PER_MILLION": str(OUTPUT_RATE), "PPT_DEMO_CACHE_READ_USD_PER_MILLION": str(CACHE_RATE),
           "PPT_DEMO_CACHE_WRITE_USD_PER_MILLION": str(CACHE_RATE)}
    if manifest["arm"] == "B":
        env["EVO_MANIFEST"] = str(root / "runtime-manifest.json")
    else:
        env["PPT_EXPERIMENT_LIMITS"] = str(root / "runtime-manifest.json")
    command = [shutil.which("node"), str(PROJECT / "node_modules/@earendil-works/pi-coding-agent/dist/cli.js"), "--mode", "rpc", "--no-context-files", "--no-extensions", "--no-skills",
               "--no-prompt-templates", "--no-builtin-tools", "--extension", str(PROJECT / "demo/ppt_demo_extension.ts"), "--provider", "az", "--model", MODEL,
               "--thinking", settings["thinking"], "--session", str(root / "session.jsonl")]
    deadline = time.monotonic()+caps["seconds"]
    result = {"stop": "running", "provider": "az", "model": MODEL, "arm": manifest["arm"], "units": [{"id":u["id"],"status":"not_delivered"} for u in manifest["units"]]}
    def record(event):
        if event.get("type") != "message_update":
            with (root / "pi-events.jsonl").open("a",encoding="utf-8") as stream:
                stream.write(json.dumps(event,ensure_ascii=False).replace(values["OPENAI_API_KEY"],"[redacted]")+"\n")
        # Retry transitions are already recorded in pi-events.jsonl. The
        # existing provider dispatch/usage ledgers retain each charged attempt.
        if event.get("type") in ("auto_retry_start", "auto_retry_end"):
            persist_resource_daemon(root)
    started = time.monotonic()
    handled_resets = set()
    try:
        with PiKernel(command,cwd=str(root / "workspace"),env=env,timeout=90,deadline=deadline,event_sink=record) as kernel:
            message = "Complete the supplied presentation brief using data/instructions.md, data/material.txt and data/environment.md."
            while time.monotonic() < deadline:
                reply = kernel.prompt(message)
                if reply.get("success") is False:
                    raise RuntimeError(str(reply))
                events = kernel.wait_for_agent_events(timeout=max(1,deadline-time.monotonic()),idle_timeout=300)
                state_path = root / ".harness/ppt-loop.json"
                state = json.loads(state_path.read_text(encoding="utf-8")) if state_path.exists() else {}
                if (root / "budget-stop.json").exists():
                    result["stop"] = "budget_or_integrity_stop"
                    break
                saved = json.loads((root / ".harness/live-self.json").read_text(encoding="utf-8"))
                ledger = saved.get("root",{}).get("ledger",[])
                if state.get("complete") and not saved.get("root",{}).get("queue"):
                    result["stop"] = "delivered"
                    break
                resets = [r for r in ledger if r["type"] == "active_reset_authorized" and r["ref"] not in handled_resets]
                if resets:
                    reset = resets[-1]
                    if saved["root"].get("resetInProgress") and not any(e.get("type")=="compaction_end" for e in events):
                        kernel.wait_for_event({"compaction_end"},timeout=max(1,deadline-time.monotonic()))
                    # Complete Pi's asynchronous callback before resuming the same
                    # continuation. This is a service action, no model/summarizer.
                    kernel.send("get_state")
                    saved=json.loads((root / ".harness/live-self.json").read_text(encoding="utf-8"))
                    closed=[r for r in saved["root"]["ledger"] if r["type"] in ("active_reset_completed","active_reset_failed") and r["value"]["id"] == reset["value"]["id"]]
                    if not closed:
                        result["stop"]="reset_unresolved"; break
                    handled_resets.add(reset["ref"])
                    message="Continue this same serial root after its requested context reset returned its recorded result."
                    continue
                latest = [e.get("message",{}) for e in events if e.get("type") == "message_end" and e.get("message",{}).get("role") == "assistant"]
                if latest and latest[-1].get("stopReason") in ("error","aborted"):
                    result.update(stop="provider_error",error=latest[-1].get("errorMessage",latest[-1]["stopReason"]))
                    break
                if latest and latest[-1].get("stopReason") == "length":
                    # The completed bounded response is part of this same history,
                    # not an identical retry or a second decision-maker.
                    message = json.dumps({"event":"provider_response_incomplete","stopReason":"length",
                                          "continuation":"same serial session; prior response and tool receipts retained"})
                    continue
                pending = saved.get("root",{}).get("queue",[])
                # A normal end gets at most its queued contract review. No repeated window entrance.
                if not pending:
                    result["stop"] = "plain_text_end"
                    break
                message = "Continue the queued boundary in this same root and serial session."
            else:
                result["stop"] = "time_budget"
    except Exception as error:
        result.update(stop="budget_or_integrity_stop" if (root / "budget-stop.json").exists() else "runtime_or_provider_error",
                      error=str(error).replace(values["OPENAI_API_KEY"],"[redacted]"))
    result["elapsed_seconds"] = time.monotonic()-started
    result["preflight"] = {"requests":1,"tokens":probe_tokens,"usd":probe_usd,"seconds":probe["elapsed_seconds"],"returned_model":probe["returned_model"]}
    result["resources"] = resource_usage(root,settings["request_reserve"])
    result["resources"].update(requests=result["resources"]["requests"]+1,tokens=result["resources"]["tokens"]+probe_tokens,
                               usd=result["resources"]["usd"]+probe_usd,seconds=result["elapsed_seconds"]+probe["elapsed_seconds"])
    saved_path = root / ".harness/live-self.json"
    if saved_path.exists():
        saved = json.loads(saved_path.read_text(encoding="utf-8")); r = saved.get("root",{})
        result.update(root_id=r.get("root_id"),self_revision=r.get("serial"),legacy_self_revision=saved.get("snapshot",{}).get("selfRevision"),engineering_commit=manifest["engineering_commit"])
        delivered = {row["value"]["unit"] for row in r.get("ledger",[]) if row["type"] == "unit_delivered"}
        result["units"] = [{"id":u["id"],"status":"delivered" if u["id"] in delivered else "not_delivered"} for u in manifest["units"]]
        result["runtime_activations"] = [row for row in r.get("ledger",[]) if row["type"] == "reflection_activated"]
        result["reviews"] = [row for row in r.get("ledger",[]) if row["type"] in ("mode_entered","review_closed","validation_interpreted","validation_enacted")]
    # Apply the identical narrow checker to the A arm's final file offline. It
    # has no submit_unit protocol; do not label this as in-run unit delivery.
    delivery = root / "delivery/presentation.html"
    if delivery.exists():
        visible = re.sub(r"<[^>]*>"," ",re.sub(r"<(script|style)\b[^>]*>[\s\S]*?</\1>"," ",delivery.read_text(encoding="utf-8"),flags=re.I))
        result["final_unit_probes"]=[{"id":u["id"],"literal_matches":[{"text":x,"found":x.lower() in visible.lower()} for x in u["required"]],"citation_found":u["citation"] in visible} for u in manifest["units"]]
        if manifest["arm"] == "A":
            result["units"]=[{"id":u["id"],"status":"whole_deck_delivered_unit_quality_unverified"} for u in manifest["units"]]
    persist_resource_daemon(root)
    write(root / "summary.json",result)
    return result


def run_round(root: Path, source: Path, registration: Path, plan: dict, authority: str):
    """Explicit per-phase allocations within one approved total; no stage-2 auto launch."""
    if root.exists():
        raise ValueError("round requires a fresh directory")
    shared = plan.get("shared_remaining",False)
    phases = plan.get("phases")
    if phases is None:
        phases = [{"name":name,"arm":arm,"caps":caps} for name,arm,caps in zip(
            ("calibration-A","sample-B1","sample-B2"),("A","B","B"),
            (plan["calibration_caps"],plan["b_caps"],plan["b_caps"]))]
    elif [p["name"] for p in phases] != ["sample-B1","sample-B2","calibration-A"] or [p["arm"] for p in phases] != ["B","B","A"] or not shared:
        raise ValueError("explicit verification schedule requires shared B1 -> B2 -> A")
    allocations=[p["caps"] for p in phases]
    for key in ("requests","tokens","seconds","usd","storage_bytes"):
        if any(c.get(key,0) <= 0 for c in allocations) or (max(c[key] for c in allocations) if shared else sum(c[key] for c in allocations)) > plan["total_caps"][key]:
            raise ValueError(f"round allocation exceeds authorized total {key}")
    if "phases" not in plan and (allocations[0]["requests"] > 60 or allocations[0]["seconds"] > 1800):
        raise ValueError("A calibration exceeds FINAL 30min/60-request starting ceiling")
    if "phases" in plan:
        ceilings = {k:math.floor(v*.45) if k in ("requests","tokens","storage_bytes") else v*.45 for k,v in plan["total_caps"].items()}
        if any(c[k] > ceilings[k] for c in allocations[:2] for k in ceilings):
            raise ValueError("verification B arm exceeds 45% ceiling")
    root.mkdir(parents=True)
    write(root / "round-plan.json",{**plan,"authority":authority,"stage2":"requires a separately registered comparison; not launched by this runner"})
    results=[]
    started = time.monotonic()
    round_deadline = time.time()+plan["total_caps"]["seconds"]
    for phase in phases:
        name,arm,caps = phase["name"],phase["arm"],phase["caps"]
        if shared:
            spent = {k:sum(r.get("resources",{}).get(k,0) for r in results) for k in ("requests","tokens","usd")}
            spent["seconds"] = time.monotonic()-started
            spent["storage_bytes"] = sum(p.stat().st_size for p in root.rglob('*') if p.is_file())
            caps = {k:min(caps[k],plan["total_caps"][k]-spent[k]) for k in caps}
            if any(v <= 0 for v in caps.values()):
                write(root / "round-stop.json",{"reason":"aggregate cap exhausted", "spent":spent}); break
        phase_deadline = min(round_deadline,time.time()+caps["seconds"])
        freeze(root/name,source,registration,caps,authority,arm)
        result=run(root/name,round_deadline=phase_deadline); results.append({"phase":name,**result})
        write(root / "round-results.json",results)
        if not shared and result["stop"] in ("az_unavailable","az_inference_unavailable","provider_error","runtime_or_provider_error"):
            break
        if "resources" not in result:
            break
        if arm == "A" and "phases" not in plan:
            ratios={k:result["resources"][k]/plan["b_caps"][k] for k in ("requests","tokens","seconds","usd")}
            write(root / "calibration.json",{"ratios":ratios,"target":[0.7,0.9],"baseline_complete":result["stop"]=="delivered"})
            if not shared and (result["stop"] != "delivered" or not 0.7 <= max(ratios.values()) <= 0.9):
                write(root / "round-stop.json",{"reason":"calibration incomplete or outside target; freeze a revised bounded protocol before confirmatory samples"})
                break
    return results


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root",required=True,type=Path)
    parser.add_argument("--source",type=Path,default=PROJECT / "demo/ppt-cases/bank-of-america-3q21/assets")
    parser.add_argument("--registration",type=Path)
    parser.add_argument("--caps",type=Path,help="JSON with authorized requests/tokens/seconds/usd/storage_bytes")
    parser.add_argument("--authority",help="source of numeric resource authorization")
    parser.add_argument("--arm",choices=["A","B"],default="B")
    parser.add_argument("--run",action="store_true")
    parser.add_argument("--prepare-only",action="store_true",help="freeze draft task inputs and local rendering, without an authorized run manifest or any inference")
    parser.add_argument("--round-plan",type=Path,help="JSON: total_caps, calibration_caps, b_caps; all within the named numeric authorization")
    args = parser.parse_args()
    root = args.root.resolve()
    if not root.is_relative_to(PROJECT):
        parser.error("run root must remain in the worktree")
    if args.prepare_only:
        prepare(root,args.source.resolve())
        (root / "workspace/AGENTS.md").unlink()
        units=content_units((root / "workspace/data/material.txt").read_text(encoding="utf-8"))
        write(root / "draft-plan.json",{"status":"not_run_missing_numeric_authorization","provider":"az","model":MODEL,"units":units,
            "sources":{p.name:file_hash(p) for p in (root / "workspace/data").iterdir() if p.is_file()},
            "settings":local_settings(args.registration) if args.registration else None,"renderer_preflight":renderer_preflight(root)})
        write(root / "units.json",units)
        print(json.dumps({"prepared":str(root),"units":len(units),"inference_requests":0})); return
    if args.round_plan:
        if not args.registration or not args.authority:
            parser.error("round requires --registration and --authority")
        print(json.dumps(run_round(root,args.source.resolve(),args.registration.resolve(),json.loads(args.round_plan.read_text(encoding="utf-8")),args.authority),ensure_ascii=False)); return
    if args.caps:
        if not args.registration or not args.authority:
            parser.error("freeze requires --registration and --authority")
        manifest = freeze(root,args.source.resolve(),args.registration.resolve(),json.loads(args.caps.read_text(encoding="utf-8")),args.authority,args.arm)
        print(json.dumps({"frozen":str(root),"units":len(manifest["units"])}))
    if args.run:
        print(json.dumps(run(root),ensure_ascii=False))
    elif not args.caps:
        parser.error("provide --caps to freeze, or --run with an existing frozen manifest")


if __name__ == "__main__":
    main()
