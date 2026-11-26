import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { LayeredComponents, type Kind } from "../demo/arc_layered_components.ts";

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
