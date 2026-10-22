/** Result-backed falsification keys for level-change claims. */
import { objectsOf, type Grid, type StatusMask } from './arc_thin_effects.ts';
export type WinFailure={key:string;action:string;cap:Set<string>;count:number;rows:number[];source:'claim'|'false_win';released?:boolean};
export type WinTestState={failures:WinFailure[]};
export const winTestState=():WinTestState=>({failures:[]});
const classes=(grid:Grid|undefined,mask:StatusMask)=>new Set(objectsOf(grid,mask).map(o=>o.colour+':'+o.size));
export function winKey(grid:Grid|undefined,req:{action:string;x?:number;y?:number},mask:StatusMask):string{
 const dest=req.x===undefined||req.y===undefined?undefined:objectsOf(grid,mask).find(o=>o.cells.some(([x,y])=>x===req.x&&y===req.y));
 return dest?req.action+'|'+dest.colour+':'+dest.size:req.action+'|'+(grid??[]).map(row=>row.join(',')).join(';');
}
export function recordFailedClaim(state:WinTestState,before:Grid|undefined,row:{n:number;action:string;x?:number;y?:number;predict?:{level_changed?:boolean};level_changed?:boolean},mask:StatusMask):WinFailure|undefined{
 if(row.predict?.level_changed!==true||row.level_changed)return;
 const key=winKey(before,row,mask),found=state.failures.find(f=>f.key===key&&!f.released),cap=classes(before,mask);
 if(found){found.count++;found.rows.push(row.n);return found;}
 const entry:WinFailure={key,action:row.action,cap,count:1,rows:[row.n],source:'claim'};state.failures.push(entry);return entry;
}
export function recordFalseWin(state:WinTestState,input:{action:string;x?:number;y?:number;n:number},grid:Grid|undefined,mask:StatusMask):WinFailure{
 const key=winKey(grid,input,mask),found=state.failures.find(f=>f.key===key&&!f.released);
 if(found){found.count++;found.rows.push(input.n);found.source='false_win';return found;}
 const entry:WinFailure={key,action:input.action,cap:classes(grid,mask),count:1,rows:[input.n],source:'false_win'};state.failures.push(entry);return entry;
}
export function admitWinTest(state:WinTestState,req:{action:string;x?:number;y?:number;claim?:boolean},grid:Grid|undefined,mask:StatusMask,mode:'off'|'shadow'|'on',lock:'off'|'shadow'|'on'):{admit:boolean;rows:Array<{gate:'G2'|'G2b';verdict:string;key:string;evidence:number[]}>;refusal?:string}{
 if(mode==='off'&&lock==='off')return{admit:true,rows:[]};
 const present=classes(grid,mask),key=winKey(grid,req,mask),failure=state.failures.find(f=>f.key===key&&!f.released);
 if(failure&&[...present].some(cls=>!failure.cap.has(cls))){failure.released=true;return{admit:true,rows:[{gate:req.claim?'G2':'G2b',verdict:'released',key,evidence:failure.rows}]};}
 if(!failure)return{admit:true,rows:[]};
 const gate=req.claim?'G2':'G2b',enabled=req.claim?mode:lock,threshold=req.claim?1:2;
 if(!req.claim&&(req.x===undefined||req.y===undefined))return{admit:true,rows:[]};
 if(failure.count<threshold||enabled==='off')return{admit:true,rows:[]};
 const verdict=enabled==='on'?'refused':'would_refuse',rows=[{gate,verdict,key,evidence:failure.rows}];
 if(enabled!=='on')return{admit:true,rows};
 return{admit:false,rows,refusal:`${req.action} was NOT played: a level claim for ${key} was falsified at ${failure.rows.map(n=>'#'+n).join(', ')} with the current classes still present; it is admissible again when a new class appears; the same action without a level claim is admissible`};
}
