import { strict as assert } from "node:assert";
import { inflateSync } from "node:zlib";
import { test } from "node:test";
import { renderArcFrameImage } from "../demo/pi_arc_frame_image.ts";

test("native PNG preserves every pixel in an asymmetric rectangular frame", () => {
    const grid = [[0, 12, 9], [15, 0, 12]];
    const image = renderArcFrameImage({ frames: [grid] }, "observation_snapshot:test@v1");
    assert.equal(image.metadata.scale, 1);
    assert.deepEqual(image.metadata.frame_size, [2, 3]);
    assert.deepEqual(image.metadata.image_size, [2, 3]);
    assert.equal(image.metadata.coverage, "all_current_frame_pixels");
    const png = Buffer.from(image.content.data, "base64");
    assert.equal(png.readUInt32BE(16), 3);
    assert.equal(png.readUInt32BE(20), 2);
    const chunks: Buffer[] = [];
    for (let offset = 8; offset < png.length;) {
        const size = png.readUInt32BE(offset);
        if (png.toString("ascii", offset + 4, offset + 8) === "IDAT")
            chunks.push(png.subarray(offset + 8, offset + 8 + size));
        offset += size + 12;
    }
    const raw = inflateSync(Buffer.concat(chunks));
    assert.deepEqual([...raw], [
        0, 18, 18, 18, 177, 63, 191, 135, 12, 37,
        0, 70, 70, 230, 18, 18, 18, 177, 63, 191,
    ]);
    assert.throws(() => renderArcFrameImage({ frames: [[[1, 2], [3]]] }), /rectangular/);
});
