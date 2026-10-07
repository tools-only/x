import { Type } from "typebox";

/** Equivalent encoding only. Never traverse arbitrary defaults/examples as schemas. */
export function compactToolSchema<T>(schema: T): T {
	if (!schema || typeof schema !== "object" || Array.isArray(schema)) return schema;
	const input = schema as Record<string, any>;
	const out = { ...input };
	for (const key of ["properties", "patternProperties", "$defs", "definitions", "dependentSchemas"]) {
		if (input[key] && typeof input[key] === "object") out[key] = Object.fromEntries(
			Object.entries(input[key]).map(([name, value]) => [name, compactToolSchema(value)]));
	}
	for (const key of ["items", "additionalProperties", "contains", "not", "if", "then", "else", "propertyNames"]) {
		if (input[key] && typeof input[key] === "object" && !Array.isArray(input[key])) out[key] = compactToolSchema(input[key]);
	}
	for (const key of ["anyOf", "oneOf", "allOf", "prefixItems"]) {
		if (Array.isArray(input[key])) out[key] = input[key].map(compactToolSchema);
	}
	const branches = out.anyOf;
	if (Array.isArray(branches) && branches.length && branches.every(branch =>
		branch && branch.type === "string" && typeof branch.const === "string"
		&& Object.keys(branch).every(key => key === "type" || key === "const"))
		&& !Object.hasOwn(out, "type") && !Object.hasOwn(out, "enum") && !Object.hasOwn(out, "const")) {
		delete out.anyOf;
		// Rebuild TypeBox metadata as string rather than retaining the Union kind.
		return Type.String({ ...out, enum: [...new Set(branches.map(branch => branch.const))] }) as T;
	}
	return out as T;
}
