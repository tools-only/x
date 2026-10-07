/** Exact geometry over public final frames; no object identity or goal inference. */
type Grid=number[][];
type Region={value:number;cells:number;anchor:[number,number];coordinates:Array<[number,number]>;signature:string};

type OffsetWitness = ReturnType<typeof arcUniqueRegionTranslations>[number] & {
    action: string; action_index: number; pre_action_ref: string;
};

/** Historical pixel correspondences, never inferred control rules or live positions. */
export class ArcTranslationWitnesses {
    private epoch = 0;
    private omitted = 0;
    private witnesses: OffsetWitness[] = [];
    record(action: string, translations: ReturnType<typeof arcUniqueRegionTranslations>,
        source: { action_index: number; pre_action_ref: string }, boundary = false): void {
        if (action === "RESET" || boundary) {
            this.epoch++; this.witnesses = []; this.omitted = 0; return;
        }
        // One largest exact region per observed offset avoids duplicating the
        // same displacement across colors. Distinct/conflicting offsets stay.
        const offsets = new Set<string>();
        for (const match of [...translations].sort((a,b) => b.cells-a.cells)) {
            const offset = JSON.stringify(match.offset);
            if (offsets.has(offset)) continue;
            offsets.add(offset);
            if (this.witnesses.some(row => row.action === action
                && row.value === match.value && row.cells === match.cells
                && JSON.stringify(row.offset) === offset)) continue;
            this.witnesses.push({ ...match, action, ...source });
            if (this.witnesses.length > 16) { this.witnesses.shift(); this.omitted++; }
        }
    }
    render(): string {
        if (!this.witnesses.length) return "";
        return `PUBLIC OFFSET WITNESSES epoch=${this.epoch} ([dx,dy]; historical exact same-color/same-shape matches, not object identity, universal controls, current positions or goals): ${JSON.stringify(this.witnesses)}. Omitted=${this.omitted}; complete transitions remain in the ARC trace.`;
    }
}

export function arcUniqueRegionTranslations(before:unknown,after:unknown) {
    const valid=(g:any):g is Grid=>Array.isArray(g)&&g.length>0&&g.length<=256
        &&Array.isArray(g[0])&&g[0].length>0&&g[0].length<=256
        &&g.every((r:any)=>Array.isArray(r)&&r.length===g[0].length&&r.every(Number.isInteger));
    if(!valid(before)||!valid(after)||before.length!==after.length||before[0].length!==after[0].length)return [];
    const regions=(grid:Grid)=>{
        const width=grid[0].length,seen=new Uint8Array(width*grid.length),result=new Map<string,Region[]>();
        for(let y=0;y<grid.length;y++)for(let x=0;x<width;x++){
            if(seen[y*width+x])continue;
            const value=grid[y][x],queue:Array<[number,number]>=[[x,y]],cells:Array<[number,number]>=[];
            seen[y*width+x]=1;
            for(let i=0;i<queue.length;i++){
                const [cx,cy]=queue[i];cells.push([cx,cy]);
                for(const [dx,dy]of [[1,0],[-1,0],[0,1],[0,-1]]){
                    const nx=cx+dx,ny=cy+dy;
                    if(nx<0||nx>=width||ny<0||ny>=grid.length||seen[ny*width+nx]||grid[ny][nx]!==value)continue;
                    seen[ny*width+nx]=1;queue.push([nx,ny]);
                }
            }
            const left=Math.min(...cells.map(c=>c[0])),top=Math.min(...cells.map(c=>c[1]));
            const signature=JSON.stringify([value,cells.sort((a,b)=>a[1]-b[1]||a[0]-b[0]).map(([cx,cy])=>[cx-left,cy-top])]);
            const region:Region={value,cells:cells.length,anchor:[left,top],coordinates:cells,signature};
            result.set(signature,[...(result.get(signature)??[]),region]);
        }
        return result;
    };
    const a=regions(before),b=regions(after),result=[];
    for(const [signature,source]of a){
        const target=b.get(signature);
        if(source.length!==1||target?.length!==1)continue;
        const from=source[0],to=target[0],dx=to.anchor[0]-from.anchor[0],dy=to.anchor[1]-from.anchor[1];
        if(dx===0&&dy===0)continue;
        const sourceCells=new Set(from.coordinates.map(([x,y])=>`${x},${y}`));
        const targetCells=new Set(to.coordinates.map(([x,y])=>`${x},${y}`));
        // Reject split/merged complementary regions that merely share a shape.
        // Overlapping translations keep their intersection unchanged.
        if(from.coordinates.some(([x,y])=>!targetCells.has(`${x},${y}`)&&after[y][x]===from.value)
            ||to.coordinates.some(([x,y])=>!sourceCells.has(`${x},${y}`)&&before[y][x]===from.value))continue;
        result.push({value:from.value,cells:from.cells,from:from.anchor,to:to.anchor,offset:[dx,dy]});
    }
    return result.sort((a,b)=>b.cells-a.cells).slice(0,8);
}
