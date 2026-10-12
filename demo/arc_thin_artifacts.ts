/**
 * Artifacts: values a skill returns under "artifacts" ({"artifacts": {name: value}}). A skill is the method; what it
 * produces (a parsed map, a route, an object table) is kept by the runtime with the skill, version, state and level
 * that produced it, and passed to every skill as state["artifacts"]. Storage only: the runtime never reads or
 * interprets a value. Motivation: docs/reports/2026-10-12-tu93-new-design-analysis.md §1 (a map parsed by hand was
 * hard-coded into a skill and kept as memory prose that no other skill could read).
 */

export const MAX_ARTIFACT_CHARS = 16_000;
/** All current artifacts together, as passed to a skill. */
export const MAX_ARTIFACTS_CHARS = 64_000;
export const MAX_ARTIFACT_NAMES = 16;
const NAME = /^[A-Za-z_][A-Za-z0-9_.-]{0,39}$/;

export type ArtifactRecord = { name: string; n: number; level: number; skill: string; version: number; value: unknown; chars: number };
export type ArtifactInfo = { skill: string; version: number; n: number; level: number };

/**
 * Split a skill result into what is shown (artifacts replaced by their names) and the artifacts it carries.
 * Invalid names, values over the size limit or values JSON cannot carry are reported, not stored.
 */
export function splitArtifacts(value: unknown): { shown: unknown; artifacts: Record<string, unknown>; errors: string[] } {
	const artifacts: Record<string, unknown> = {};
	const errors: string[] = [];
	if (!value || typeof value !== "object" || Array.isArray(value) || !("artifacts" in value))
		return { shown: value, artifacts, errors };
	const { artifacts: raw, ...rest } = value as Record<string, unknown>;
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
		errors.push('"artifacts" must be a dict {name: value}');
		return { shown: { ...rest, artifacts: "(not stored: not a dict)" }, artifacts, errors };
	}
	for (const [name, item] of Object.entries(raw as Record<string, unknown>)) {
		if (!NAME.test(name)) { errors.push(`artifact name "${name.slice(0, 40)}" is not an identifier`); continue; }
		let chars: number;
		try { chars = JSON.stringify(item ?? null)?.length ?? 0; } catch { errors.push(`artifact ${name} is not JSON data`); continue; }
		if (chars > MAX_ARTIFACT_CHARS) { errors.push(`artifact ${name} has ${chars} characters (max ${MAX_ARTIFACT_CHARS})`); continue; }
		artifacts[name] = item ?? null;
	}
	return { shown: { ...rest, artifacts: Object.keys(raw as object) }, artifacts, errors };
}

/** The artifact records in effect at state n: for each name, the latest record with record.n <= n. */
export function artifactsAt(log: ArtifactRecord[], n = Number.POSITIVE_INFINITY): Map<string, ArtifactRecord> {
	const current = new Map<string, ArtifactRecord>();
	for (const record of log) {
		if (record.n > n) continue;
		const known = current.get(record.name);
		if (!known || record.n >= known.n) current.set(record.name, record);
	}
	return current;
}

/**
 * The records to append for one skill run on state n: a value is stored only when it differs from the one in
 * effect at that state, so an unchanged map repeated after every action costs nothing.
 */
export function newArtifactRecords(log: ArtifactRecord[], artifacts: Record<string, unknown>,
	at: { n: number; level: number; skill: string; version: number }): { records: ArtifactRecord[]; errors: string[] } {
	const inEffect = artifactsAt(log, at.n);
	const names = new Set(log.map((record) => record.name));
	const records: ArtifactRecord[] = [], errors: string[] = [];
	for (const [name, value] of Object.entries(artifacts)) {
		if (!names.has(name) && names.size >= MAX_ARTIFACT_NAMES) { errors.push(`artifact limit (${MAX_ARTIFACT_NAMES} names) reached; ${name} not stored`); continue; }
		const json = JSON.stringify(value ?? null);
		const known = inEffect.get(name);
		if (known && known.skill === at.skill && known.version === at.version && JSON.stringify(known.value ?? null) === json) continue;
		names.add(name);
		records.push({ name, ...at, value, chars: json.length });
	}
	return { records, errors };
}

/** What a skill receives: state["artifacts"] (values) and state["artifact_info"] (who made each, when). */
export function artifactInputs(log: ArtifactRecord[], n?: number): { artifacts: Record<string, unknown>; artifact_info: Record<string, ArtifactInfo> } {
	const records = [...artifactsAt(log, n).values()].sort((a, b) => b.n - a.n);
	const artifacts: Record<string, unknown> = {}, artifact_info: Record<string, ArtifactInfo> = {};
	let room = MAX_ARTIFACTS_CHARS;
	for (const record of records) {
		if (record.chars > room) continue;
		room -= record.chars;
		artifacts[record.name] = record.value;
		artifact_info[record.name] = { skill: record.skill, version: record.version, n: record.n, level: record.level };
	}
	return { artifacts, artifact_info };
}

/** For replaying a model: every distinct value of each artifact with the state it took effect at. */
export function artifactHistory(log: ArtifactRecord[], maxChars = MAX_ARTIFACTS_CHARS): Record<string, Array<[number, unknown]>> {
	const out: Record<string, Array<[number, unknown]>> = {};
	let room = maxChars;
	for (const record of [...log].sort((a, b) => b.n - a.n)) {
		if (record.chars > room) continue;
		room -= record.chars;
		(out[record.name] ??= []).unshift([record.n, record.value]);
	}
	return out;
}

const size = (chars: number) => chars >= 1000 ? `${(chars / 1000).toFixed(1)}k chars` : `${chars} chars`;

/** One line per artifact: producer, state, level, and whether the producer or the level has moved on since. */
export function renderArtifacts(log: ArtifactRecord[], now: { n: number; level: number; skills: Map<string, { version: number }> }): string {
	const records = [...artifactsAt(log).values()];
	if (!records.length) return "";
	const lines = records.sort((a, b) => a.name.localeCompare(b.name)).map((record) => {
		const producer = now.skills.get(record.skill);
		const flags = [
			record.level !== now.level ? `made on level ${record.level + 1}; now level ${now.level + 1}` : "",
			!producer ? `${record.skill} was deleted` : producer.version !== record.version ? `${record.skill} is now v${producer.version}` : "",
		].filter(Boolean);
		const age = now.n - record.n;
		return `- ${record.name}: ${size(record.chars)}, from ${record.skill} v${record.version} on state #${record.n}` +
			`${age > 0 ? ` (${age} action(s) ago)` : " (current)"}${flags.length ? ` [${flags.join("; ")}]` : ""}`;
	});
	return [`ARTIFACTS (what your skills returned under "artifacts"; every skill reads state["artifacts"][name] and state["artifact_info"]):`, ...lines].join("\n");
}
