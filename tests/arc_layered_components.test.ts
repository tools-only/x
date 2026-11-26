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

test("memory checks are versioned and restore their exact earlier expressions", () => {
  const store = new LayeredComponents(mkdtempSync(join(tmpdir(), "layered-verify-")));
  const first = store.reflect("define", "memory", "current", "hypothesis", "", undefined, { moves: "t.action == 'UP'" });
  assert.deepEqual(store.read("memory", "current", 1).verify, first.verify);
  store.reflect("redefine", "memory", "current", "revised", "", undefined, { moves: "t.action == 'DOWN'" });
  assert.deepEqual(store.reflect("restore", "memory", "current", undefined, "", 1).verify, first.verify);
  assert.throws(() => store.reflect("define", "memory", "bad", "x", "", undefined, { "bad/name": "True" }), /verify/);
});
