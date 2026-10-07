import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readReportedTokenBudget } from "../demo/pi_reported_token_budget.ts";

test("evaluation stops survive raised limits; historical numeric stops preserve opt-out semantics", () => {
    const root = mkdtempSync(join(tmpdir(), "admission-stop-"));
    const path = join(root, "provider-token-budget.jsonl");
    writeFileSync(path, '{"event":"reported_usage","tokens":4}\n{"event":"budget_stop","limit":3}\n');
    assert.equal(readReportedTokenBudget(path, 10).exhausted, false);
    writeFileSync(path, '{"event":"reported_usage","tokens":4}\n{"event":"budget_stop","evaluation_stopped":true}\n');
    const state = readReportedTokenBudget(path, 10);
    assert.equal(state.reported, 4);
    assert.equal(state.unmeasured, false);
    assert.equal(state.stopped, true);
    assert.equal(state.exhausted, true);
});

test("fallback marker remains a stop even when usage writes and reads recover", () => {
    const root = mkdtempSync(join(tmpdir(), "admission-marker-"));
    const path = join(root, "provider-token-budget.jsonl");
    writeFileSync(path, '{"event":"reported_usage","tokens":4}\n');
    // Existence is sufficient: a partial marker must fail closed too.
    writeFileSync(join(root, "provider-token-budget-stop.json"), '{');
    const state = readReportedTokenBudget(path, 10);
    assert.equal(state.unmeasured, false);
    assert.equal(state.stopped, true);
    assert.equal(state.exhausted, true);
});
