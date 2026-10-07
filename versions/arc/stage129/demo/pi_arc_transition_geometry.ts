/** Exact geometry over public final frames; no object identity or goal inference. */
type Grid=number[][];
type Region={value:number;cells:number;anchor:[number,number];coordinates:Array<[number,number]>;signature:string};
type Translation={value:number;cells:number;from:[number,number];to:[number,number];offset:number[];
    entered_colors?:Array<[number,number]>;entered_colors_omitted_cells?:number};

const validGrid=(g:any):g is Grid=>Array.isArray(g)&&g.length>0&&g.length<=256
        &&Array.isArray(g[0])&&g[0].length>0&&g[0].length<=256
        &&g.every((r:any)=>Array.isArray(r)&&r.length===g[0].length&&r.every(Number.isInteger));

function colorRegions(grid:Grid){
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
    }

/** Exact bounded color components; fragments are not inferred whole objects. */
export function arcSmallColorRegions(frame:unknown): {regions:Array<{
    value:number;cells:number;anchor:[number,number];mask:string[]}>;omitted:number}|null {
    if(!validGrid(frame))return null;
    const regions=[...colorRegions(frame).values()].flat().flatMap(region=>{
        if(region.cells>64)return [];
        const [left,top]=region.anchor;
        const width=Math.max(...region.coordinates.map(([x])=>x))-left+1;
        const height=Math.max(...region.coordinates.map(([,y])=>y))-top+1;
        if(width>16||height>16)return [];
        const cells=new Set(region.coordinates.map(([x,y])=>`${x},${y}`));
        const mask=Array.from({length:height},(_,dy)=>Array.from({length:width},(_,dx)=>
            cells.has(`${left+dx},${top+dy}`)?"#":".").join(""));
        return [{value:region.value,cells:region.cells,anchor:region.anchor,mask}];
    }).sort((a,b)=>b.cells-a.cells||a.anchor[1]-b.anchor[1]||a.anchor[0]-b.anchor[0]||a.value-b.value);
    return {regions:regions.slice(0,16),omitted:Math.max(0,regions.length-16)};
}

export function renderArcSmallColorRegions(frame:unknown,stateRef:string):string {
    const table=arcSmallColorRegions(frame);
    return table?.regions.length ? `CURRENT SMALL COLOR REGIONS state=${stateRef} (4-connected, 1..64 cells, bbox<=16x16; anchor=[x,y]; #=region, .=outside; fragments, not object/goal identities): ${JSON.stringify(table)}` : "";
}

type OffsetWitness = ReturnType<typeof arcUniqueRegionTranslations>[number] & {
    action: string; action_index: number; pre_action_ref: string;
};
type PatternChange={value:number;cells:number;anchor:[number,number];before:string[];after:string[]};
type PatternChanges={changes:PatternChange[];omitted:number};
type PatternWitness=PatternChange & {action:string;action_index:number;pre_action_ref:string};
type StationaryWitness={signature:string;value:number;cells:number;anchor:[number,number];mask:string[];
    action:string;observations:number;action_index:number;pre_action_ref:string};
type FramePair={before:unknown;after:unknown};

