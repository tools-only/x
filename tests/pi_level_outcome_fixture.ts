import { Type } from "typebox";
export default function(pi: any) {
	pi.registerTool({name:"arc_action",label:"Outcome fixture",description:"Diagnostic outcome",parameters:Type.Object({
		decision: Type.Optional(Type.Any()),
	}),
		async execute(_toolCallId: string, params: {decision?: unknown}) {return {content:[{type:"text",text:"Fixture level completed"}], details:{state:"NOT_FINISHED",levels_completed:1,
			...(params.decision !== undefined ? {decision: params.decision} : {}),
			public_transition:{level_before:0,level_after:1,level_changed:true}}};}});
}
