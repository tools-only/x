/** A derived view over versioned task-local research resources. */

export type ResearchGraphResource = {
	goal_id: string;
	finding_id: string;
	version: number;
	kind?: "research_goal" | "finding";
	status: "open" | "active" | "resolved";
	question: string;
	parent_goal_id?: string;
	depends_on?: string[];
};

type VersionedRef = { findingId: string; version: number };

export function parseVersionedFindingRef(value: string): VersionedRef | undefined {
	const match = value.match(/^(finding-\d+)@v(\d+)$/);
	if (!match) return undefined;
	return { findingId: match[1], version: Number(match[2]) };
}

export function validateResearchRelations(options: {
	candidateFindingId: string;
	candidateGoalId: string;
	parentGoalId?: string;
	dependsOn: string[];
	findings: Map<string, ResearchGraphResource>;
	knownVersions: Set<string>;
}): void {
	const { candidateFindingId, candidateGoalId, parentGoalId, dependsOn, findings, knownVersions } = options;
	const goalIds = new Set([...findings.values()].map((finding) => finding.goal_id));
	if (parentGoalId && !goalIds.has(parentGoalId)) throw new Error("parent_goal_id must reference a known task-local research goal");

	const parentByGoal = new Map(
		[...findings.values()].filter((finding) => finding.parent_goal_id)
			.map((finding) => [finding.goal_id, finding.parent_goal_id!] as const),
	);
	if (parentGoalId) parentByGoal.set(candidateGoalId, parentGoalId);
	let parent = parentByGoal.get(candidateGoalId);
	const seenGoals = new Set([candidateGoalId]);
	while (parent) {
		if (seenGoals.has(parent)) throw new Error("research goal parent cycle is not allowed");
		seenGoals.add(parent);
		parent = parentByGoal.get(parent);
	}

	const parsedDependsOn = dependsOn.map((reference) => {
		const parsed = parseVersionedFindingRef(reference);
		if (!parsed || !knownVersions.has(reference)) {
			throw new Error("depends_on entries must reference a known finding version such as finding-1@v1");
		}
		return parsed;
	});
	const adjacency = new Map<string, string[]>();
	for (const finding of findings.values()) {
		if (finding.finding_id === candidateFindingId) continue;
		adjacency.set(finding.finding_id, (finding.depends_on ?? []).flatMap((reference) => {
			const parsed = parseVersionedFindingRef(reference);
			return parsed ? [parsed.findingId] : [];
		}));
	}
	adjacency.set(candidateFindingId, parsedDependsOn.map((reference) => reference.findingId));
	const reachesCandidate = (start: string): boolean => {
		const pending = [start];
		const visited = new Set<string>();
		while (pending.length) {
			const current = pending.pop()!;
			if (current === candidateFindingId) return true;
			if (visited.has(current)) continue;
			visited.add(current);
			pending.push(...(adjacency.get(current) ?? []));
		}
		return false;
	};
	if (parsedDependsOn.some((reference) => reachesCandidate(reference.findingId))) {
		throw new Error("research finding dependency cycle is not allowed");
	}
}

export function buildResearchGraph(
	findings: Map<string, ResearchGraphResource>,
	options: { focusFindingId?: string; focusGoalId?: string } = {},
): Record<string, unknown> {
	const goalToFinding = new Map([...findings.values()].map((finding) => [finding.goal_id, finding.finding_id]));
	const rawEdges: Array<Record<string, unknown> & { nodeA: string; nodeB: string }> = [];
	for (const finding of findings.values()) {
		if (finding.parent_goal_id) {
			const parentFindingId = goalToFinding.get(finding.parent_goal_id);
			if (parentFindingId) rawEdges.push({
				type: "parent_goal",
				from_goal_id: finding.goal_id,
				to_goal_id: finding.parent_goal_id,
				nodeA: finding.finding_id,
				nodeB: parentFindingId,
			});
		}
		for (const reference of finding.depends_on ?? []) {
			const parsed = parseVersionedFindingRef(reference);
			if (!parsed) continue;
			const currentVersion = findings.get(parsed.findingId)?.version ?? null;
			rawEdges.push({
				type: "depends_on",
				from_finding_id: finding.finding_id,
				to_finding_id: parsed.findingId,
				target_version: parsed.version,
				current_version: currentVersion,
				stale: currentVersion !== parsed.version,
				nodeA: finding.finding_id,
				nodeB: parsed.findingId,
			});
		}
	}

	const focusId = options.focusFindingId ?? (options.focusGoalId ? goalToFinding.get(options.focusGoalId) : undefined);
	let selectedIds = new Set(findings.keys());
	if (focusId && findings.has(focusId)) {
		selectedIds = new Set([focusId]);
		const pending = [focusId];
		while (pending.length) {
			const current = pending.pop()!;
			for (const edge of rawEdges) {
				if (edge.nodeA !== current && edge.nodeB !== current) continue;
				const other = edge.nodeA === current ? edge.nodeB : edge.nodeA;
				if (!selectedIds.has(other)) { selectedIds.add(other); pending.push(other); }
			}
		}
	}
	const selectedEdges = rawEdges.filter((edge) => selectedIds.has(edge.nodeA) && selectedIds.has(edge.nodeB));
	const edges = selectedEdges.map(({ nodeA: _nodeA, nodeB: _nodeB, ...edge }) => edge);
	const changedDependencies = selectedEdges
		.filter((edge) => edge.type === "depends_on" && edge.stale === true)
		.map((edge) => ({
			dependent_finding_id: edge.from_finding_id,
			dependency_ref: `${edge.to_finding_id}@v${edge.target_version}`,
			current_version: edge.current_version,
		}));
	return {
		format: "task-local-research-graph-v1",
		authority: "research-resources.jsonl",
		read_only_projection: true,
		focus: focusId ?? null,
		nodes: [...findings.values()]
			.filter((finding) => selectedIds.has(finding.finding_id))
			.map((finding) => ({
				finding_id: finding.finding_id,
				goal_id: finding.goal_id,
				version: finding.version,
				kind: finding.kind ?? (finding.status === "open" ? "research_goal" : "finding"),
				status: finding.status,
				question: finding.question,
			})),
		edges,
		changed_dependencies: changedDependencies,
	};
}
