/** Fixed, version-addressed authoring methods. Not evolved task components. */
import { createHash } from "node:crypto";
import { controlError } from "./pi_harness_control.ts";
import { readFileSync, realpathSync } from "node:fs";
import { dirname, resolve, relative, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { TASK_PURE_PYTHON_FORMAT } from "./pi_task_pure_authoring.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "harness-methods");
export const BASELINE_METHOD_NAMES = ["skill-creator", "tool-creator", "subagent-creator", "research-orchestration"] as const;
export type BaselineMethodName = typeof BASELINE_METHOD_NAMES[number];
const names = BASELINE_METHOD_NAMES;
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
function read(name: string, resource: string): string {
    if (!(names as readonly string[]).includes(name)) throw new Error("Unknown baseline method; use action=methods");
    if (!/^[a-zA-Z0-9_./-]+$/.test(resource) || resource.split("/").some(p => !p || p === "." || p === "..") || isAbsolute(resource))
        throw new Error("Invalid baseline method resource path");
    const directory = realpathSync(resolve(root, name));
    // Providers occasionally omit the documentation suffix when following a
    // creator's in-body reference ("references/pi-task-local-tool-contract").
    // Keep the boundary deterministic while accepting that unambiguous alias;
    // never search broadly or guess across directories.
    let requestedPath = resolve(directory, resource);
    try { realpathSync(requestedPath); }
    catch (error) {
        if (!resource.endsWith(".md")) {
            const mdPath = resolve(directory, `${resource}.md`);
            try { realpathSync(mdPath); requestedPath = mdPath; }
            catch { throw error; }
        } else throw error;
    }
    const path = realpathSync(requestedPath);
    const rel = relative(directory, path);
    if (rel.startsWith("..") || isAbsolute(rel)) throw new Error("Baseline method resource escapes its directory");
    return readFileSync(path, "utf8");
}
export function readBaselineMethod(name: string, resource = "SKILL.md", expectedSha256?: string) {
    const original = read(name, resource);
    // SKILL.md is the complete Pi authoring entry. Upstream workflow and
    // optional audit metadata remain separately readable, not replayed here.
    const content = original;
    const sha256 = hash(content);
    if (expectedSha256 && expectedSha256 !== sha256) throw new Error(
        `Baseline method hash mismatch for ${name}: expected_sha256=${expectedSha256}; current_sha256=${sha256}. ` +
        `Retry task_harness(action=read_method, method_name=${name}, expected_sha256=${sha256}); ` +
        "the old immutable method_ref cannot authorize a new candidate.",
    );
    return { name, resource, sha256, content, origin: "baseline" as const,
        method_ref: `baseline_method:${name}@sha256:${sha256}` };
}
export function baselineMethodCatalog() {
    return names.map(name => {
        const body = read(name, "SKILL.md");
        const description = body.match(/^description:\s*(.+)$/m)?.[1] ?? name;
        const { sha256, method_ref } = readBaselineMethod(name);
        return { name, description, origin: "baseline", sha256, method_ref,
            read_call: { action: "read_method", method_name: name, expected_sha256: sha256 } };
    });
}
export const BASELINE_AUTHORING_GUIDANCE = "At an evidenced useful operation, choose a fitting carrier and next use. Author complete content through task_harness_create or task_harness(action=change), explicitly assemble exact versions, then use and assess them. Creator templates are optional; supplied creator citations must match their current version. Memory stores scoped facts/hypotheses; System Prompts add scoped behavior; Skills teach procedures; Tools run disclosed operations; Subagents provide a separate authorized context. Auto-Research is optional and separately requires research-orchestration. Runtime validates and executes authored content; creation, exposure, reading, application and utility remain distinct.";

/** Shape-only progressive disclosure. Placeholder text is not authored semantics. */
export function creatorCandidateTemplate(name: BaselineMethodName, creatorRef?: string) {
	const ref = creatorRef ?? baselineMethodCatalog().find(item => item.name === name)?.method_ref;
	const common = { name: "<capability-name>", description: "<purpose and scope>",
		authoring_method_ref: ref };
	let candidate: Record<string, unknown> | undefined;
	if (name === "skill-creator") candidate = { semantic_kind: "skill", ...common,
		instructions: "<complete parent-authored procedural body>" };
	if (name === "tool-creator") candidate = { name: common.name, description: common.description,
		program: { format: TASK_PURE_PYTHON_FORMAT, source: "input" } };
	if (name === "subagent-creator") candidate = { semantic_kind: "subagent", ...common,
		instructions: "<bounded role, required output, stop and failure behavior>", tools: [] };
	if (!candidate) return undefined;
	return { template_requires_parent_content: true,
		authoring_call: name === "tool-creator"
			? { tool: "task_harness_create", arguments: { candidate, assembly: true, trial: { parameters: {}, bindings: [] } } }
			: { tool: "task_harness", arguments: { action: "change", changes: [{ operation: "create", candidate }],
				decision: { basis_refs: ["<exact-existing-ref>"], reason: "<why this operation and carrier now>",
					expected: "<observable result at the declared next use>" } } },
		optional_method_metadata: "Not required; supply only fields useful to the authored method.",
		...(name === "tool-creator" ? { program_choice: {
			alternatives: "task-pure-expression-v1 or program.steps; read references/pi-task-local-tool-contract.md when needed. Never mix shapes.",
		} } : {}) };
}

export function creatorForHarnessKind(kind: string): BaselineMethodName | undefined {
	return ({ skill: "skill-creator", tool: "tool-creator", subagent: "subagent-creator" } as Record<string, BaselineMethodName>)[kind];
}

/** Optional documentation citation; content, permissions and CAS are separate checks. */
export function validateCreatorCitation(kind: string, reference: unknown): string | undefined {
    if (reference === undefined) return;
    const methodName = creatorForHarnessKind(kind);
    if (!methodName) return;
    const expected = readBaselineMethod(methodName).method_ref;
    const supplied = typeof reference === "string" ? reference.trim() : "";
    if (!supplied || supplied !== expected) controlError("rejected_input", [{
        path: "authoring_method_ref",
        message: `authoring_method_ref must match the current ${methodName}; expected_ref=${expected}. Omit the optional citation or supply this exact version.`,
    }], { phase: "preflight", no_component_written: true, retryable: false, required_next_call: undefined,
        recovery_hint: "Correct the citation or omit it when submitting complete authored content." });
    return supplied;
}

export function researchAuthoringPrerequisite() {
	const method = baselineMethodCatalog().find(item => item.name === "research-orchestration")!;
	return { tool: "task_harness", arguments: method.read_call,
		instruction: "Read this method before starting research; reuse a matching parent read already recorded in this run. Pass its method_ref as authoring_method_ref on auto_research start/enqueue.",
		authoring_method_ref: method.method_ref };
}
