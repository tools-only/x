/** Parent-only action counter fixture; no bridge or child process. */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
export default function install(pi: ExtensionAPI) {
	if (process.env.PI_REVIEW_FIXTURE_RUNTIME_FAILURE === "1") pi.registerTool({
		name:"auto_research",label:"Unavailable research fixture",description:"Inject a deterministic runtime failure",
		parameters:Type.Object({action:Type.String()}), async execute() {
			throw new Error("research runtime cannot read auto-research-handoffs.jsonl");
		},
	});
	pi.registerTool({ name: "arc_action", label: "Fixture action", description: "Diagnostic action only",
		parameters: Type.Object({}), async execute() {
			return { content: [{ type: "text", text: "fixture action completed" }] };
		} });
}
