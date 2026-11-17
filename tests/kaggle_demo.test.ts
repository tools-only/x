import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function runDir() {
  const root = mkdtempSync(join(tmpdir(), "kaggle-demo-"));
  const workspace = join(root, "workspace");
  for (const dir of ["data/raw", "work/snippets", "submissions", "notes", "prompts", "skills", "agents", "methods", "results", "config"])
    mkdirSync(join(workspace, dir), { recursive: true });
  writeFileSync(join(workspace, "data/competition.json"), JSON.stringify({
    slug: "synthetic", title: "Synthetic", url: "https://example.invalid", metric: "ROC AUC",
    higher_is_better: true, deadline: "2026-12-31", target_top: 10,
  }));
  writeFileSync(join(workspace, "data/raw/sample_submission.csv"), "id,target\na,0\nb,0\nc,0\n");
  writeFileSync(join(workspace, "data/raw/train.csv"), "id,target\na,1\nb,0\nc,1\n");
  return root;
}

function fakePi() {
  const tools = new Map<string, any>();
  const handlers = new Map<string, any>();
  return {
    tools, handlers,
    pi: {
      registerTool: (tool: any) => tools.set(tool.name, tool),
      on: (name: string, handler: any) => handlers.set(name, handler),
      setActiveTools: () => undefined,
      getThinkingLevel: () => "high",
    },
  };
}

async function boot(seed?: (workspace: string) => void) {
  const root = runDir();
  if (seed) seed(join(root, "workspace"));
  process.env.KAGGLE_DEMO_ROOT = root;
  process.env.KAGGLE_DEMO_PYTHON = process.env.KAGGLE_DEMO_PYTHON ?? "python";
  process.env.KAGGLE_DEMO_DEADLINE = String(Date.now() + 3_600_000);
  process.env.KAGGLE_DEMO_BUDGET_USD = "12";
  process.env.KAGGLE_DEMO_REQUEST_RESERVE_USD = "0.1";
  const { default: extension } = await import("../demo/kaggle_extension.ts");
  const { tools, handlers, pi } = fakePi();
  extension(pi as any);
  const start = await handlers.get("before_agent_start")({ prompt: "KAGGLE_START" });
  return { root, tools, handlers, start };
}

test("run_python executes host Python in the workspace", async () => {
  const { tools } = await boot();
  const result = await tools.get("run_python").execute("1", { code: "import os, sys\nprint(os.getcwd())\nprint(sys.argv[1])", args: { answer: 42 } }, undefined, undefined, {});
  const body = JSON.parse(result.content[0].text);
  assert.equal(body.ok, true);
  assert.match(body.stdout, /42/);
});

test("tool schemas stay valid for strict OpenAI-compatible providers", async () => {
  const { tools } = await boot();
  const walk = (node: any, path: string) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) return node.forEach((item, index) => walk(item, `${path}[${index}]`));
    if (node.type === "object") assert.ok(Array.isArray(node.required), `${path} lacks a required array`);
    for (const [key, value] of Object.entries(node)) walk(value, `${path}.${key}`);
  };
  for (const [name, tool] of tools) {
    assert.doesNotMatch(JSON.stringify(tool.parameters), /"type"\s*:\s*"null"/, `${name} exposes a null type`);
    walk(tool.parameters, name);
  }
});

test("bundled self-evolution skill registers with the binder", async () => {
  const { root, start } = await boot();
  assert.match(start.message.content, /self_evolution@v1/);
  const rows = readFileSync(join(root, ".harness/components.jsonl"), "utf8").trim().split("\n")
    .map(line => JSON.parse(line)).filter((row: any) => row.path === "skills/self_evolution/SKILL.md");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].kind, "skill");
  assert.equal(rows[0].error, undefined);
});

test("a stale seeded skill with a mismatched name is re-seeded", async () => {
  const { root, start } = await boot(workspace => {
    mkdirSync(join(workspace, "skills/self_evolution"), { recursive: true });
    writeFileSync(join(workspace, "skills/self_evolution/SKILL.md"),
      "---\nname: kaggle_self_evolution\ndescription: stale\n---\nstale\n");
  });
  assert.match(start.message.content, /self_evolution@/);
  const rows = readFileSync(join(root, ".harness/components.jsonl"), "utf8").trim().split("\n")
    .map(line => JSON.parse(line)).filter((row: any) => row.path === "skills/self_evolution/SKILL.md");
  const last = rows.at(-1);
  assert.equal(last.kind, "skill");
  assert.equal(last.error, undefined);
});

test("component descriptions reach the next provider request and resumed window", async () => {
  const { tools, handlers, start } = await boot();
  for (const [kind, name, description, content] of [
    ["prompt", "planning_rule", "Select experiments by expected information", "Compare candidate experiments."],
    ["memory", "validation_lesson", "Record validation uncertainty", "The fold spread needs attention."],
    ["skill", "review_recipe", "Check candidate evidence", "Review validation and score evidence."],
    ["tool", "check_predictions", "Check prediction counts", "def run(args):\n    return len(args)\n"],
    ["subagent", "assessor", "Review validation decisions", "Review the supplied evidence."],
  ]) {
    await tools.get("self_component").execute("1", { kind, name, description, content }, undefined, undefined, {});
  }
  const payload = { messages: [{ role: "system", content: start.systemPrompt }] };
  handlers.get("before_provider_request")({ payload });
  for (const description of ["Select experiments by expected information", "Record validation uncertainty",
    "Check candidate evidence", "Check prediction counts", "Review validation decisions"]) {
    assert.ok(payload.messages[0].content.includes(description), description);
  }
  const memory = await tools.get("read_component").execute("2", { name: "validation_lesson" }, undefined, undefined, {});
  assert.match(memory.content[0].text, /validation_lesson@v1[\s\S]*fold spread/);
  const resumed = await handlers.get("before_agent_start")({ prompt: "KAGGLE_RESUME" });
  assert.match(resumed.systemPrompt, /memory:\n- validation_lesson@v1 \| Record validation uncertainty/);
  assert.match(resumed.systemPrompt, /tool:\n- check_predictions@v1 \| Check prediction counts/);
});

