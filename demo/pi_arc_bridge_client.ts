/** Structured localhost ARC bridge client diagnostics.
 *
 * A failed action fetch is never retried: the official environment may have
 * accepted the action before its response was lost.  The independent /events
 * endpoint does not acquire the action lock, so it remains safe to inspect the
 * latest boundary after a client transport failure.
 */

function errorDetails(error: unknown, seen?: Set<unknown>): Record<string, unknown> {
	const visited = seen ?? new Set();
	if (error === null || error === undefined) return { type: typeof error, message: String(error) };
	if (visited.has(error)) return { type: "CircularErrorCause", message: "circular error cause" };
	visited.add(error);
	const value = error as Record<string, unknown>;
	const details: Record<string, unknown> = {
		type: error instanceof Error ? error.constructor.name : typeof error,
		message: error instanceof Error ? error.message : String(error),
	};
	for (const key of ["name", "code", "errno", "syscall", "status"]) {
		if (value?.[key] !== undefined) details[key] = value[key];
	}
	if (value?.cause !== undefined) details.cause = errorDetails(value.cause, visited);
	return details;
}

async function lastEnvironmentBoundary(base: string): Promise<Record<string, unknown> | null> {
	try {
		const response = await fetch(`${base}/events?after=0`);
		if (!response.ok) return null;
		const payload = await response.json() as Record<string, unknown>;
		const events = Array.isArray(payload.events) ? payload.events : [];
		return [...events].reverse().find((item: any) =>
			item && ["environment_call_started", "environment_error"].includes(String(item.event))) as Record<string, unknown> ?? null;
	} catch {
		return null;
	}
}

export async function bridge(path: string, body?: Record<string, unknown>) {
	const base = process.env.PI_ARC_BRIDGE_URL;
	if (!base) throw new Error("PI_ARC_BRIDGE_URL is not configured");
	let response: Response;
	try {
		response = await fetch(`${base}${path}`, body ? {
			method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
		} : undefined);
	} catch (error) {
		throw new Error(JSON.stringify({
			format: "arc-bridge-client-error-v1", operation: path,
			error: errorDetails(error),
			last_environment_boundary: await lastEnvironmentBoundary(base),
			retryable: false,
		}));
	}
	let value: Record<string, unknown>;
	try {
		value = await response.json() as Record<string, unknown>;
	} catch (error) {
		throw new Error(JSON.stringify({
			format: "arc-bridge-client-error-v1", operation: path,
			error: `bridge returned non-JSON response (HTTP ${response.status})`,
			cause: errorDetails(error), retryable: false,
		}));
	}
	if (!response.ok) {
		throw new Error(JSON.stringify({
			format: "arc-bridge-client-error-v1", operation: path,
			status: response.status, retryable: value.retryable ?? false,
			bridge_error: value,
		}));
	}
	return value;
}