/** Pixel correspondences and current exact template matches, without object identity. */
export class ArcTranslationWitnesses {
    private epoch = 0;
    private omitted = 0;
    private witnesses: OffsetWitness[] = [];
    private patterns: PatternWitness[] = [];
    private omittedPatterns = 0;
    private trackedShapes = new Set<string>();
    private stationary: StationaryWitness[] = [];
    private omittedStationary = 0;
    // Compute identity is separate from the bounded model-visible ledger.
    // RESET does not erase facts already consumed at this real level.
    private reasoningFacts = new Set<string>();
    facts(): string[] { return [...this.reasoningFacts].sort(); }
    record(action: string, translations: ReturnType<typeof arcUniqueRegionTranslations>,
        source: { action_index: number; pre_action_ref: string }, boundary = false,
        patterns: PatternChanges = {changes:[],omitted:0}, frames?: FramePair): void {
        if (action === "RESET" || boundary) {
            if(boundary)this.reasoningFacts.clear();
            this.epoch++; this.witnesses = []; this.omitted = 0;
            this.patterns = []; this.omittedPatterns = 0;
            this.trackedShapes.clear();this.stationary=[];this.omittedStationary=0;return;
        }
        this.omittedPatterns+=patterns.omitted;
        for(const pattern of patterns.changes){
            const key=JSON.stringify(pattern);
            this.reasoningFacts.add(JSON.stringify(["pattern",action,pattern]));
            if(this.patterns.some(({action:_action,action_index:_index,pre_action_ref:_ref,...prior})=>JSON.stringify(prior)===key))continue;
            this.patterns.push({...pattern,action,...source});
            if(this.patterns.length>8){this.patterns.shift();this.omittedPatterns++;}
        }
        // One largest exact region per observed offset avoids duplicating the
        // same displacement across colors. Distinct/conflicting offsets stay.
        const offsets = new Set<string>();
        const validFrames=frames&&validGrid(frames.before)&&validGrid(frames.after)
            &&frames.before.length===frames.after.length&&frames.before[0].length===frames.after[0].length;
        const before=validFrames?colorRegions(frames!.before as Grid):null;
        const after=validFrames?colorRegions(frames!.after as Grid):null;
        for (const match of [...translations].sort((a,b) => b.cells-a.cells)) {
            const offset = JSON.stringify(match.offset);
            if (offsets.has(offset)) continue;
            offsets.add(offset);
            if(before){
                const region=[...before.values()].flat().find(row=>row.value===match.value&&row.cells===match.cells
                    &&JSON.stringify(row.anchor)===JSON.stringify(match.from));
                if(region&&region.cells>=4&&region.cells<=64){
                    const width=Math.max(...region.coordinates.map(([x])=>x))-region.anchor[0]+1;
                    const height=Math.max(...region.coordinates.map(([,y])=>y))-region.anchor[1]+1;
                    if(width<=16&&height<=16){
                        this.trackedShapes.delete(region.signature);this.trackedShapes.add(region.signature);
                        if(this.trackedShapes.size>16)this.trackedShapes.delete(this.trackedShapes.values().next().value!);
                    }
                }
            }
            if (this.witnesses.some(row => row.action === action
                && row.value === match.value && row.cells === match.cells
                && JSON.stringify(row.offset) === offset
                && JSON.stringify(row.entered_colors) === JSON.stringify(match.entered_colors)
                && row.entered_colors_omitted_cells === match.entered_colors_omitted_cells)) continue;
            this.witnesses.push({ ...match, action, ...source });
            if (this.witnesses.length > 16) { this.witnesses.shift(); this.omitted++; }
        }
        if(before&&after){
            const candidates=[...this.trackedShapes].flatMap(signature=>{
                const from=before.get(signature),to=after.get(signature);
                return from?.length===1&&to?.length===1?[{from:from[0],to:to[0]}]:[];
            });
            const largest=Math.max(0,...candidates.map(({from})=>from.cells));
            for(const {from,to}of candidates){
                if(from.cells!==largest||JSON.stringify(from.anchor)!==JSON.stringify(to.anchor))continue;
                this.reasoningFacts.add(JSON.stringify(["stationary",action,from.signature,from.anchor]));
                const prior=this.stationary.find(row=>row.signature===from.signature&&row.action===action
                    &&JSON.stringify(row.anchor)===JSON.stringify(from.anchor));
                if(prior){prior.observations++;Object.assign(prior,source);continue;}
                const [left,top]=from.anchor;
                const width=Math.max(...from.coordinates.map(([x])=>x))-left+1;
                const height=Math.max(...from.coordinates.map(([,y])=>y))-top+1;
                const coordinates=new Set(from.coordinates.map(([x,y])=>`${x},${y}`));
                const mask=Array.from({length:height},(_,dy)=>Array.from({length:width},(_,dx)=>
                    coordinates.has(`${left+dx},${top+dy}`)?"#":".").join(""));
                this.stationary.push({signature:from.signature,value:from.value,cells:from.cells,anchor:from.anchor,
                    mask,action,observations:1,...source});
                if(this.stationary.length>16){this.stationary.shift();this.omittedStationary++;}
            }
        }
    }
    renderCurrent(frame: unknown, stateRef: string): string {
        if (!this.trackedShapes.size) return "";
        const heading=`CURRENT MATCHES OF PREVIOUSLY TRANSLATED PATTERNS state=${stateRef} epoch=${this.epoch}`;
        if (!validGrid(frame)) return `${heading}: unavailable (invalid current frame).`;
        const regions=colorRegions(frame);
        const matches=[...this.trackedShapes].map(signature=>{
            const [value,coordinates]=JSON.parse(signature) as [number,Array<[number,number]>];
            const width=Math.max(...coordinates.map(([x])=>x))+1;
            const height=Math.max(...coordinates.map(([,y])=>y))+1;
            const pixels=new Set(coordinates.map(([x,y])=>`${x},${y}`));
            const mask=Array.from({length:height},(_,y)=>Array.from({length:width},(_,x)=>
                pixels.has(`${x},${y}`)?"#":".").join(""));
            const found=regions.get(signature)??[];
            return {value,cells:coordinates.length,mask,matches:found.length,
                ...(found.length===1?{anchor:found[0].anchor}:{})};
        });
        return `${heading} (exact color/shape; anchor=[x,y] only for a unique match; #=region, .=outside; no object identity or goal inference): ${JSON.stringify(matches)}`;
    }
    render(): string {
        const offset=this.witnesses.length ? `PUBLIC OFFSET WITNESSES epoch=${this.epoch} ([dx,dy]; entered_colors=[prior color,newly occupied cell count], excluding overlap; historical exact same-color/same-shape matches, not object identity, universal controls, current positions or goals): ${JSON.stringify(this.witnesses)}. Omitted=${this.omitted}; complete transitions remain in the ARC trace.` : "";
        const patterns=this.patterns.length ? `PUBLIC ANCHORED PATTERN CHANGES epoch=${this.epoch} (same color/anchor/cell count; #=this connected region, .=outside it; historical before/after masks, no object, causal or goal inference): ${JSON.stringify(this.patterns)}. Omitted=${this.omittedPatterns}; complete frames remain in the ARC trace.` : "";
        const stationary=this.stationary.length ? `PUBLIC UNCHANGED PLACEMENT WITNESSES epoch=${this.epoch} (largest unique matching previously translated patterns; same color/shape/anchor before and after the listed action; #=region, .=outside; historical observations, not whole-state no-ops or permanent blocks): ${JSON.stringify(this.stationary.map(({signature:_signature,...row})=>row))}. Omitted=${this.omittedStationary}; complete states remain in the ARC trace.` : "";
        return [offset,patterns,stationary].filter(Boolean).join("\n");
    }
}

