import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { LayeredComponents, normalizeVerifyExpr, type Kind } from "../demo/arc_layered_components.ts";

test("Phase 1 ACE edits one stable entry and retires without losing history", () => {
  const store = new LayeredComponents(mkdtempSync(join(tmpdir(), "ace-")));
  const first = store.reflect("add", "memory", "probe", "original");
  store.reflect("add", "memory", "other", "independent");
  const revised = store.reflect("revise", "memory", "probe", "revised");
  assert.equal(revised.id, first.id);
  assert.equal(store.read("memory", "probe", 1).body, "original");
  assert.equal(store.current("memory", "other")?.body, "independent");
  store.reflect("retire", "memory", "probe");
  assert.deepEqual(store.list("memory").map(item => item.name), ["other"]);
  assert.equal(store.reflect("restore", "memory", "probe", undefined, undefined, 2).body, "revised");
});

test("component versions persist and restore without changing old versions", () => {
  const root = mkdtempSync(join(tmpdir(), "layered-components-"));
  const store = new LayeredComponents(root);
  for (const kind of ["memory", "skill", "prompt", "subagent"] as Kind[]) {
    const summary = kind === "skill" ? "one-line method" : "";
    assert.equal(store.reflect("define", kind, "current", "first", summary).version, 1);
    assert.equal(store.reflect("redefine", kind, "current", "second", summary).version, 2);
    assert.equal(store.reflect("restore", kind, "current", undefined, summary, 1).version, 3);
    assert.equal(store.current(kind, "current")?.body, "first");
    assert.equal(store.read(kind, "current", 2).body, "second");
  }
  const reopened = new LayeredComponents(root);
  assert.equal(reopened.current("memory", "current")?.version, 3);
  assert.throws(() => reopened.reflect("define", "memory", "current", "again"), /already exists/);
  assert.throws(() => reopened.reflect("define", "prompt", "long", "x".repeat(601)), /600/);
  assert.throws(() => reopened.read("memory", "current", 100));
  assert.equal(reopened.reflect("restore", "skill", "current", undefined, undefined, 2).summary, "one-line method");
});

test("component lifecycle stats split by level, record witnesses, and persist across restarts", () => {
  const root = mkdtempSync(join(tmpdir(), "layered-stats-"));
  const store = new LayeredComponents(root);
  store.reflect("define", "tool", "scanner", "def scanner():\n  return 1", "scanner()");
  store.recordChange("tool", "scanner", 1, 2);
  store.recordInvocation("tool", "scanner", 1, 3, { ok: true, action_producing: true });
  store.recordInvocation("tool", "scanner", 2, 10, { ok: false, witness: "L2 s10 scanner: ValueError" });
  store.recordInvocation("tool", "scanner", 2, 11, { ok: false, witness: "L2 s11 scanner: KeyError" });
  store.recordPublishFailure("broken_tool", 2, 12, "SyntaxError: invalid syntax");
  store.reflect("define", "skill", "probe", "step1", "probe pattern");
  store.recordChange("skill", "probe", 1, 1);
  store.recordRead("skill", "probe", 1, 4);

  const reopened = new LayeredComponents(root);
  const st = reopened.stats("tool", "scanner")!;
  assert.equal(st.defined_level, 1);
  assert.equal(st.by_level["1"].ok, 1);
  assert.equal(st.by_level["1"].action_producing, 1);
  assert.equal(st.by_level["2"].failures, 2);
  assert.equal(st.total.invocations, 3);
  assert.equal(st.consecutive_failures, 2);
  assert.equal(st.last_failure_witness, "L2 s11 scanner: KeyError");
  assert.equal(reopened.stats("tool", "broken_tool")?.consecutive_publish_failures, 1);
  assert.equal(reopened.stats("skill", "probe")?.total.reads, 1);
});

test("memory verify validates rules, hashes canonically, and restores prior verify expressions", () => {
  const root = mkdtempSync(join(tmpdir(), "layered-verify-"));
  const store = new LayeredComponents(root);
  const v1 = store.reflect("define", "memory", "rules", "Confirmed: A", "", undefined, {
    b_rule: "t.action == 'UP'",
    a_rule: "diff(t.before_frame, t.after_frame)['count'] > 0",
  });
  assert.deepEqual(Object.keys(v1.verify ?? {}), ["a_rule", "b_rule"]);
  const v2 = store.reflect("redefine", "memory", "rules", "Confirmed: B");
  assert.equal(v2.verify, undefined);
  const v3 = store.reflect("restore", "memory", "rules", undefined, "", 1);
  assert.deepEqual(v3.verify, v1.verify);
  const reopened = new LayeredComponents(root);
  assert.deepEqual(reopened.current("memory", "rules")?.verify, v1.verify);
  assert.throws(() => reopened.reflect("define", "skill", "bad_v", "body", "sum", undefined, { r: "True" }), /memory components only/);
  assert.throws(() => reopened.reflect("redefine", "memory", "rules", "body", "", undefined, { BAD: "True" }), /lowercase/);
  assert.throws(() => reopened.reflect("redefine", "memory", "rules", "body", "", undefined, { ok: "a\nb" }), /one line/);
  assert.throws(() => reopened.reflect("redefine", "memory", "rules", "body", "", undefined,
    { r1: "True", r2: "True", r3: "True", r4: "True", r5: "True", r6: "True", r7: "True" }), /at most 6/);
});

