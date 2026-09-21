/** Return the stable address key for one task-local resource record. */
export function taskResourceName(record: Record<string, any>): string {
	// A method has both a durable method_id and a human-facing name.  Historical
	// lifecycle versions are addressed by method_id, while all legacy resource
	// kinds retain their existing key/name-first identity rules.
	return String(record.key ?? record.method_id ?? record.name ?? record.finding_id
		?? record.effect_assessment_id ?? record.approval_id ?? record.receipt_id
		?? record.route_id ?? record.observation_id ?? record.validation_id
		?? record.state_id
		?? record.invocation_id ?? record.failure_id ?? record.run_id
		?? record.session_id ?? record.archive_id ?? record.window_id ?? "");
}
