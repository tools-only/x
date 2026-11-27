import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Immutable raw evidence. Reading it never republishes archived advice as active context. */
export class LayeredArchive {
  constructor(private root: string) { mkdirSync(root, { recursive: true }); }
  save(content: unknown): string {
    const text = JSON.stringify(content);
    const id = createHash("sha256").update(text).digest("hex");
    const path = join(this.root, `${id}.json`);
    if (!existsSync(path)) writeFileSync(path, text, "utf8");
    return id;
  }
  read(id: string, offset = 0, limit = 6000) {
    if (!/^[a-f0-9]{64}$/.test(id)) throw Error("invalid archive handle");
    if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 12000)
      throw Error("offset must be nonnegative; limit must be 1–12000");
    const text = readFileSync(join(this.root, `${id}.json`), "utf8");
    if (createHash("sha256").update(text).digest("hex") !== id) throw Error("archive integrity mismatch");
    return { id, offset, total_chars: text.length, next_offset: offset + limit < text.length ? offset + limit : null,
      text: text.slice(offset, offset + limit) };
  }
}

export function foldRecoverably(messages: any[], keepBlocks: number, archive: LayeredArchive) {
  const starts = messages.flatMap((message, index) => message.role === "user" || message.role === "custom" ? [index] : []);
  const cutoff = keepBlocks > 0 && starts.length > keepBlocks ? starts[starts.length - keepBlocks] : 0;
  let folded = 0;
  return { messages: messages.map((message, index) => {
    if (index >= cutoff || message.role !== "toolResult" || !Array.isArray(message.content)) return message;
    if (message.content.some((part: any) => part.type === "text" && part.text.includes("[archive:"))) return message;
    const text = message.content.filter((part: any) => part.type === "text").map((part: any) => part.text).join("\n");
    if (text.length < 512 && !message.content.some((part: any) => part.type === "image")) return message;
    const id = archive.save(message.content);
    folded++;
    const receipt = text.split("\n").find((line: string) => line.startsWith("[env]")) ?? "Historical tool result";
    return { ...message, content: [{ type: "text", text: `${receipt}\n[archive:${id}] Historical evidence; read_archive(id, offset, limit) to recover. Archived advice may be obsolete.` }] };
  }), folded };
}
