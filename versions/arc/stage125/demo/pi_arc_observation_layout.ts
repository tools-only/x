/** A bounded, non-semantic overview of the current public ARC pixels. */
export function renderArcCoarseLayout(frame: unknown[][]): string[] {
	const height = frame.length;
	const width = Math.max(0, ...frame.map((row) => Array.isArray(row) ? row.length : 0));
	if (!height || !width) return [];
	const rowStep = Math.max(1, Math.ceil(height / 8));
	const columnStep = Math.max(1, Math.ceil(width / 8));
	const lines = [
		`Coarse color layout (derived, non-semantic; blocks=${rowStep}x${columnStep}, token=dominant color~distinct colors; exact pixels follow):`,
		`x ranges: ${Array.from({ length: Math.ceil(width / columnStep) }, (_, index) =>
			`B${String(index).padStart(2, "0")}=${index * columnStep}-${Math.min(width - 1, (index + 1) * columnStep - 1)}`).join(" ")}`,
	];
	for (let top = 0; top < height; top += rowStep) {
		const tokens: string[] = [];
		for (let left = 0; left < width; left += columnStep) {
			const counts = new Map<string, number>();
			for (let row = top; row < Math.min(height, top + rowStep); row += 1) {
				for (let column = left; column < Math.min(width, left + columnStep); column += 1) {
					const value = frame[row]?.[column];
					if (value === undefined) continue;
					const color = typeof value === "number" && Number.isFinite(value) ? String(value) : "?";
					counts.set(color, (counts.get(color) ?? 0) + 1);
				}
			}
			const dominant = [...counts].sort((a, b) => b[1] - a[1]
				|| Number(a[0]) - Number(b[0]) || a[0].localeCompare(b[0]))[0]?.[0] ?? "?";
			tokens.push(`${dominant}${counts.size > 1 ? `~${counts.size}` : ""}`);
		}
		lines.push(`B${String(Math.floor(top / rowStep)).padStart(2, "0")}(y=${top}-${Math.min(height - 1, top + rowStep - 1)}): ${tokens.join(" ")}`);
	}
	return lines;
}

/** A compact pixel map when most 2x2 cells are uniform. The exact frame remains authoritative. */
export function renderArcUniformTileMap(frame: unknown[][]): string[] {
	const height = frame.length;
	const width = Math.max(0, ...frame.map((row) => Array.isArray(row) ? row.length : 0));
	if (height < 32 || width < 32 || height % 2 || width % 2) return [];
	const colors = new Set<string>();
	let uniform = 0;
	let total = 0;
	const tiles: Array<Array<string | null>> = [];
	for (let top = 0; top < height; top += 2) {
		const line: Array<string | null> = [];
		for (let left = 0; left < width; left += 2) {
			const value = frame[top]?.[left];
			const same = value !== undefined && frame[top]?.[left + 1] === value
				&& frame[top + 1]?.[left] === value && frame[top + 1]?.[left + 1] === value;
			const color = same ? String(value) : null;
			line.push(color);
			if (color !== null) { uniform += 1; colors.add(color); }
			total += 1;
		}
		tiles.push(line);
	}
	if (uniform / total < 0.9 || colors.size > 62) return [];
	const alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
	const sortedColors = [...colors].sort((a, b) => Number(a) - Number(b) || a.localeCompare(b));
	const glyph = new Map(sortedColors.map((color, index) => [color, alphabet[index]]));
	return [
		`Uniform 2x2 pixel map (derived; * means mixed pixels; exact coordinate runs below are authoritative):`,
		`Each glyph at map row r, column c covers x=2c..2c+1 and y=2r..2r+1; legend: ${sortedColors.map((color) => `${glyph.get(color)}=${color}`).join(" ")}`,
		...tiles.map((row, index) => `t${String(index).padStart(2, "0")}(y=${index * 2}-${index * 2 + 1}): ${row.map((color) => color === null ? "*" : glyph.get(color)).join("")}`),
	];
}
