/** Bounded public pixel facts for the latest thin ARC action. */
import { arcChangedComponents } from "./pi_arc_context_projection.ts";

type Cell = { row: number; col: number; before: number; value: number };
type Region = { cells: number; bbox: number[]; colors: number[][]; pixels?: number[][]; pixels_omitted?: boolean };
const PREFIX = "PIXEL CHANGES (4-connected; bbox=[x0,y0,x1,y1]; colors=[before,after,count]; pixels=[x,y,before,after]): ";
const MAX_CHARS = 1200;

export function summarizeArcThinDelta(delta: Record<string, any> | undefined): string {
    const unavailable = "PIXEL CHANGES: unavailable (incomplete or invalid before/after evidence).";
    if (!delta || delta.frame_available !== true || delta.cells_truncated === true
        || !Number.isInteger(delta.changed_cells) || delta.changed_cells < 0) return unavailable;
    const cells: Cell[] = delta.cells ?? [];
    if (!Array.isArray(cells) || cells.length !== delta.changed_cells) return unavailable;
    const byCoordinate = new Map<string, Cell>();
    for (const cell of cells) {
        if (!cell || !Number.isInteger(cell.row) || !Number.isInteger(cell.col)
            || cell.row < 0 || cell.row >= 256 || cell.col < 0 || cell.col >= 256
            || !Number.isInteger(cell.before) || !Number.isInteger(cell.value)
            || cell.before < 0 || cell.before > 15 || cell.value < 0 || cell.value > 15
            || cell.before === cell.value) return unavailable;
        const key = `${cell.row}:${cell.col}`;
        if (byCoordinate.has(key)) return unavailable;
        byCoordinate.set(key, cell);
    }
    if (!cells.length) return "PIXEL CHANGES: none (complete final-frame comparison).";
    const components = arcChangedComponents(delta).sort((a,b) => b.changed_cells-a.changed_cells
        || a.bbox.top-b.bbox.top || a.bbox.left-b.bbox.left);
    const regions: Region[] = [];
    let included = 0;
    const render = (selected: Region[], count: number) => PREFIX + JSON.stringify({
        regions: selected, omitted_regions: components.length-selected.length,
        omitted_cells: cells.length-count,
    });
    for (const component of components) {
        if (regions.length >= 8) break;
        const { top,left,bottom,right } = component.bbox;
        const points: Cell[] = JSON.parse(component.shape_signature).map(([dy,dx]: number[]) =>
            byCoordinate.get(`${top+dy}:${left+dx}`)!);
        const colors = new Map<string, number[]>();
        for (const cell of points) {
            const key = `${cell.before}:${cell.value}`;
            const entry = colors.get(key) ?? [cell.before,cell.value,0];
            entry[2] += 1;
            colors.set(key, entry);
        }
        const region: Region = { cells: points.length, bbox: [left,top,right,bottom],
            colors: [...colors.values()].sort((a,b) => a[0]-b[0] || a[1]-b[1]) };
        if (points.length <= 16) region.pixels = points.map(c => [c.col,c.row,c.before,c.value]);
        if (region.pixels && render([...regions,region],included+points.length).length > MAX_CHARS) {
            delete region.pixels;
            region.pixels_omitted = true;
        }
        if (render([...regions,region],included+points.length).length > MAX_CHARS) continue;
        regions.push(region);
        included += points.length;
    }
    return render(regions,included);
}
