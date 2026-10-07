/** Shared native harness mutation handlers used by public tools and apply_route. */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export type NativeHarnessResult = {
	isError?: boolean;
	content?: Array<{ type: "text"; text: string }>;
	details?: unknown;
};

export type NativeHarnessExecutor = (
	toolCallId: string,
	params: Record<string, any>,
) => Promise<NativeHarnessResult> | NativeHarnessResult;

// Extensions can be loaded through separate module instances and can receive
// distinct API proxy objects.  A process-global registry keyed by the isolated
// task root keeps native handlers visible to the parent route executor without
// exposing a new tool or bypassing the task boundary.
const GLOBAL_KEY = Symbol.for("autoresearch_pi.native-harness-executors-by-root");
type GlobalRegistry = Map<string, Map<string, NativeHarnessExecutor>>;
function globalRegistry(): GlobalRegistry {
	const target = globalThis as typeof globalThis & { [GLOBAL_KEY]?: GlobalRegistry };
	if (!target[GLOBAL_KEY]) target[GLOBAL_KEY] = new Map();
	return target[GLOBAL_KEY]!;
}
function taskRoot(): string {
	return String(process.env.PI_AUTORESEARCH_E2E_ROOT ?? ".");
}
function registryFor(_pi: ExtensionAPI): Map<string, NativeHarnessExecutor> {
	const registry = globalRegistry().get(taskRoot()) ?? new Map<string, NativeHarnessExecutor>();
	globalRegistry().set(taskRoot(), registry);
	return registry;
}

/**
 * Internal route application hook.  This is deliberately not a Pi tool: the
 * parent runtime has already received a child-approved, hash-bound route, so
 * invoking the native route executor is deterministic bookkeeping rather than
 * another model decision.  The process-global registry also works when Pi
 * loads extensions through separate module realms.
 */
export type NativeHarnessRouteApplier = (
	toolCallId: string,
	input: Record<string, any>,
) => Promise<NativeHarnessResult> | NativeHarnessResult;

const ROUTE_APPLIER_KEY = Symbol.for("autoresearch_pi.native-harness-route-appliers-by-root");
type RouteApplierRegistry = Map<string, NativeHarnessRouteApplier>;
function routeApplierRegistry(): RouteApplierRegistry {
	const target = globalThis as typeof globalThis & { [ROUTE_APPLIER_KEY]?: RouteApplierRegistry };
	if (!target[ROUTE_APPLIER_KEY]) target[ROUTE_APPLIER_KEY] = new Map();
	return target[ROUTE_APPLIER_KEY]!;
}

export function registerNativeHarnessRouteApplier(
	_pi: ExtensionAPI,
	applier: NativeHarnessRouteApplier,
): void {
	routeApplierRegistry().set(taskRoot(), applier);
}

export function nativeHarnessRouteApplier(
	_pi: ExtensionAPI,
): NativeHarnessRouteApplier | undefined {
	return routeApplierRegistry().get(taskRoot());
}

export function registerNativeHarnessExecutor(
	pi: ExtensionAPI,
	toolName: string,
	execute: NativeHarnessExecutor,
): void {
	registryFor(pi).set(toolName, execute);
}

export function nativeHarnessExecutor(
	pi: ExtensionAPI,
	toolName: string,
): NativeHarnessExecutor | undefined {
	const registered = registryFor(pi).get(toolName);
	if (registered) return registered;
	// Pi extension loading may expose the same tool through a separate module
	// realm.  Some runtimes retain the executable on the tool descriptor even
	// when the local registry is not shared; use it as a native fallback.
	const descriptor = (pi.getAllTools() as any[]).find((tool) => tool?.name === toolName);
	return typeof descriptor?.execute === "function" ? descriptor.execute.bind(descriptor) : undefined;
}
