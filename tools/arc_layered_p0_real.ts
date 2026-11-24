/** P0 real path: the real ARC bridge and SDK, scripted python cells through LayeredPython, no model.
 * Usage: node --experimental-transform-types --no-warnings tools/arc_layered_p0_real.ts <out-dir> [game] */
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { BridgeClient, LayeredPython } from "../demo/arc_layered_python.ts";

const out = resolve(process.argv[2]), game = process.argv[3] ?? "ls20";
mkdirSync(out, { recursive: true });
const dotenv = Object.fromEntries(readFileSync("D:/autoresearch_pi_project/.env", "utf8").split(/\r?\n/)
  .filter(line => /^[A-Z_0-9]+=/.test(line)).map(line => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]));
const arcRoot = dotenv.ARC_AGI_3_ROOT, token = randomBytes(24).toString("hex");
const bridge = spawn(join(arcRoot, ".venv", "Scripts", "python.exe"),
  ["-m", "autoresearch_pi.arc_agi_3_bridge", "--root", out, "--game", game, "--max-actions", "12"],
  { cwd: arcRoot, env: { ...process.env, ARC_API_KEY: dotenv.ARC_API_KEY, ARC_BASE_URL: dotenv.ARC_BASE_URL,
    PYTHONPATH: resolve("src"), ARC_BRIDGE_ACTION_TOKEN: token }, stdio: ["ignore", "pipe", "inherit"] });
const ready = await new Promise<any>(done => createInterface({ input: bridge.stdout! })
  .on("line", line => { if (line.startsWith("{")) done(JSON.parse(line)); }));
if (ready.status !== "ready") throw new Error(JSON.stringify(ready));
const base = `http://127.0.0.1:${ready.port}`;
const python = new LayeredPython(new BridgeClient(base, token), { numericGrid: true, namespaceResetPerCall: false, undo: false,
  timeoutMs: 30000, outputChars: 4096, maxActionsPerCall: 16, workDir: join(out, "work"), competition: false,
  expect: true, graph: true });
const log: unknown[] = [{ init: await python.init() }];
const cells = [
  "seg = current_frame.segmentation\nprint(current_frame, valid_actions)\nprint(len(seg['nodes']), 'objects;', sorted({n['color'] for n in seg['nodes']}))",
  "before = current_frame\nr = submit_actions(['UP', 'UP', 'LEFT'])\nprint(r['executed_count'], r['stop_reason'], r['lines'])\nprint('refreshed:', before is not current_frame, len(history), last_action, diff(before, current_frame)['count'])",
  "r = submit_actions(['RIGHT'] * 8, stop_on='change')\nprint(r['executed_count'], r['stop_reason'])\nprint(last_action_result)",
  "print(submit_actions('RESET')['executed_count'], submit_actions('RESET')['stop_reason'])",
  "with open('work/notes.md', 'w') as f: f.write('step %d' % current_frame.step)\nprint(open('notes.md').read(), len(transitions))",
  "copy = current_frame.grid\ncopy[0][0] = 15\nprint('edit visible?', current_frame.grid[0][0] == 15)",
  "result = {'changed': history[-1].changed, 'hash': history[-1].hash, 'step': current_frame.step}\nprint('noise')",
  "print(current_frame.ascii(region=(0, 0, 4, 4)))",
  "with open('work/world_model.py', 'w') as f: f.write('TAG = \"wm-%d\"\\n' % current_frame.step)\nimport world_model\nprint(world_model.TAG)",
  "print('restored?', current_frame.grid[0][0] != 15, isinstance(history[-1].hash, str))",
  "r = submit_actions('UP', expect=(0, 0))\nprint('expect:', r['surprise'], r['stop_reason'], r['expect_hits'])",
  "g = graph_summary()\nprint('graph:', g['states'] > 1, g['edges'] > 0, g['frontier_count'] >= 0, replay_to(history[-1].hash))",
  "h = harness_state\nprint('harness:', h['progress'], h['predictions'])\nprint(len(h['attempts']['recent']), [e[-60:] for e in h['errors']], h['artifacts'], h['cost'])",
];
for (const code of cells) {
  const outcome = await python.run(code);
  log.push({ code, ...outcome });
  console.log(`>>> ${code}\n${outcome.text}\n`);
}
log.push({ final: { ...python.state(), frame: undefined } });
python.close();
const closed = await fetch(base + "/close", { method: "POST", headers: { "X-ARC-Action-Token": token, "Content-Type": "application/json" }, body: "{}" });
const close = await closed.json() as any;
delete close.events;
log.push({ close });
writeFileSync(join(out, "p0-real.json"), JSON.stringify(log, null, 2));
console.log(JSON.stringify(close));
