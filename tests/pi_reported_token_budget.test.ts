import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { installReportedTokenBudget, readReportedTokenBudget, reportedUsageTokens } from "../demo/pi_reported_token_budget.ts";

test("usage counts total once, including cache but not reasoning again", () => {
    assert.equal(reportedUsageTokens({ input: 10, cacheRead: 4, output: 8, reasoning: 6, totalTokens: 22 }), 22);
    assert.equal(reportedUsageTokens({ input: 10, cacheRead: 4, output: 8, reasoning: 6 }), 22);
    assert.equal(reportedUsageTokens({ input: 10, cacheRead: 4, cacheWrite: 2, output: 8, totalTokens: 24 }, false), 18,
        "the thin-run cap excludes cache reads/writes to match its usage.jsonl definition");
    assert.equal(reportedUsageTokens(undefined), undefined);
    assert.equal(reportedUsageTokens({ input: 10, output: 8, cacheRead: "4" }), undefined);
    assert.equal(reportedUsageTokens({ input: 10, output: 8, cacheWrite: -1 }), undefined);
});

test("a partial concurrent ledger row fails closed instead of throwing from a swallowed Pi hook", () => {
    const root = mkdtempSync(join(tmpdir(), "partial-budget-"));
    const path = join(root, "provider-token-budget.jsonl");
    writeFileSync(path, '{"event":"reported_usage","tokens":7}\n{"event":"reported_usage",');
    const state = readReportedTokenBudget(path, 12);
    assert.equal(state.reported, 7);
    assert.equal(state.unmeasured, true);
    assert.equal(state.exhausted, true);
});

test("parent and child use one ledger; missing usage fails closed", () => {
    const prior = { limit: process.env.PI_PROVIDER_MAX_REPORTED_TOKENS, root: process.env.PI_PROVIDER_TOKEN_BUDGET_ROOT,
        child: process.env.PI_TASK_CHILD };
    const shared = resolve(mkdtempSync(join(tmpdir(), "reported-budget-")));
    process.env.PI_PROVIDER_MAX_REPORTED_TOKENS = "12";
    process.env.PI_PROVIDER_TOKEN_BUDGET_ROOT = shared;
    let aborted = 0;
    const ctx = { abort() { aborted++; } };
    const fixture = (root: string) => {
        const handlers: Record<string, any> = {};
        installReportedTokenBudget({ on(n, f) { handlers[n] = f; } } as any, root);
        return handlers;
    };
    try {
        const parent = fixture(shared);
        parent.message_end({ message: { role: "assistant", usage: { totalTokens: 7 } } }, ctx);
        assert.equal(aborted, 0);
        process.env.PI_TASK_CHILD = "1";
        const child = fixture(join(shared, "isolated-child"));
        child.message_end({ message: { role: "assistant", usage: { totalTokens: 6 } } }, ctx);
        assert.equal(aborted, 1);
        const state = readReportedTokenBudget(join(shared, "provider-token-budget.jsonl"), 12);
        assert.equal(state.reported, 13);
        parent.before_provider_request({}, ctx);
        assert.equal(aborted, 2);
        child.message_end({ message: { role: "assistant" } }, ctx);
        assert.equal(readReportedTokenBudget(join(shared, "provider-token-budget.jsonl"), 12).unmeasured, true);
        assert.match(readFileSync(join(shared, "provider-token-budget.jsonl"), "utf8"), /"scope":"child"/);
    } finally {
        for (const [name, value] of [["PI_PROVIDER_MAX_REPORTED_TOKENS", prior.limit],
            ["PI_PROVIDER_TOKEN_BUDGET_ROOT", prior.root], ["PI_TASK_CHILD", prior.child]]) {
            if (value === undefined) delete process.env[name!]; else process.env[name!] = value;
        }
    }
});
