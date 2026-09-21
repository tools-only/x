/** Fixed, version-addressed authoring methods. Not evolved task components. */
import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { dirname, resolve, relative, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "harness-methods");
const names = ["skill-creator", "tool-creator", "subagent-creator", "research-orchestration"] as const;
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
function read(name: string, resource: string): string {
    if (!(names as readonly string[]).includes(name)) throw new Error("Unknown baseline method; use action=methods");
    if (!/^[a-zA-Z0-9_./-]+$/.test(resource) || resource.split("/").some(p => !p || p === "." || p === "..") || isAbsolute(resource))
        throw new Error("Invalid baseline method resource path");
    const directory = realpathSync(resolve(root, name));
    const path = realpathSync(resolve(directory, resource));
    const rel = relative(directory, path);
    if (rel.startsWith("..") || isAbsolute(rel)) throw new Error("Baseline method resource escapes its directory");
    return readFileSync(path, "utf8");
}
export function readBaselineMethod(name: string, resource = "SKILL.md", expectedSha256?: string) {
    const original = read(name, resource);
    const content = name === "skill-creator" && resource === "SKILL.md"
        ? `${read(name, "PI_ADAPTATION.md")}\n\n---\n\n${original}` : original;
    const sha256 = hash(content);
    if (expectedSha256 && expectedSha256 !== sha256) throw new Error("Baseline method hash mismatch; inspect current catalog");
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
export const BASELINE_AUTHORING_GUIDANCE = "Before creating/revising a skill, tool or subagent, load the corresponding baseline creator with task_harness(action=read_method, method_name=...). Reuse already loaded guidance. Use research-orchestration for research allocation and delivery. These fixed methods are independent of the dynamic component pool/assembly. Memory records facts/hypotheses with validity; skills teach procedures; tools execute operations; subagents configure clean contexts. Creation/read/assembly is not evidence of utility.";
