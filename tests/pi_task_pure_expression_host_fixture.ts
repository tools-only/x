import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { grantOwnContextRefs, installTaskResourceReader } from "../demo/pi_task_resource_store.ts";
import { registerArcObservationSnapshot } from "../demo/pi_arc_observation_snapshot.ts";
import { preparePureExpressionInput } from "../demo/pi_task_pure_expression_host.ts";

function fakePi(): any {
	return { tools: new Map(), handlers: [],
		registerTool(definition: any) { this.tools.set(definition.name, definition); },
		on(name: string, handler: any) { this.handlers.push([name, handler]); },
		getAllTools() { return [...this.tools.values()]; }, getActiveTools() { return [...this.tools.keys()]; }, setActiveTools() {} };
}

const state = (value: number) => ({ game_id: "g", state: "PLAYING", levels_completed: 0, win_levels: 1,
	guid: "id", full_reset: false, available_actions: ["ACTION1"], agent_available_actions: ["ACTION1"],
	frames: [[[value, 2], [3, 4]]], action_budget: { used: value, maximum: 10, total_used: value,
		total_maximum: 10, level: 0, baseline_actions: [5], multiplier: 2 } });

export default function hostFixture(pi: ExtensionAPI) {
	const root = resolve(process.env.PI_AUTORESEARCH_E2E_ROOT ?? ".");
	pi.registerTool({ name: "pure_host_fixture", label: "Pure expression host fixture",
		description: "Exercise exact binding and snapshot host contracts.",
		parameters: Type.Object({ scenario: Type.String() }),
		async execute(_id, params) {
			let output: Record<string, unknown>;
            if (params.scenario === "capture" || params.scenario === "capture_changed") {
                const snapshot = registerArcObservationSnapshot(root, state(params.scenario === "capture" ? 0 : 1));
				output = { ref: snapshot.ref, content_sha256: snapshot.record.content_sha256 };
			} else if (params.scenario === "authorization") {
				const snapshot = registerArcObservationSnapshot(root, state(0), { captured_at: "2026-01-01T00:00:00Z" });
				const envelope = { parameters: { pick: 1 }, bindings: [{ name: "grid", ref: snapshot.ref, path: ["public_state", "frames", 0] }] };
				const uninitialized = fakePi(); let denied = "";
				try { preparePureExpressionInput(uninitialized, root, envelope, { max_input_bytes: 10_000 }); } catch (error) { denied = (error as Error).message; }
				const parent = fakePi(); installTaskResourceReader(parent, root);
				const prepared = preparePureExpressionInput(parent, root, envelope, { max_input_bytes: 10_000 });
				const child = fakePi(); process.env.PI_TASK_CHILD = "1"; installTaskResourceReader(child, root, []);
				let childDenied = ""; try { preparePureExpressionInput(child, root, envelope, { max_input_bytes: 10_000 }); } catch (error) { childDenied = (error as Error).message; }
				installTaskResourceReader(child, root, [snapshot.ref]);
				let grantedChild = ""; try { preparePureExpressionInput(child, root, envelope, { max_input_bytes: 10_000 }); } catch (error) { grantedChild = (error as Error).message; }
				delete process.env.PI_TASK_CHILD;
				output = { denied, childDenied, grantedChild, prepared };
			} else if (params.scenario === "child_order") {
				const firstSnapshot = registerArcObservationSnapshot(root, state(0));
				process.env.PI_TASK_CHILD = "1";
				const first = fakePi(); installTaskResourceReader(first, root); installTaskResourceReader(first, root, [firstSnapshot.ref]);
				const second = fakePi(); installTaskResourceReader(second, root, [firstSnapshot.ref]); installTaskResourceReader(second, root);
				const wildcard = fakePi(); installTaskResourceReader(wildcard, root, ["observation_snapshot:*"]);
				const secondSnapshot = registerArcObservationSnapshot(root, state(1));
				const reads: string[] = [];
				for (const child of [first, second]) {
					const reader = child.tools.get("task_resource");
					try { await reader.execute("ok", { action: "read", ref: firstSnapshot.ref }); reads.push("allowed"); } catch (error) { reads.push((error as Error).message); }
					try { await reader.execute("no", { action: "read", ref: secondSnapshot.ref }); reads.push("bad"); } catch (error) { reads.push((error as Error).message); }
				}
				const reader = wildcard.tools.get("task_resource");
				const inspected = await reader.execute("i", { action: "inspect", kind: "observation_snapshot" });
				let wildcardRead = ""; try { await reader.execute("r", { action: "read", ref: secondSnapshot.ref }); } catch (error) { wildcardRead = (error as Error).message; }
				grantOwnContextRefs(wildcard, [secondSnapshot.ref, "context:own@v1"]);
				let afterGrant = ""; try { await reader.execute("r2", { action: "read", ref: secondSnapshot.ref }); } catch (error) { afterGrant = (error as Error).message; }
				delete process.env.PI_TASK_CHILD;
				output = { reads, inspect: inspected.details, wildcardRead, afterGrant };
			} else if (params.scenario === "snapshot") {
				const source: any = { ...state(0), action_budget: { ...state(0).action_budget, evaluator_secret: "nested-secret" },
					private_state: "top-secret", credentials: { token: "secret" }, adapter: { private: "secret" } };
				const firstSnapshot = registerArcObservationSnapshot(root, source, { captured_at: "2026-01-01T00:00:00Z" });
				source.frames[0][0][0] = 99; source.action_budget.total_used = 1;
				const secondSnapshot = registerArcObservationSnapshot(root, source, { captured_at: "2026-01-01T00:01:00Z" });
				const parent = fakePi(); installTaskResourceReader(parent, root);
				const bind = (ref: string) => preparePureExpressionInput(parent, root,
					{ parameters: {}, bindings: [{ name: "grid", ref, path: ["public_state", "frames", 0] }] },
					{ max_input_bytes: 10_000, max_scan_bytes: 100_000 });
				const old = bind(firstSnapshot.ref), current = bind(secondSnapshot.ref);
				let traversal = ""; try { bind("observation_snapshot:../latest@v1"); } catch (error) { traversal = (error as Error).message; }
				let smallScan = ""; try { preparePureExpressionInput(parent, root,
					{ parameters: {}, bindings: [{ name: "x", ref: firstSnapshot.ref, path: [] }] },
					{ max_input_bytes: 10_000, max_scan_bytes: 10 }); } catch (error) { smallScan = (error as Error).message; }
				output = { old, current, traversal, smallScan,
					file: readFileSync(resolve(root, "observation-snapshots.jsonl"), "utf8") };
			} else if (params.scenario === "epoch_cutoff") {
				const firstSnapshot = registerArcObservationSnapshot(root, state(0), {
					bridge_events: { after: 0, next: 1, events: [{ event: "forced_action", action: "RESET" }] },
				});
				const secondSnapshot = registerArcObservationSnapshot(root, { ...state(1), levels_completed: 1 }, {
					bridge_events: { after: 1, next: 2, events: [{ event: "action", action: "ACTION1",
						frame: { public_transition: { level_changed: true } } }] },
				});
				const parent = fakePi(); installTaskResourceReader(parent, root);
				const prepared = preparePureExpressionInput(parent, root, { bindings: [
					{ name: "old", ref: firstSnapshot.ref, path: ["public_state", "frames", 0] },
					{ name: "current", ref: secondSnapshot.ref, path: ["public_state", "frames", 0] },
				] }, { max_input_bytes: 10_000 });
				const reset = registerArcObservationSnapshot(root, { ...state(1), levels_completed: 1 }, {
					bridge_events: { after: 2, next: 3, events: [{ event: "action", action: "RESET" }] },
				});
				const repeated = registerArcObservationSnapshot(root, { ...state(1), levels_completed: 1 }, {
					bridge_events: { after: 3, next: 3, events: [] },
				});
				const unknown = registerArcObservationSnapshot(root, state(2));
				const gap = registerArcObservationSnapshot(root, state(3), {
					bridge_events: { after: 5, next: 6, events: [{ event: "action", action: "RESET" }] },
				});
				let invalid = "";
				const file = resolve(root, "observation-snapshots.jsonl"), before = readFileSync(file, "utf8");
				try { registerArcObservationSnapshot(root, state(4), {
					bridge_events: { after: 6, next: 9, events: [] },
				}); } catch (error) { invalid = (error as Error).message; }
				output = { first: firstSnapshot.record, second: secondSnapshot.record, prepared, unknown: unknown.record,
					reset: reset.record, repeated: repeated.record, gap: gap.record, invalid, unchanged: before === readFileSync(file, "utf8") };
			} else if (params.scenario === "invalid_envelope") {
				const snapshot = registerArcObservationSnapshot(root, state(0));
				const parent = fakePi(); installTaskResourceReader(parent, root);
				const bad: unknown[] = [
					{ parameters: { grid: 1 }, bindings: [{ name: "grid", ref: snapshot.ref, path: [] }] },
					{ parameters: {}, bindings: [{ name: "a", ref: snapshot.ref, path: [] }, { name: "a", ref: snapshot.ref, path: [] }] },
					{ parameters: {}, bindings: [{ name: "x", ref: snapshot.ref, path: ["public_state", "missing"] }] },
					{ parameters: {}, bindings: [{ name: "x", ref: snapshot.ref, path: ["constructor"] }] },
					{ parameters: { value: Number.NaN }, bindings: [] },
					{ parameters: { value: undefined }, bindings: [] },
					{ parameters: { value: new Date() }, bindings: [] },
					{ parameters: { value: "\u0000".repeat(2_000) }, bindings: [] },
					{ parameters: { value: "\ud800".repeat(2_000) }, bindings: [] },
				];
				const errors = bad.map((value) => { try { preparePureExpressionInput(parent, root, value, { max_input_bytes: 10_000 }); return "bad"; } catch (error) { return (error as Error).message; } });
				let rootError = ""; try { installTaskResourceReader(parent, resolve(root, "other-task")); } catch (error) { rootError = (error as Error).message; }
				output = { errors, rootError };
			} else if (params.scenario === "current_grid") {
				const parent = fakePi(); installTaskResourceReader(parent, root);
				const limits = { max_input_bytes: 10_000 };
				const error = (fn: () => unknown) => { try { fn(); return "NOT_REJECTED"; } catch (e) { return (e as Error).message; } };
				const absent = error(() => preparePureExpressionInput(parent, root, { current_grid: true }, limits));
				const noContext = preparePureExpressionInput(parent, root, {}, limits);
				const snapshot = registerArcObservationSnapshot(root, { ...state(0), frames: [[[1]], [[8]]] });
				const exact = { parameters: { bias: 1 }, bindings: [{ name: "grid", ref: snapshot.ref, path: ["public_state", "frames", "1"] }] };
				const shortcut = { current_grid: true, parameters: { bias: 1 } };
				const before = JSON.stringify(shortcut);
				const direct = preparePureExpressionInput(parent, root, shortcut, limits);
				const explicit = preparePureExpressionInput(parent, root, exact, limits);
				const disabled = preparePureExpressionInput(parent, root, { current_grid: false, parameters: { grid: [[5]] } }, limits);
				const negative = {
					conflict: error(() => preparePureExpressionInput(parent, root, { ...shortcut, parameters: { grid: [] } }, limits)),
					bindingConflict: error(() => preparePureExpressionInput(parent, root, { ...exact, current_grid: true }, limits)),
					type: error(() => preparePureExpressionInput(parent, root, { current_grid: "true" }, limits)),
					capacity: error(() => preparePureExpressionInput(parent, root, { current_grid: true, bindings: Array.from({length:64}, (_,i) => ({name:`g${i}`,ref:snapshot.ref,path:[]})) }, limits)),
					scan: error(() => preparePureExpressionInput(parent, root, shortcut, { ...limits, max_scan_bytes: 1 })),
					input: error(() => preparePureExpressionInput(parent, root, shortcut, { max_input_bytes: 13 })),
					work: error(() => preparePureExpressionInput(parent, root, shortcut, { ...limits, max_preparation_bytes: 20 })),
					uninitialized: error(() => preparePureExpressionInput(fakePi(), root, shortcut, limits)),
					crossRoot: error(() => preparePureExpressionInput(parent, resolve(root, "other"), shortcut, limits)),
				};
				const child = fakePi(); process.env.PI_TASK_CHILD = "1";
				let childDenied: string;
				try {
					installTaskResourceReader(child, root, [snapshot.ref]);
					childDenied = error(() => preparePureExpressionInput(child, root, shortcut, limits));
				} finally { delete process.env.PI_TASK_CHILD; }
				registerArcObservationSnapshot(root, { ...state(1), frames: [[[9]], []] });
				const empty = error(() => preparePureExpressionInput(parent, root, shortcut, limits));
				output = { absent, noContext, direct, explicit, disabled, negative, childDenied, empty,
					request_unchanged: before === JSON.stringify(shortcut) };
			} else if (params.scenario === "budgets") {
				const refs = [];
				for (let index = 0; index < 4; index += 1) refs.push(registerArcObservationSnapshot(root, state(index)).ref);
				const parent = fakePi(); installTaskResourceReader(parent, root);
				const fileBytes = statSync(resolve(root, "observation-snapshots.jsonl")).size;
				const currentOnly = preparePureExpressionInput(parent, root,
					{ parameters: {}, bindings: [{ name: "cell", ref: refs.at(-1), path: ["public_state", "frames", 0, 0, 0] }] },
					{ max_input_bytes: 10_000, max_scan_bytes: fileBytes + 10 });
				let oldDoubleScan = "";
				try { preparePureExpressionInput(parent, root,
					{ parameters: {}, bindings: [{ name: "cell", ref: refs[0], path: ["public_state", "frames", 0, 0, 0] }] },
					{ max_input_bytes: 10_000, max_scan_bytes: fileBytes + 10 }); }
				catch (error) { oldDoubleScan = (error as Error).message; }
				const multi = { parameters: {}, bindings: refs.slice(0, 3).map((ref, index) => ({ name: `v${index}`, ref, path: ["public_state", "frames", 0, 0, 0] })) };
				let scanError = ""; try { preparePureExpressionInput(parent, root, multi, { max_input_bytes: 10_000, max_scan_bytes: fileBytes * 2 + 10 }); } catch (error) { scanError = (error as Error).message; }
				const aliases = { parameters: {}, bindings: Array.from({ length: 64 }, (_, index) => ({ name: `a${index}`, ref: refs[0], path: ["public_state", "frames", 0, 0, 0] })) };
				const cached = preparePureExpressionInput(parent, root, aliases, { max_input_bytes: 10_000, max_scan_bytes: fileBytes * 3, max_preparation_bytes: 100_000 });
				let workError = ""; try { preparePureExpressionInput(parent, root, aliases, { max_input_bytes: 10_000, max_scan_bytes: fileBytes * 3, max_preparation_bytes: 1_000 }); } catch (error) { workError = (error as Error).message; }
				output = { fileBytes, scanError, cached: cached.preparation, workError,
					currentOnly: currentOnly.preparation, oldDoubleScan };
			} else throw new Error(`unknown scenario: ${params.scenario}`);
			return { content: [{ type: "text", text: JSON.stringify(output) }], details: output };
		},
	});
}