/** Exact small same-anchor pattern differences, without matching object identities. */
export function arcAnchoredPatternChanges(before:unknown,after:unknown):PatternChanges {
    if(!validGrid(before)||!validGrid(after)||before.length!==after.length||before[0].length!==after[0].length)return {changes:[],omitted:0};
    const index=(grid:Grid)=>new Map([...colorRegions(grid).values()].flat()
        .map(region=>[JSON.stringify([region.value,region.anchor]),region]));
    const a=index(before),b=index(after),result:PatternChange[]=[];
    for(const [key,from]of a){
        const to=b.get(key);
        if(!to||from.cells!==to.cells||from.cells<4||from.cells>64||from.signature===to.signature)continue;
        const [left,top]=from.anchor;
        const right=Math.max(...from.coordinates.map(([x])=>x),...to.coordinates.map(([x])=>x));
        const bottom=Math.max(...from.coordinates.map(([,y])=>y),...to.coordinates.map(([,y])=>y));
        if(right-left>=16||bottom-top>=16)continue;
        const mask=(region:Region)=>{
            const cells=new Set(region.coordinates.map(([x,y])=>`${x},${y}`));
            return Array.from({length:bottom-top+1},(_,dy)=>Array.from({length:right-left+1},(_,dx)=>
                cells.has(`${left+dx},${top+dy}`)?"#":".").join(""));
        };
        result.push({value:from.value,cells:from.cells,anchor:from.anchor,before:mask(from),after:mask(to)});
    }
    return {changes:result.sort((a,b)=>b.cells-a.cells||a.value-b.value).slice(0,8),omitted:Math.max(0,result.length-8)};
}

export function arcUniqueRegionTranslations(before:unknown,after:unknown):Translation[] {
    if(!validGrid(before)||!validGrid(after)||before.length!==after.length||before[0].length!==after[0].length)return [];
    const a=colorRegions(before),b=colorRegions(after),result:Translation[]=[];
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
        const colors=new Map<number,number>();
        for(const [x,y]of to.coordinates){
            if(sourceCells.has(`${x},${y}`))continue;
            colors.set(before[y][x],(colors.get(before[y][x])??0)+1);
        }
        const counts=[...colors.entries()].sort((a,b)=>a[0]-b[0]);
        const omitted=counts.slice(16).reduce((sum,[,count])=>sum+count,0);
        result.push({value:from.value,cells:from.cells,from:from.anchor,to:to.anchor,offset:[dx,dy],
            entered_colors:counts.slice(0,16),...(omitted?{entered_colors_omitted_cells:omitted}:{})});
    }
    return result.sort((a,b)=>b.cells-a.cells).slice(0,8);
}
