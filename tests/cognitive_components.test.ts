import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CognitiveComponents, type Kind } from "../demo/cognitive_components.ts";

test("component versions persist and restore without changing old versions", () => {
  const root = mkdtempSync(join(tmpdir(), "layered-components-"));
  const store = new CognitiveComponents(root);
  for (const kind of ["memory", "skill", "prompt", "subagent"] as Kind[]) {
    const summary = kind === "skill" ? "one-line method" : "";
    assert.equal(store.reflect("define", kind, "current", "first", summary).version, 1);
    assert.equal(store.reflect("redefine", kind, "current", "second", summary).version, 2);
    assert.equal(store.reflect("restore", kind, "current", undefined, summary, 1).version, 3);
    assert.equal(store.current(kind, "current")?.body, "first");
    assert.equal(store.read(kind, "current", 2).body, "second");
  }
  const reopened = new CognitiveComponents(root);
  assert.equal(reopened.current("memory", "current")?.version, 3);
  assert.throws(() => reopened.reflect("define", "memory", "current", "again"), /already exists/);
  assert.throws(() => reopened.reflect("define", "prompt", "long", "x".repeat(601)), /600/);
  assert.throws(() => reopened.read("memory", "current", 100));
  assert.equal(reopened.reflect("restore", "skill", "current", undefined, undefined, 2).summary, "one-line method");
});

test("component lifecycle stats persist reads, invocations, and publish witnesses", () => {
  const root = mkdtempSync(join(tmpdir(), "cognitive-stats-"));
  const store = new CognitiveComponents(root);
  const component = store.reflect("define", "memory", "method", "evidence", "");
  store.recordRead("memory", "method", "task", 1);
  store.recordInvocation("memory", "method", false, true, "timeout", "task", 1);
  store.recordPublishFailure("memory", "method", "syntax error", "task", 1);
  const stats = store.stats("memory", "method")!;
  assert.equal(stats.total.reads, 1);
  assert.equal(stats.total.invocations, 1);
  assert.equal(stats.total.eval_informing, 1);
  assert.equal(stats.consecutive_failures, 1);
  assert.equal(stats.last_failure_witness, "timeout");
  assert.equal(stats.consecutive_publish_failures, 1);
  assert.equal(component.version, 1);
  assert.equal(new CognitiveComponents(root).stats("memory", "method")?.total.invocations, 1);
});

