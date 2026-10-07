import {test} from "node:test";
import assert from "node:assert/strict";
import {exactArcRegions,renderExactArcRegions} from "../demo/pi_arc_structural_regions.ts";
import {arcHexGrid,renderArcObservationWindow} from "../demo/pi_arc_observation_window.ts";

test("offset/scaled/multicolor region table reconstructs every indexed pixel exactly",()=>{
    for(const scale of [1,2,3]) for(const offset of [0,3]) {
        const frame=Array.from({length:64},()=>Array(64).fill(5));
        const pattern=[[3,3,5,8],[3,0,5,8],[5,5,5,5],[9,9,5,8]];
        for(const [dx,dy] of [[offset+4,offset+4],[offset+32,offset+25]])
            for(let y=0;y<pattern.length*scale;y++) for(let x=0;x<pattern[0].length*scale;x++)
                frame[dy+y][dx+x]=pattern[Math.floor(y/scale)][Math.floor(x/scale)];
        const table=exactArcRegions(frame);
        assert.ok(table);
        for(const r of table.regions) {
            const recovered=new Map<string,number>();
            r.y_runs.forEach(([y0,y1],ri)=>r.x_runs.forEach(([x0,x1],ci)=>{
                for(let y=y0;y<=y1;y++) for(let x=x0;x<=x1;x++)
                    recovered.set(`${x},${y}`,parseInt(r.hex_rows[ri][ci],16));
            }));
            for(let y=r.bounds.y0;y<=r.bounds.y1;y++) for(let x=r.bounds.x0;x<=r.bounds.x1;x++)
                assert.equal(recovered.get(`${x},${y}`),frame[y][x]);
        }
        assert.ok(renderExactArcRegions(frame).length<=4000);
    }
});

test("noise, invalid/ragged pixels and ambiguous background do not produce an unbounded index",()=>{
    assert.equal(exactArcRegions([[0],[0,1]]),null);
    assert.equal(exactArcRegions([[17]]),null);
    assert.equal(exactArcRegions(Array.from({length:32},(_,y)=>Array.from({length:32},(_,x)=>(x+y)%16))),null);
    const noise=Array.from({length:128},(_,y)=>Array.from({length:128},(_,x)=>x%4<2 && y%4<2?8:5));
    assert.equal(exactArcRegions(noise),null);
});

test("auxiliary table is opt-in and preserves complete current grid and matching image",()=>{
    const frame=Array.from({length:20},(_,y)=>Array.from({length:20},(_,x)=>x>=4&&x<=8&&y>=5&&y<=9?8:5));
    const original=renderArcObservationWindow([],{frames:[frame]},{includeImages:true});
    const enabled=renderArcObservationWindow([],{frames:[frame]},{includeImages:true,exactRegions:true});
    assert.equal(original.text,arcHexGrid(frame,"current_state_frame"));
    assert.ok(enabled.text.startsWith(original.text));
    assert.match(enabled.text,/PUBLIC PIXEL REGION INDEX/);
    assert.deepEqual(enabled.images,original.images);
});
