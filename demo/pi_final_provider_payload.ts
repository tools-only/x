/** Last extension in an explicitly ordered task launch; observes, never replaces. */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

export const FINAL_PROVIDER_PAYLOAD_EVENT = "autoresearch:final-provider-payload";
export const FINAL_PROVIDER_OBSERVER_INSTALLED_EVENT = "autoresearch:final-provider-observer-installed";
export type FinalProviderPayloadEvent = { payload: unknown; ctx: ExtensionContext };

export default function finalProviderPayload(pi: ExtensionAPI) {
    // Task launchers disable automatic extensions and append this extension
    // after adapter/provider extensions. Earlier replacement handlers finish
    // before this read-only observer; no global SDK/provider override is used.
    pi.on("before_provider_request", (event, ctx) => {
        pi.events.emit(FINAL_PROVIDER_PAYLOAD_EVENT, { payload: event.payload, ctx } satisfies FinalProviderPayloadEvent);
    });
    pi.events.emit(FINAL_PROVIDER_OBSERVER_INSTALLED_EVENT, undefined);
}
