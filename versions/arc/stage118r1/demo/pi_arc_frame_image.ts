/** Agent-side PNG projection of the current canonical public ARC frame. */
import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";

const COLORS: Array<[number, number, number]> = [
	[18, 18, 18], [0, 116, 217], [255, 65, 54], [46, 204, 64],
	[255, 220, 0], [170, 170, 170], [240, 18, 190], [255, 133, 27],
	[127, 219, 255], [135, 12, 37], [255, 255, 255], [76, 70, 50],
	[177, 63, 191], [37, 188, 154], [121, 85, 72], [70, 70, 230],
];

const crcTable = Array.from({ length: 256 }, (_, index) => {
	let value = index;
	for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
	return value >>> 0;
});

function chunk(name: string, data: Buffer): Buffer {
	const label = Buffer.from(name, "ascii");
	const length = Buffer.alloc(4);
	length.writeUInt32BE(data.length);
	let crc = 0xffffffff;
	for (const byte of Buffer.concat([label, data])) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
	const tail = Buffer.alloc(4);
	tail.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
	return Buffer.concat([length, label, data, tail]);
}

export function renderArcFrameImage(value: Record<string, any>, canonicalRef?: string): {
	content: { type: "image"; data: string; mimeType: "image/png" };
	metadata: Record<string, unknown>;
	label: string;
} {
	const frames = Array.isArray(value.frames) ? value.frames : [];
	const frame = frames.at(-1);
	if (!Array.isArray(frame) || !frame.length || !frame.every((row) => Array.isArray(row)))
		throw new Error("current public ARC frame is unavailable");
	const height = frame.length, width = frame[0].length;
	if (!width || width > 256 || height > 256 || frame.some((row) => row.length !== width))
		throw new Error("current public ARC frame must be a rectangular grid of at most 256x256");
	// One PNG pixel per game pixel, matching the native ARC/Continual Harness
	// frame. Upscaling spends image context without adding observation data.
	const scale = 1;
	const imageWidth = width * scale, imageHeight = height * scale;
	const stride = 1 + imageWidth * 3;
	const raw = Buffer.alloc(stride * imageHeight);
	for (let y = 0; y < imageHeight; y += 1) {
		const row = Math.floor(y / scale), rowStart = y * stride + 1;
		for (let x = 0; x < imageWidth; x += 1) {
			const column = Math.floor(x / scale);
			const colorIndex = Number(frame[row][column]);
			const color = COLORS[colorIndex] ?? [37 * colorIndex % 256, 83 * colorIndex % 256, 131 * colorIndex % 256];
			const offset = rowStart + x * 3;
			raw[offset] = color[0]; raw[offset + 1] = color[1]; raw[offset + 2] = color[2];
		}
	}
	const header = Buffer.alloc(13);
	header.writeUInt32BE(imageWidth, 0); header.writeUInt32BE(imageHeight, 4);
	header[8] = 8; header[9] = 2;
	const png = Buffer.concat([
		Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
		chunk("IHDR", header), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0)),
	]);
	const frameSha256 = createHash("sha256").update(JSON.stringify(frame)).digest("hex");
	const imageSha256 = createHash("sha256").update(png).digest("hex");
	const metadata = {
		codec: "arc-frame-png-v1", canonical_ref: canonicalRef ?? null,
		frame_sha256: frameSha256, image_sha256: imageSha256,
		frame_size: [height, width], image_size: [imageHeight, imageWidth], scale,
		coverage: "all_current_frame_pixels", omitted_animation_frames: frames.length - 1,
		palette: "project-arc-visual-palette-v1", image_bytes: png.length,
		observation_delivery: "complete_current_frame",
	};
	const label = `ARC_OBSERVATION_IMAGE ${JSON.stringify(metadata)}\nComplete frame PNG: each game pixel is ${scale}x${scale} image pixels; top-left is (0,0), x grows right, y grows down. Matching full hex grids use 0-f for color numbers 0-15.`;
	return { content: { type: "image", data: png.toString("base64"), mimeType: "image/png" }, metadata, label };
}
