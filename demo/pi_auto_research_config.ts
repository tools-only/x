/** Startup configuration only; capability registration remains adapter-owned. */
export function autoResearchEnabled(defaultEnabled: boolean, environment = process.env): boolean {
	const value = environment.PI_AUTORESEARCH_ENABLED;
	if (value === undefined) return defaultEnabled;
	if (value === "enabled") return true;
	if (value === "disabled") return false;
	throw new Error("PI_AUTORESEARCH_ENABLED must be enabled or disabled");
}

export function arcAutoResearchDefault(environment = process.env): boolean {
	// The general switch takes precedence over the legacy ARC-only switch.
	if (environment.PI_AUTORESEARCH_ENABLED !== undefined) return autoResearchEnabled(false, environment);
	const value = environment.PI_ARC_AUTO_RESEARCH;
	if (value === undefined || value === "disabled") return false;
	if (value === "enabled") return true;
	throw new Error("PI_ARC_AUTO_RESEARCH must be enabled or disabled");
}