test("methods are versioned, editable and runnable", async () => {
  const { root, tools } = await boot();
  const saved = await tools.get("save_method").execute("1", {
    name: "echo_args", description: "print args", body: "import json, sys\nprint(json.loads(sys.argv[1])['n'])\nprint('v1')\n",
  }, undefined, undefined, {});
  assert.equal(JSON.parse(saved.content[0].text).version, 1);
  const run1 = await tools.get("run_method").execute("2", { name: "echo_args", args: { n: 7 } }, undefined, undefined, {});
  assert.match(JSON.parse(run1.content[0].text).stdout, /7/);
  const edited = await tools.get("edit_method").execute("3", {
    name: "echo_args", old_text: "print('v1')", new_text: "print('v2')", expected_version: 1,
  }, undefined, undefined, {});
  assert.equal(JSON.parse(edited.content[0].text).version, 2);
  const old = await tools.get("run_method").execute("4", { name: "echo_args", args: { n: 1 }, version: 1 }, undefined, undefined, {});
  assert.match(JSON.parse(old.content[0].text).stdout, /v1/);
  const current = await tools.get("run_method").execute("5", { name: "echo_args", args: { n: 1 } }, undefined, undefined, {});
  assert.match(JSON.parse(current.content[0].text).stdout, /v2/);
  assert.ok(existsSync(join(root, ".harness/method-versions/echo_args@v1.py")));
});

test("kaggle_submit dry-run validates without credentials or upload", async () => {
  const { root, tools } = await boot();
  const csv = join(root, "workspace/submissions/candidate.csv");
  writeFileSync(csv, "id,target\na,0.1\nb,0.8\nc,0.4\n");
  const result = await tools.get("kaggle_submit").execute("1", {
    file: "submissions/candidate.csv", message: "baseline", cv_score: 0.91, dry_run: true,
  }, undefined, undefined, {});
  const body = JSON.parse(result.content[0].text);
  assert.equal(body.dry_run, true);
  assert.equal(body.validation.ok, true);
  assert.equal(body.validation.rows, 3);
});

function seedScores(workspace: string, rows: any[]) {
  const dir = join(workspace, "..", ".harness");
  mkdirSync(dir, { recursive: true });
  const best = rows.reduce((top: any, row: any) => !top || row.public_score > top.public_score ? row : top, null);
  writeFileSync(join(dir, "kaggle-loop.json"), JSON.stringify({
    revision: 0, complete: false, pythonRuns: 0, submissions: rows, best,
  }));
}

const reflection = {
  summary: "Shallow heavily regularized trees beat the 63-leaf baseline by 0.00069 public, and three seeds agreed.",
  hypothesis: "Shallow, heavily regularized trees generalize better than deep ones on this generator.",
  changes: ["Replaced the 63-leaf LGBM with 17-23 leaf variants", "Searched blend weights in logit space"],
  vs_previous: "0.94794 vs prior best 0.94725, +0.00069",
  verdict: "improved",
  next_steps: ["Blend regularized second-order interactions with GBDTs", "Use repeated-seed CV to shrink the 0.0025 fold SE"],
  best_public_score: 0.94794,
};

test("finish refuses before any scored submission", async () => {
  const { tools } = await boot();
  await assert.rejects(tools.get("finish").execute("1", reflection, undefined, undefined, {}),
    /at least one submission with a public score/);
});

test("finish rejects a reflection that contradicts the score history", async () => {
  const { tools } = await boot(workspace => seedScores(workspace, [
    { file: "submissions/ens_tuned.csv", public_score: 0.94794, cv_score: 0.94736 },
    { file: "submissions/blend3.csv", public_score: 0.94725, cv_score: 0.94647 },
  ]));
  await assert.rejects(tools.get("finish").execute("1",
    { ...reflection, vs_previous: "0.94725 vs prior best 0.94794, -0.00069" }, undefined, undefined, {}),
    /fell by 0\.00069 but verdict is "improved"/);
});

test("finish records a versioned window reflection", async () => {
  const { root, tools } = await boot(workspace => seedScores(workspace, [
    { file: "submissions/blend3.csv", public_score: 0.94725, cv_score: 0.94647 },
    { file: "submissions/ens_tuned.csv", public_score: 0.94794, cv_score: 0.94736 },
  ]));
  const result = await tools.get("finish").execute("1", reflection, undefined, undefined, {});
  const body = JSON.parse(result.content[0].text);
  assert.equal(body.finished, true);
  assert.equal(body.reflection, "notes/reflections/window-2.md");
  assert.equal(body.facts.delta.toFixed(5), "0.00069");
  const state = JSON.parse(readFileSync(join(root, ".harness/kaggle-loop.json"), "utf8"));
  assert.equal(state.complete, true);
  assert.equal(state.finish.verdict, "improved");
  const saved = readFileSync(join(root, "workspace/notes/reflections/window-2.md"), "utf8");
  assert.match(saved, /prior best: 0\.94725/);
  assert.match(saved, /## Next/);
  const components = readFileSync(join(root, ".harness/components.jsonl"), "utf8").trim().split("\n").map(line => JSON.parse(line));
  assert.equal(components.some((row: any) => row.path === "notes/reflections/window-2.md" && !row.error), true);
});
