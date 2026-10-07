/** Type-specific success receipts. Unrecognized outputs and failures remain exact. */
type Row = Record<string, any>;
const bodyFields = new Set(["body", "instructions", "content"]);
export function controlResultView(tool: string, result: Row, canonicalRef: string): Row | null {
    if (!["task_harness", "task_harness_create"].includes(tool) || result.isError
        || result.content?.length !== 1 || result.content[0].type !== "text") return null;
    let value: Row;
    try { value = JSON.parse(result.content[0].text); } catch { return null; }
    if (value.format !== "task-harness-change-receipt-v1" || value.status !== "applied") return null;
    const failures = (v: any): boolean => !!v && typeof v === "object" &&
        (v.error != null || ["failed", "partial", "unknown"].includes(v.status) || v.applied === false
            || Object.values(v).some(failures));
    if (failures(value)) return null;
    const omitted: string[] = [];
    const project = (v: any, path: string): any => {
        if (Array.isArray(v)) return v.map((item, index) => project(item, `${path}${path ? "." : ""}${index}`));
        if (!v || typeof v !== "object") return v;
        return Object.fromEntries(Object.entries(v).filter(([key]) => {
            if (!/^results\.\d+\.(candidate|resource)$/.test(path) || !bodyFields.has(key)
                || typeof v[key] !== "string") return true;
            omitted.push(`${path}${path ? "." : ""}${key}`); return false;
        }).map(([key, item]) => [key, project(item, `${path}${path ? "." : ""}${key}`)]));
    };
    const fields = project(value, "");
    if (!omitted.length) return null;
    return { format: "task-result-view-v1", result_type: "successful_control_receipt", status: value.status,
        source_version: 1, canonical_ref: canonicalRef, view_complete: true,
        decision_fields: fields, omitted_fields: omitted,
        provenance: { operation: "typed_field_projection", source_ref: canonicalRef },
        reader_scope: "parent", read_full: { tool: "task_resource", action: "read", ref: canonicalRef } };
}
