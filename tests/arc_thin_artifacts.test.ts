import assert from "node:assert/strict";
import { test } from "node:test";
import {
	MAX_ARTIFACT_CHARS, artifactHistory, artifactInputs, artifactsAt, newArtifactRecords, renderArtifacts, splitArtifacts, type ArtifactRecord,
} from "../demo/arc_thin_artifacts.ts";

const keep = (log: ArtifactRecord[], value: unknown, at: { n: number; level?: number; skill?: string; version?: number }) => {
	const split = splitArtifacts(value);
	const { records, errors } = newArtifactRecords(log, split.artifacts, { level: 0, skill: "board", version: 1, ...at });
	log.push(...records);
	return { shown: split.shown, records, errors: [...split.errors, ...errors] };
};

test("a skill result's artifacts are split off; what is shown names them", () => {
	const log: ArtifactRecord[] = [];
	const first = keep(log, { x: 2, artifacts: { map: [[1, 0], [0, 1]], route: ["ACTION4"] } }, { n: 3 });
	assert.deepEqual(first.shown, { x: 2, artifacts: ["map", "route"] });
	assert.deepEqual(first.records.map((r) => [r.name, r.n, r.skill, r.version]), [["map", 3, "board", 1], ["route", 3, "board", 1]]);
	// Results without artifacts are untouched (same object).
	const plain = { x: 1 };
	assert.equal(splitArtifacts(plain).shown, plain);
	assert.deepEqual(splitArtifacts([1, 2]).shown, [1, 2]);
});

test("an unchanged value is not stored again; a change, a new version or a new producer is", () => {
	const log: ArtifactRecord[] = [];
	keep(log, { artifacts: { map: [1] } }, { n: 1 });
	assert.equal(keep(log, { artifacts: { map: [1] } }, { n: 2 }).records.length, 0);
	assert.equal(keep(log, { artifacts: { map: [2] } }, { n: 3 }).records.length, 1);
	assert.equal(keep(log, { artifacts: { map: [2] } }, { n: 4, version: 2 }).records.length, 1);
	assert.deepEqual(artifactInputs(log).artifacts, { map: [2] });
	assert.deepEqual(artifactInputs(log).artifact_info, { map: { skill: "board", version: 2, n: 4, level: 0 } });
	// As of an earlier state: the latest value that had taken effect by then.
	assert.deepEqual(artifactInputs(log, 2).artifacts, { map: [1] });
	assert.deepEqual(artifactInputs(log, 0).artifacts, {});
	assert.deepEqual(artifactHistory(log), { map: [[1, [1]], [3, [2]], [4, [2]]] });
	assert.equal(artifactsAt(log).get("map")?.version, 2);
});

test("invalid names, oversized values and a non-dict artifacts field are reported, not stored", () => {
	const log: ArtifactRecord[] = [];
	const result = keep(log, { artifacts: { "bad name": 1, big: "x".repeat(MAX_ARTIFACT_CHARS + 10), ok: 1 } }, { n: 1 });
	assert.deepEqual(log.map((r) => r.name), ["ok"]);
	assert.equal(result.errors.length, 2);
	assert.match(result.errors.join(" "), /bad name.*not an identifier/);
	assert.match(result.errors.join(" "), /big has \d+ characters/);
	const notDict = keep(log, { artifacts: [1, 2] }, { n: 2 });
	assert.deepEqual(notDict.shown, { artifacts: "(not stored: not a dict)" });
	assert.match(notDict.errors[0], /must be a dict/);
});

test("the artifact list says who made each value, when, and whether the level or the producer moved on", () => {
	const log: ArtifactRecord[] = [];
	keep(log, { artifacts: { map: [[1]] } }, { n: 3, level: 0 });
	keep(log, { artifacts: { route: ["ACTION1"] } }, { n: 9, level: 1, skill: "planner" });
	const text = renderArtifacts(log, { n: 9, level: 1, skills: new Map([["board", { version: 2 }]]) });
	assert.match(text, /^ARTIFACTS \(/);
	assert.match(text, /- map: 5 chars, from board v1 on state #3 \(6 action\(s\) ago\) \[made on level 1; now level 2; board is now v2\]/);
	assert.match(text, /- route: 11 chars, from planner v1 on state #9 \(current\) \[planner was deleted\]/);
	assert.equal(renderArtifacts([], { n: 0, level: 0, skills: new Map() }), "");
});