test("normalizeVerifyExpr formats {when, assert} and wraps unscoped action-guard expressions", () => {
  assert.equal(
    normalizeVerifyExpr({ when: "t.action == 'UP'", assert: "t.after_frame.step > 0" }),
    "(t.after_frame.step > 0) if (t.action == 'UP') else None",
  );
  assert.equal(
    normalizeVerifyExpr("t.action and 'MOUSE(x=6,y=57)' in t.action and t.after_frame is not None and len(frame_diff(t.before_frame, t.after_frame).get('moved',[])) > 0"),
    "(t.after_frame is not None and len(frame_diff(t.before_frame, t.after_frame).get('moved',[])) > 0) if (t.action and 'MOUSE(x=6,y=57)' in t.action) else None",
  );
  const scoped = "diff(t.before_frame, t.after_frame)['count'] > 0 if t.action == 'UP' else None";
  assert.equal(normalizeVerifyExpr(scoped), scoped);
});

 test("Phase 2 isolates level scope, proves cross-level priors, merges and preserves history", () => {
  const store = new LayeredComponents(mkdtempSync(join(tmpdir(), "phase2-")));
  store.reflect("add", "memory", "local", "local");
  store.reflect("add", "memory", "rule", "rule", "", undefined, { rule: "True" });
  store.reflect("define", "tool", "scanner", "def scanner():\n  return 1", "scanner()");
  assert.equal(store.current("tool", "scanner")?.scope, "game");
  store.reflect("promote", "memory", "rule", undefined, "", undefined, undefined, { last_promoted_level: 1 });
  store.onLevelTransition(1, 2);
  assert.equal(store.current("memory", "local")?.status, "dormant");
  assert.equal(store.current("memory", "rule")?.status, "provisional");
  assert.equal(store.current("tool", "scanner")?.status, "active");
  store.updateProof("rule", 2, { "1": { support: 4, counter: 0 }, "2": { support: 2, counter: 0 } });
  assert.equal(store.current("memory", "rule")?.status, "provisional");
  store.updateProof("rule", 2, { "1": { support: 4, counter: 0 }, "2": { support: 3, counter: 0 } });
  assert.equal(store.current("memory", "rule")?.status, "confirmed");
  store.updateProof("rule", 2, { "2": { support: 3, counter: 1 } });
  assert.equal(store.current("memory", "rule")?.status, "contradicted");
  store.reflect("merge", "memory", "rule", "refined", "", undefined, undefined, { sources: ["local"] });
  assert.equal(store.current("memory", "local")?.retired, true);
  assert.equal(store.current("memory", "rule")?.status, "active");
  assert.equal(store.read("memory", "rule", 1).body, "rule");
 });

test("orchestration kind defaults to L5 game scope, enforces <=500 chars, and versions/restores cleanly", () => {
  const root = mkdtempSync(join(tmpdir(), "layered-orch-"));
  const store = new LayeredComponents(root);
  const v1 = store.reflect("add", "orchestration", "rhythm", "mode: EXPLORE\nhandoff: read skill -> probe\nbatch_hint: 1-2 steps\nreframe_after_deaths: 2");
  assert.equal(v1.version, 1);
  assert.equal(v1.scope, "game");
  assert.equal(v1.layer, "L5");
  assert.throws(() => store.reflect("revise", "orchestration", "rhythm", "x".repeat(501)), /500/);
  const v2 = store.reflect("revise", "orchestration", "rhythm", "mode: EXPLOIT\nhandoff: tool -> batch");
  assert.equal(v2.version, 2);
  const v3 = store.reflect("restore", "orchestration", "rhythm", undefined, "", 1);
  assert.equal(v3.version, 3);
  assert.match(v3.body, /mode: EXPLORE/);
  store.reflect("retire", "orchestration", "rhythm");
  assert.deepEqual(store.list("orchestration"), []);
});
