import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { LayeredArchive, foldRecoverably } from "../demo/arc_layered_archive.ts";

test("recoverable folding preserves call pairs and exact text/images under stable handles", () => {
  const archive = new LayeredArchive(mkdtempSync(join(tmpdir(), "archive-")));
  const content = [{ type: "text", text: "evidence".repeat(100) + "\n[env] executed 1" }, { type: "image", data: "original", mimeType: "image/png" }];
  const messages = [{ role: "user", content: "old" }, { role: "assistant", content: [{ type: "toolCall", id: "c", name: "python" }] },
    { role: "toolResult", toolCallId: "c", content }, { role: "user", content: "current" }];
  const result = foldRecoverably(messages, 1, archive);
  assert.equal(result.folded, 1);
  assert.equal(result.messages[1], messages[1]);
  assert.equal(result.messages[2].toolCallId, "c");
  const id = /\[archive:([a-f0-9]+)\]/.exec(result.messages[2].content[0].text)![1];
  assert.deepEqual(JSON.parse(archive.read(id).text), content);
  assert.equal(archive.save(content), id);
  assert.equal(foldRecoverably(result.messages, 1, archive).folded, 0);
  assert.equal(foldRecoverably(messages, 0, archive).folded, 0);
  assert.equal(messages[2].content, content);
});

test("archive reads paginate, reject invalid references and detect modified evidence", () => {
  const root = mkdtempSync(join(tmpdir(), "archive-"));
  const archive = new LayeredArchive(root), id = archive.save(["abcdef"]);
  const first = archive.read(id, 0, 4), second = archive.read(id, 4, 100);
  assert.equal(first.text + second.text, JSON.stringify(["abcdef"]));
  assert.equal(first.next_offset, 4);
  assert.equal(second.next_offset, null);
  assert.throws(() => archive.read("../secret"), /invalid archive/);
  assert.throws(() => archive.read(id, -1), /offset/);
  writeFileSync(join(root, `${id}.json`), "changed");
  assert.throws(() => archive.read(id), /integrity/);
});
