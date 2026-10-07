/** Agent-side, exact spatial projections of the current public ARC frame. */
import { createHash } from "node:crypto";

export const ARC_OBSERVATION_CODEC = "arc-spatial-v1";

type Box = { x0: number; y0: number; x1: number; y1: number };
type ViewMode = "map" | "full";

function currentFrame(value: Record<string, any>): unknown[][] | undefined {
	const frames = Array.isArray(value.frames) ? value.frames : [];
	const frame = frames.at(-1);
	return Array.isArray(frame) && frame.every((row) => Array.isArray(row)) ? frame : undefined;
}

function cell(value: unknown, width: number): string {
	return String(value ?? "?").padStart(width, " ");
}

function exactGrid(frame: unknown[][], box: Box): string[] {
	const values = frame.slice(box.y0, box.y1 + 1)
		.flatMap((row) => row.slice(box.x0, box.x1 + 1));
	const tokenWidth = Math.max(2, String(box.x1).length, ...values.map((value) => String(value ?? "?").length));
	const axis = Array.from({ length: box.x1 - box.x0 + 1 }, (_, index) =>
		String(box.x0 + index).padStart(tokenWidth, " ")).join(" ");
	return [
		`Exact pixel grid; x columns (global): ${axis}`,
		...frame.slice(box.y0, box.y1 + 1).map((row, index) =>
			`y${String(box.y0 + index).padStart(2, "0")}: ${row.slice(box.x0, box.x1 + 1)
				.map((value) => cell(value, tokenWidth)).join(" ")}`),
	];
}

function spatialMap(frame: unknown[][]): { lines: string[]; encoding: string } {
	const height = frame.length;
	const width = frame[0]?.length ?? 0;
	if (!height || !width || height < 32 || width < 32 || height % 2 || width % 2
		|| frame.some((row) => row.length !== width)) {
		return { lines: exactGrid(frame, { x0: 0, y0: 0,
			x1: Math.max(0, width - 1), y1: Math.max(0, height - 1) }), encoding: "exact-grid" };
	}
	const tokenWidth = Math.max(2, ...frame.flat().map((value) => String(value ?? "?").length));
	const rows: string[][] = [];
	const mixed: string[] = [];
	for (let y = 0; y < height; y += 2) {
		const row: string[] = [];
		for (let x = 0; x < width; x += 2) {
			const values = [frame[y][x], frame[y][x + 1], frame[y + 1][x], frame[y + 1][x + 1]];
			if (values.every((value) => value === values[0])) row.push(cell(values[0], tokenWidth));
			else {
				row.push("*".repeat(tokenWidth));
				mixed.push(`(${x},${y})=[${String(values[0])},${String(values[1])}/${String(values[2])},${String(values[3])}]`);
			}
		}
		rows.push(row);
	}
	// Dense mixed pixels make a 2x2 map harder to read and more costly than a
	// directly aligned grid. Both branches preserve every current-frame pixel.
	if (mixed.length > width * height / 40) {
		return { lines: exactGrid(frame, { x0: 0, y0: 0, x1: width - 1, y1: height - 1 }), encoding: "exact-grid" };
	}
	return {
		encoding: "exact-2x2-map",
		lines: [
			`Exact 2x2 spatial map, original color numbers; each token covers its global x/y pair. ${"*".repeat(tokenWidth)} means mixed; exact mixed pixels follow.`,
			`x pairs: ${Array.from({ length: width / 2 }, (_, index) =>
				`${String(index * 2).padStart(2, "0")}-${String(index * 2 + 1).padStart(2, "0")}`).join(" ")}`,
			...rows.map((row, index) => `y${String(index * 2).padStart(2, "0")}-${String(index * 2 + 1).padStart(2, "0")}: ${row.join(" ")}`),
			...(mixed.length ? [`Mixed tile pixels (top-left/top-right / bottom-left/bottom-right): ${mixed.join(" ")}`] : []),
		],
	};
}

export function renderArcObservationView(
	value: Record<string, any>,
	options: { mode?: ViewMode; canonicalRef?: string; exactText?: string } = {},
): { text: string; metadata: Record<string, unknown> } {
	const frame = currentFrame(value);
	if (!frame) throw new Error("current public ARC frame is unavailable");
	const height = frame.length, width = Math.max(0, ...frame.map((row) => row.length));
	if (!height || !width) throw new Error("current public ARC frame is empty");
	if (frame.some((row) => row.length !== width)) throw new Error("current public ARC frame is not rectangular");
	const mode = options.mode ?? "map";
	const encoded = mode === "full" && options.exactText
			? { lines: [options.exactText], encoding: "coordinate-runs" }
			: spatialMap(frame);
	const body = [
		`State: ${String(value.state ?? "UNKNOWN")}; levels completed: ${String(value.levels_completed ?? 0)}; frame size: ${height}x${width}.`,
		`Coordinates: x=column, y=row; (x,y)=current frame[y][x]. Last of ${Array.isArray(value.frames) ? value.frames.length : 1} rendered frames is current.`,
		...encoded.lines,
		`Action budget: ${JSON.stringify(value.action_budget ?? {})}; available actions: ${JSON.stringify(value.agent_available_actions ?? value.available_actions ?? [])}.`,
	].join("\n");
	const frameSha256 = createHash("sha256").update(JSON.stringify(frame)).digest("hex");
	const bodySha256 = createHash("sha256").update(body).digest("hex");
	const metadata = {
		codec: ARC_OBSERVATION_CODEC, encoding: encoded.encoding, mode,
		canonical_ref: options.canonicalRef ?? null,
		frame_sha256: frameSha256, body_sha256: bodySha256,
		frame_size: [height, width],
		coverage: "all_current_frame_pixels",
		lossless: true,
		omitted_animation_frames: Math.max(0, (Array.isArray(value.frames) ? value.frames.length : 1) - 1),
		body_chars: body.length,
		observation_delivery: "complete_current_frame",
	};
	return { text: `ARC_OBSERVATION_VIEW ${JSON.stringify(metadata)}\n${body}\nARC_OBSERVATION_END ${bodySha256}`,
		metadata };
}
