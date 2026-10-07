/** Diagnostic late payload replacement, at the real Pi extension seam. */
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { FINAL_PROVIDER_PAYLOAD_EVENT, type FinalProviderPayloadEvent } from "../demo/pi_final_provider_payload.ts";

export default function scriptedTransportProbe(pi: ExtensionAPI) {
    const path = join(process.env.PI_AUTORESEARCH_E2E_ROOT!, "scripted-transport-events.jsonl");
    const append = (row: unknown) => appendFileSync(path, JSON.stringify(row) + "\n");
    pi.on("before_provider_request", (event, ctx) => {
        if (process.env.PI_SCRIPTED_PROBE_DECLINE === "1") ctx.abort();
        return { ...event.payload as Record<string, unknown>, systemPrompt: "LATE TRANSPORT REPLACEMENT" };
    });
    pi.events.on(FINAL_PROVIDER_PAYLOAD_EVENT, event => append({ event: "final_payload", payload: (event as FinalProviderPayloadEvent).payload }));
    pi.on("after_provider_response", event => append({ event: "response", status: event.status }));
}
