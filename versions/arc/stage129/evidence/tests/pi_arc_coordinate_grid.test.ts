import { test } from "node:test";
import assert from "node:assert/strict";
import { arcHexGrid, renderArcObservationWindow } from "../demo/pi_arc_observation_window.ts";
import { renderArcFrameImage } from "../demo/pi_arc_frame_image.ts";

function frame(height = 64, width = 64) {
	return Array.from({ length: height }, (_, y) =>
		Array.from({ length: width }, (_, x) => (y * 7 + x * 11) % 16));
}

// Independent decoder: explicit width keeps rulers/labels out of the pixels.
function pixels(text: string, height: number, width: number) {
	const rows = text.split("\n").filter(line =>
		new RegExp(`^[0-9a-f]{${width}}(?: y=\\d{2})?$`).test(line));
	assert.equal(rows.length, height);
	return rows.map(row => [...row.slice(0, width)].map(c => parseInt(c, 16)));
}

test("64x64 coordinate rulers index each column and every eighth row without changing any pixel", () => {
	const value = frame(), text = arcHexGrid(value, "current_state_frame"), lines = text.split("\n");
	assert.equal(lines[1], Array.from({length:64},(_,x)=>String(Math.floor(x/10))).join("") + " x tens");
	assert.equal(lines[2], Array.from({length:64},(_,x)=>String(x%10)).join("") + " x ones");
	for (let y=0;y<64;y++) {
		const expected = value[y].map(c=>c.toString(16)).join("");
		assert.equal(lines[y+3], expected + (y%8===0 ? ` y=${String(y).padStart(2,"0")}` : ""));
	}
	assert.deepEqual(pixels(text, 64, 64), value);
	assert.equal(pixels(text,64,64)[45][30],value[45][30]);
	const original = `Grid current_state_frame (64x64) [hex 0-f = color 0-15]:\n${value.map(r=>r.map(c=>c.toString(16)).join("")).join("\n")}`;
	assert.equal(text.length-original.length,184);
	assert.equal(JSON.stringify(text).length-JSON.stringify(original).length,186);
});

test("non-square and last two-digit coordinates retain exact row/column addressing", () => {
	for(const [height,width] of [[32,48],[99,99]]) {
		const value=frame(height,width),text=arcHexGrid(value,"current_state_frame");
		assert.deepEqual(pixels(text,height,width),value);
		assert.equal(text.split("\n")[1].slice(0,width),
			Array.from({length:width},(_,x)=>String(Math.floor(x/10))).join(""));
		assert.match(text,/ y=24/);
	}
});

test("small or three-digit dimensions keep the unambiguous original grid", () => {
	for(const [height,width] of [[2,2],[16,64],[64,16],[100,64],[64,100],[1,256]]) {
		const value=frame(height,width),text=arcHexGrid(value,"current_state_frame");
		assert.equal(text.split("\n").length,height+1);
		assert.doesNotMatch(text,/x tens|x ones| y=/);
		assert.deepEqual(pixels(text,height,width),value);
	}
});

test("window preserves native image bytes and exact sparse animation while rendering coordinate grid", () => {
	const current=frame(),peak=current.map(r=>[...r]);peak[45][30]=15-current[45][30];
	const event={event:"action",index:1,action:"ACTION6",state_before:"NOT_FINISHED",level_before:0,
		observation_delta:{changed_cells:0},frame:{state:"NOT_FINISHED",levels_completed:0,frames:[peak,current]}};
	const view=renderArcObservationWindow([event],{frames:[current]},{includeImages:true});
	const currentText=view.text.split("\n\n").find(t=>t.startsWith("Grid current_state_frame ("))!;
	assert.deepEqual(pixels(currentText,64,64),current);
	const patch=view.text.split("\n\n").find(t=>t.startsWith("Grid arc-action-1_frame_0 ("))!;
	const recovered=current.map(r=>[...r]);
	for(const [y,x,hex] of JSON.parse(patch.split("\n")[1]))
		for(const [offset,c] of [...hex].entries()) recovered[y][x+offset]=parseInt(c as string,16);
	assert.deepEqual(recovered,peak);
	assert.deepEqual(view.images.map(i=>i.content),[peak,current].map(v=>renderArcFrameImage({frames:[v]}).content));
});
