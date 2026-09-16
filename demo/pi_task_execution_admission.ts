/**
 * Adapter-independent compatibility hook for task-local self-harness
 * operations. Pi may execute several tool calls in one provider response;
 * this hook intentionally performs no project-local quota or sequencing gate.
 */
export type AdmissionResult = {
	content: [{ type: "text"; text: string }];
	details: { format: "task-local-admission-v1"; admitted: false; tool: string; reason: string };
};

export function admitTaskLocalOperation(_tool: string): AdmissionResult | undefined {
	// There is no project-local management or harness-call quota.  The parent
	// Agent may research, inspect, create, revise, or retire as many task-local
	// resources as its provider/session and the native environment permit.
	return undefined;
}

/** Start a fresh management window after a real environment action. */
export function noteArcActionCompleted(): void {
	// Kept as a lifecycle hook for adapter integrations; no counters are reset
	// because no local admission window is maintained.
}

export function admissionStats(): { management_calls: number; blocked_calls: number } {
	return { management_calls: 0, blocked_calls: 0 };
}
