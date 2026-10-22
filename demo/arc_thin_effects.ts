/** Observation-derived effect receipts for ARC thin. */
export type Grid = number[][];
export type StatusMask = { rows: Set<number>; cols: Set<number>; ticker: Set<string> };
export type ActionRow = { n:number; action:string; x?:number; y?:number; levels_completed?:number; level_changed?:boolean; state?:string };
export type EffectObject = { colour:number; size:number; cells:Array<[number,number]>; box:{left:number;right:number;top:number;bottom:number} };
export type EffectReceipt = { n:number; level:number; attempt:number; label:string; kind:'level'|'game_over'|'reset'|'inert'|'move'|'struct'; masked:number; status:number; dest?:string; config:string; newConfig:boolean; newState:boolean; steps:number[]; stateBefore:string; stateAfter:string; replayOf?:number; provisional?:boolean };
const at=(x:number,y:number)=>x+','+y;
const hidden=(m:StatusMask,x:number,y:number)=>m.rows.has(y)||m.cols.has(x)||m.ticker.has(at(x,y));
export function objectsOf(grid:Grid|undefined,mask:StatusMask):EffectObject[]{
 if(!grid?.length)return[];const count=new Map<number,number>();
 for(let y=0;y<grid.length;y++)for(let x=0;x<(grid[y]?.length??0);x++)if(!hidden(mask,x,y))count.set(grid[y][x],(count.get(grid[y][x])??0)+1);
 const background=[...count].sort((a,b)=>b[1]-a[1]||a[0]-b[0])[0]?.[0],seen=new Set<string>(),objects:EffectObject[]=[];
 for(let y=0;y<grid.length;y++)for(let x=0;x<(grid[y]?.length??0);x++){const colour=grid[y][x],first=at(x,y);if(hidden(mask,x,y)||colour===background||seen.has(first))continue;
  const stack:Array<[number,number]>=[[x,y]],cells:Array<[number,number]>=[];seen.add(first);
  while(stack.length){const[cx,cy]=stack.pop()!;cells.push([cx,cy]);for(const[nx,ny]of[[cx+1,cy],[cx-1,cy],[cx,cy+1],[cx,cy-1]] as Array<[number,number]>){const k=at(nx,ny);if(ny>=0&&ny<grid.length&&nx>=0&&nx<(grid[ny]?.length??0)&&!hidden(mask,nx,ny)&&grid[ny][nx]===colour&&!seen.has(k)){seen.add(k);stack.push([nx,ny]);}}}
  const xs=cells.map(c=>c[0]),ys=cells.map(c=>c[1]);objects.push({colour,size:cells.length,cells,box:{left:Math.min(...xs),right:Math.max(...xs),top:Math.min(...ys),bottom:Math.max(...ys)}});
 }return objects;
}
export const configOf=(objects:EffectObject[])=>objects.map(o=>o.colour+':'+o.size).sort().join('|');
const stateKey=(grid:Grid|undefined,mask:StatusMask)=>grid?.map((row,y)=>row.map((v,x)=>hidden(mask,x,y)?'_':String(v)).join(',')).join(';')??'';
export function effectOf(before:Grid|undefined,after:Grid|undefined,row:ActionRow,mask:StatusMask,ctx:{attempt:number;previous?:EffectReceipt[];transitions?:number}={attempt:0}):EffectReceipt{
 const old=objectsOf(before,mask),next=objectsOf(after,mask),priorConfig=configOf(old),config=configOf(next),beforeKey=stateKey(before,mask),afterKey=stateKey(after,mask);let masked=0,status=0;
 for(let y=0;y<Math.max(before?.length??0,after?.length??0);y++)for(let x=0;x<Math.max(before?.[y]?.length??0,after?.[y]?.length??0);x++)if(before?.[y]?.[x]!==after?.[y]?.[x]){if(hidden(mask,x,y))status++;else masked++;}
 const label=row.x!==undefined&&row.y!==undefined?row.action+'('+row.x+','+row.y+')':row.action,object=row.x===undefined||row.y===undefined?undefined:old.find(o=>o.cells.some(([x,y])=>x===row.x&&y===row.y));
 const distance=(a:EffectObject,b:EffectObject)=>Math.max(Math.abs((a.box.left+a.box.right-b.box.left-b.box.right)/2),Math.abs((a.box.top+a.box.bottom-b.box.top-b.box.bottom)/2));
 const steps=old.flatMap(o=>{const match=next.filter(x=>x.colour===o.colour&&x.size===o.size).sort((a,b)=>distance(o,a)-distance(o,b))[0];return match?[distance(o,match)]:[];});
 const level=Math.max(0,(row.levels_completed??0)-(row.level_changed?1:0));
 const kind:EffectReceipt['kind']=row.level_changed?'level':/^(GAME_OVER|WIN|FINISHED)$/.test(row.state??'')?'game_over':row.action==='RESET'?'reset':masked===0?'inert':priorConfig===config?'move':'struct';
 const replay=ctx.previous?.find(x=>x.level===level&&x.label===label&&x.stateBefore===beforeKey&&x.stateAfter===afterKey);
 return{n:row.n,level,attempt:ctx.attempt,label,kind,masked,status,...(object?{dest:object.colour+':'+object.size}:{}),config,newConfig:priorConfig!==config,newState:beforeKey!==afterKey,steps,stateBefore:beforeKey,stateAfter:afterKey,...(replay?{replayOf:replay.n}:{}),...(ctx.transitions!==undefined&&ctx.transitions<8?{provisional:true}:{})};
}
