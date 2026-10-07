/** Public-pixel geometry only. No game identity, action choice or target semantics. */
type Box = { x0: number; y0: number; x1: number; y1: number };
type Run = [number, number];
export type ExactArcRegion = {
    bounds: Box; x_runs: Run[]; y_runs: Run[]; hex_rows: string[];
};

function merge(a: Box, b: Box): Box {
    return {x0: Math.min(a.x0,b.x0), y0: Math.min(a.y0,b.y0),
        x1: Math.max(a.x1,b.x1), y1: Math.max(a.y1,b.y1)};
}

/** Fold equal adjacent vectors; coordinate intervals retain exact reconstruction. */
function runs(start: number, end: number, same: (a: number, b: number) => boolean): Run[] {
    const result: Run[] = [];
    let first=start;
    for (let i=start+1;i<=end;i++) if (!same(i-1,i)) {
        result.push([first,i-1]); first=i;
    }
    result.push([first,end]);
    return result;
}

export function exactArcRegions(frame: unknown): { background: number; regions: ExactArcRegion[];
    omitted_components: number; omitted_regions: number } | null {
    if (!Array.isArray(frame) || !frame.length || frame.length>256 || !Array.isArray(frame[0])) return null;
    const h=frame.length,w=frame[0].length;
    if (!w || w>256 || frame.some(row=>!Array.isArray(row) || row.length!==w
        || row.some(c=>!Number.isInteger(c) || c<0 || c>15))) return null;
    const grid=frame as number[][], counts=Array(16).fill(0);
    for (const row of grid) for (const c of row) counts[c]++;
    const background=counts.indexOf(Math.max(...counts));
    // A weak modal color is not a credible geometric separator.
    if (counts[background]<h*w*0.35) return null;
    const seen=new Uint8Array(h*w), boxes: Box[]=[];
    let omitted=0;
    for (let y=0;y<h;y++) for (let x=0;x<w;x++) {
        const first=y*w+x;
        if (seen[first] || grid[y][x]===background) continue;
        const queue=[first]; seen[first]=1;
        let box: Box={x0:x,y0:y,x1:x,y1:y};
        for (let i=0;i<queue.length;i++) {
            const cell=queue[i], cy=Math.floor(cell/w),cx=cell%w;
            box=merge(box,{x0:cx,y0:cy,x1:cx,y1:cy});
            for (const next of [cx>0?cell-1:-1,cx+1<w?cell+1:-1,cy>0?cell-w:-1,cy+1<h?cell+w:-1]) {
                if (next<0 || seen[next] || grid[Math.floor(next/w)][next%w]===background) continue;
                seen[next]=1; queue.push(next);
            }
        }
        if (queue.length<4) {omitted++;continue;}
        boxes.push(box);
        if (boxes.length>256) return null; // Avoid quadratic noisy-scene work.
    }
    const parents=boxes.map((_,i)=>i);
    function find(i:number):number {
        while(parents[i]!==i) {parents[i]=parents[parents[i]];i=parents[i];}
        return i;
    }
    // Pair threshold uses original components, not growing merged boxes.
    // Transitive grouping is an explicitly approximate spatial index.
    for(let i=0;i<boxes.length;i++) for(let j=i+1;j<boxes.length;j++) {
        const a=boxes[i],b=boxes[j];
        const gapX=Math.max(0,a.x0-b.x1-1,b.x0-a.x1-1);
        const gapY=Math.max(0,a.y0-b.y1-1,b.y0-a.y1-1);
        const threshold=Math.min(a.x1-a.x0+1,a.y1-a.y0+1,b.x1-b.x0+1,b.y1-b.y0+1)/2;
        if(gapX+gapY<=threshold) parents[find(j)]=find(i);
    }
    const groups=new Map<number,Box>();
    boxes.forEach((box,i)=>{const key=find(i);groups.set(key,groups.has(key)?merge(groups.get(key)!,box):box);});
    const regions:ExactArcRegion[]=[];
    let omittedRegions=0;
    for(const bounds of [...groups.values()].sort((a,b)=>a.y0-b.y0 || a.x0-b.x0)) {
        const {x0,y0,x1,y1}=bounds;
        const y_runs=runs(y0,y1,(a,b)=>{
            for(let x=x0;x<=x1;x++) if(grid[a][x]!==grid[b][x]) return false;
            return true;
        });
        const x_runs=runs(x0,x1,(a,b)=>{
            for(let y=y0;y<=y1;y++) if(grid[y][a]!==grid[y][b]) return false;
            return true;
        });
        // An exact index is useful for regular structures; skip unbounded tables.
        if(regions.length>=8 || x_runs.length*y_runs.length>256) {omittedRegions++;continue;}
        regions.push({bounds,x_runs,y_runs,hex_rows:y_runs.map(([y])=>x_runs.map(([x])=>grid[y][x].toString(16)).join(""))});
    }
    return regions.length ? {background,regions,omitted_components:omitted,omitted_regions:omittedRegions}:null;
}

export function renderExactArcRegions(frame: unknown): string {
    const table=exactArcRegions(frame);
    if(!table) return "";
    const lines=[`PUBLIC PIXEL REGION INDEX (derived geometry; modal separator color=${table.background}).`,
        "Grouping approximates spatial proximity, not object identity, editability or a goal. Equal adjacent rows/columns are folded exactly; each hex entry fills the corresponding x/y interval. Full current grid/PNG remain authoritative."];
    table.regions.forEach((r,i)=>lines.push(`region ${i}: bounds=${JSON.stringify(r.bounds)}; x=${JSON.stringify(r.x_runs)}; y=${JSON.stringify(r.y_runs)}; rows=${JSON.stringify(r.hex_rows)}`));
    if(table.omitted_components || table.omitted_regions) lines.push(`Omitted from this auxiliary index: ${table.omitted_components} small components, ${table.omitted_regions} complex/excess regions.`);
    const text=lines.join("\n");
    return text.length<=4000?text:"";
}
