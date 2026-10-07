/** Final native provider window admission; reported spending stays separate. */
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { FINAL_PROVIDER_PAYLOAD_EVENT, FINAL_PROVIDER_OBSERVER_INSTALLED_EVENT,
	type FinalProviderPayloadEvent } from "./pi_final_provider_payload.ts";

const states = new WeakMap<object, { declined: boolean; responseSeen: boolean }>();
export function providerWindowRequestDeclined(pi: ExtensionAPI): boolean {
	const state = states.get(pi);
	return state?.declined === true && !state.responseSeen;
}

export function installProviderRequestAdmission(pi: ExtensionAPI, root: string, scope: string,
	measure: (payload: unknown) => Record<string, unknown>): void {
	if (process.env.PI_PROVIDER_CONTEXT_ADMISSION !== "enabled" || states.has(pi)) return;
	const state = { declined: false, responseSeen: false };
	states.set(pi, state);
	mkdirSync(root, { recursive: true });
	const path = join(root, "provider-window-admission.jsonl");
	const positive = (value: unknown) => Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : undefined;
	const saveStop = (row: Record<string, unknown>, reason: string | undefined) => {
		const stopName = process.env.PI_TASK_CHILD === "1"
			? `provider-window-admission-child-${process.pid}-stop.json` : "provider-window-admission-stop.json";
		try { writeFileSync(join(root, stopName), JSON.stringify({
			...row, status: "declined", reason, provider_request_admitted: false, scope,
			process_id: process.pid, recordedAt: new Date().toISOString() }), { flag: "wx" }); } catch {}
	};
	let observerInstalled = false;
	pi.events.on(FINAL_PROVIDER_OBSERVER_INSTALLED_EVENT, () => { observerInstalled = true; });
	pi.on("before_provider_request", (_event, ctx) => {
		if (observerInstalled) return;
		state.declined = true;
		ctx.abort();
		const reason = "final_provider_observer_unavailable";
		const row = { status: "declined", reason, scope, process_id: process.pid, recordedAt: new Date().toISOString() };
		appendFileSync(path, JSON.stringify(row) + "\n");
		saveStop(row, reason);
	});
	pi.events.on(FINAL_PROVIDER_PAYLOAD_EVENT, value => {
		const event = value as FinalProviderPayloadEvent;
		const { ctx } = event;
		if (state.declined) { ctx.abort(); return; }
		state.responseSeen = false;
		let reason: string | undefined;
		let row: Record<string, any> = {};
		try {
			const stats = measure(event.payload);
			const payload = event.payload as Record<string, any>;
			const declared = positive(ctx.model?.contextWindow);
			const configured = process.env.PI_PROVIDER_CONTEXT_CAPACITY;
			const requested = configured === undefined ? declared : positive(configured);
			const capacity = requested && declared ? Math.min(requested, declared) : requested;
			const outputKeys = ["max_completion_tokens", "max_tokens", "max_output_tokens"].filter(key => Object.hasOwn(payload ?? {}, key));
			const outputs = outputKeys.map(key => positive(payload[key]));
			const output = outputs.length && outputs.every(value => value !== undefined && value === outputs[0]) ? outputs[0] : undefined;
			const configuredMargin = process.env.PI_PROVIDER_CONTEXT_MARGIN;
			const margin = configuredMargin === undefined ? Math.max(1024, Math.ceil((capacity ?? 0) * 0.05)) : positive(configuredMargin);
			const imageCount = Number(stats.image_count);
			const imageReserve = imageCount ? positive(process.env.PI_PROVIDER_IMAGE_TOKEN_RESERVE) : 0;
			const textReserve = positive(stats.text_json_utf8_bytes);
			const required = capacity && output && margin && textReserve && imageReserve !== undefined
				? textReserve + imageCount * imageReserve + output + margin : null;
			reason = !capacity ? "context_capacity_unknown_or_invalid" : !output ? "output_envelope_unknown_or_invalid"
				: !margin ? "context_margin_invalid" : !textReserve ? "input_measurement_invalid"
				: imageReserve === undefined ? "image_reserve_unknown" : required! > capacity ? "context_capacity_exceeded" : undefined;
			row = { status: reason ? "declined" : "admitted", reason: reason ?? null,
				context_capacity: capacity ?? null, declared_model_capacity: declared ?? null,
				declared_model_output_limit: positive(ctx.model?.maxTokens) ?? null,
				input_text_token_reserve: textReserve ?? null, output_token_reserve: output ?? null,
				image_count: imageCount, image_token_reserve_per_image: imageReserve ?? null,
				margin_token_reserve: margin ?? null, required_token_reserve: required,
				text_estimate_method: "one token reserved per serialized UTF-8 text/schema byte",
				image_estimate_method: imageCount ? "explicit configured reserve; actual image cost unmeasured" : "no typed images",
				tokenizer: "conservative provider-independent estimate; not actual provider usage",
				tool_definition_count: stats.tool_definition_count, message_count: stats.message_count };
			if (reason) { state.declined = true; ctx.abort(); }
			appendFileSync(path, JSON.stringify({ ...row, scope, process_id: process.pid, recordedAt: new Date().toISOString() }) + "\n");
		} catch (error) {
			reason = error instanceof Error ? error.message : String(error);
			state.declined = true;
			ctx.abort(); // Pi swallows hook throws; abort is the native cancellation boundary.
		}
		if (state.declined) {
			saveStop(row, reason);
		}
	});
	pi.on("after_provider_response", () => { state.responseSeen = true; });
}
