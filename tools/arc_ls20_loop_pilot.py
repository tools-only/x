"""Freeze a committed source tree and run one real ARC pilot (yibu, model PILOT_MODEL (default qwen3.8-27b), thinking
PILOT_THINKING (default high), text+image, the observation ARC_THIN_OBSERVATION names (the runner's default ch)) on ls20
or the game PILOT_GAME names. Budgets come from
argv; 0 turns a limit off, so an uncapped round is `pilot.py <label> 0 0 0`. The in-run refinements use the same model
(the extension calls the session's model).

Further arguments KEY=VALUE are the round's comparison variables (ARC_THIN_* / ARC_REFINE_* environment), recorded in
protocol.json. FORK=<snapshot dir> starts from another run's snapshot, SNAPSHOT=<k>[,<k>] snapshots this one after those
decisions, and MAXDEC=<n> stops after n decisions (a source run that only has to produce a snapshot). SNAPLEVEL=<l>[,<l>]
snapshots after the decision that completed those levels, and MAXLEVEL=<l> stops once l levels are completed (a source
for forks from a level's start).

Route: a native run takes OpenAI Responses, which is what carries the decision's reasoning in the stored response and
lets a later query of the same decision continue from its ID (ARC_THIN_RESPONSES_CONTINUATION=1,
ARC_THIN_REASONING_MODE=fields, both set by the runner from the route). Declaring a thinking dialect
(PILOT_THINKING_FORMAT: qwen sends enable_thinking, openai sends reasoning_effort) keeps the project's Completions route.
Plan: docs/plans/2026-10-14-python-kernel.md."""
from pathlib import Path
import json, os, shutil, subprocess, sys, traceback

BASE = Path(os.environ.get('PILOT_OUT') or Path(__file__).resolve().parent)
SOURCE = Path(os.environ.get('PILOT_SOURCE') or 'D:/autoresearch_pi_project/demo/.claude/worktrees/kernel-20261014')
GAME = os.environ.get('PILOT_GAME') or 'ls20'
MODEL = os.environ.get('PILOT_MODEL') or 'qwen3.8-27b'
LABEL = sys.argv[1]
ACTIONS = int(sys.argv[2]) if len(sys.argv) > 2 else 10
# 0 actions: no run cap; the environment's own per-level action budget applies.
ACTIONS = ACTIONS or None
# 0 turns a limit off: no token cap (None), no run deadline (the runner reads 0 as none).
TOKENS = int(sys.argv[3]) if len(sys.argv) > 3 else 100000
TOKENS = TOKENS or None
SECONDS = int(sys.argv[4]) if len(sys.argv) > 4 else 600
VARIABLES = dict(arg.split('=', 1) for arg in sys.argv[5:])
FORK = VARIABLES.pop('FORK', None)
SNAPSHOTS = tuple(int(k) for k in VARIABLES.pop('SNAPSHOT', '').split(',') if k)
MAXDEC = int(VARIABLES.pop('MAXDEC')) if 'MAXDEC' in VARIABLES else None
SNAPLEVELS = tuple(int(level) for level in VARIABLES.pop('SNAPLEVEL', '').split(',') if level)
MAXLEVEL = int(VARIABLES.pop('MAXLEVEL')) if 'MAXLEVEL' in VARIABLES else None
assert all(key.startswith(('ARC_THIN_', 'ARC_REFINE_')) for key in VARIABLES), VARIABLES
os.environ.update(VARIABLES)
# Completions-only A/B arm: a declared dialect pins openai-completions, so it stays out of the Responses baseline.
THINKING_FORMAT = os.environ.get('PILOT_THINKING_FORMAT') or None
PI_API = os.environ.get('PILOT_PI_API') or None
# The thinking level (default high). "off" reaches qwen only with a dialect that encodes it (PILOT_THINKING_FORMAT=qwen
# sends enable_thinking=false on Completions); check reasoning tokens in harness/usage.jsonl before trusting the label.
THINKING = os.environ.get('PILOT_THINKING') or 'high'
OUT = BASE / LABEL
SNAPSHOT = OUT / 'runtime'
assert not OUT.exists(), 'A pilot is immutable; choose a fresh label'
status = subprocess.check_output(['git', 'status', '--porcelain', '--', 'src', 'demo', 'tools'], cwd=SOURCE, text=True)
assert not status.strip(), 'commit the source first:\n' + status
assert (SOURCE / 'node_modules/@earendil-works/pi-coding-agent/dist/cli.js').is_file(), \
    'the source has no node_modules with Pi; link the project one there first'
SNAPSHOT.mkdir(parents=True)
for name in ('src', 'demo', 'tools'):
    shutil.copytree(SOURCE / name, SNAPSHOT / name, ignore=shutil.ignore_patterns('__pycache__', '*.pyc'))
for name in ('package.json', 'package-lock.json', 'pyproject.toml'):
    shutil.copy2(SOURCE / name, SNAPSHOT / name)
subprocess.run(['cmd', '/c', 'mklink', '/J', str(SNAPSHOT / 'node_modules'), str(SOURCE / 'node_modules')], check=True, capture_output=True)
# Parse the extensions before the bridge and the kernel start. Pi reports a syntax error only once its RPC process is
# already up ("Pi RPC process exited before responding"), which cost ls20-r03 a snapshot and a run label for a
# duplicated line; this names the file and position instead. Node's strip-only TypeScript rejects constructs Pi's
# loader accepts (a parameter property in arc_thin_binder.ts), so only a plain SyntaxError counts as a failure.
EXTENSIONS = sorted((SNAPSHOT / 'demo').glob('arc_*.ts')) + sorted((SNAPSHOT / 'tools').glob('arc_*.ts'))
parse = subprocess.run(['node', '--experimental-strip-types', '--input-type=module', '-e',
    'const bad = [];\n'
    'for (const path of process.argv.slice(1)) {\n'
    '  try { await import("file:///" + path.replaceAll("\\\\", "/")); }\n'
    '  catch (error) {\n'
    '    if (error instanceof SyntaxError && error.code !== "ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX")\n'
    '      bad.push(path + ": " + error.message);\n'
    '  }\n'
    '}\n'
    'if (bad.length) { console.error(bad.join("\\n")); process.exit(1); }',
    *(str(path) for path in EXTENSIONS)], capture_output=True, text=True)
assert parse.returncode == 0, 'an extension does not parse:\n' + (parse.stderr or parse.stdout)
protocol = dict(source=str(SOURCE), commit=subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=SOURCE, text=True).strip(),
    branch=subprocess.check_output(['git', 'branch', '--show-current'], cwd=SOURCE, text=True).strip(), game=GAME,
    provider='yibu', model=MODEL, thinking=THINKING, input_modalities='text,image',
    observation=os.environ.get('ARC_THIN_OBSERVATION') or 'ch',
    pi_api=PI_API or ('project setting, kept by the declared thinking dialect (route: arc-run/run-config.json)'
        if THINKING_FORMAT else 'openai-responses (native default)'), thinking_format=THINKING_FORMAT,
    python_kernel=os.environ.get('ARC_THIN_PYTHON_KERNEL', '1') != '0', session_view=os.environ.get('ARC_THIN_SESSION_VIEW', '1') != '0',
    variables=VARIABLES, fork_from=FORK, snapshot_after_decisions=list(SNAPSHOTS), max_decisions=MAXDEC,
    snapshot_at_levels=list(SNAPLEVELS), max_levels=MAXLEVEL,
    max_reported_tokens=TOKENS, token_cap_measure='uncached_input+output',
    experiment_timeout_seconds=SECONDS, max_actions=ACTIONS,
    compared_with=[c for c in (os.environ.get('PILOT_COMPARED_WITH') or '').split(',') if c]
        or ['runs/arc-continuity-claude-20261014/cont-01', 'runs/arc-continuity-claude-20261014/cont-01r'],
    claim=os.environ.get('PILOT_CLAIM') or (f'{GAME} on the Responses baseline (stored continuation within a decision, '
        'short <carry> fields replayed instead of reasoning prose): levels completed against tokens and actions, and '
        'which non-memory harness components the agent converts or uses; one run, not a causal trial'))
(OUT / 'protocol.json').write_text(json.dumps(protocol, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
sys.path.insert(0, str(SNAPSHOT / 'src'))
from autoresearch_pi.project import load_project_dotenv
from autoresearch_pi import arc_thin_e2e as runner
from autoresearch_pi.pi_kernel import PiKernel
os.environ.update(load_project_dotenv(Path('D:/autoresearch_pi_project')))
os.environ.pop('ARC_MODEL_MAX_OUTPUT_TOKENS', None)
os.environ['PI_AUTORESEARCH_PI_CLI'] = str(SNAPSHOT / 'node_modules/@earendil-works/pi-coding-agent/dist/cli.js')

class AuditKernel(PiKernel):
    def start(self):
        audit = str(SNAPSHOT / 'tools/arc_foundation_runtime_audit.ts')
        if audit not in self.command:
            self.command = (*self.command, '--extension', audit)
        return super().start()
runner.PiKernel = AuditKernel
print(json.dumps({'pilot': LABEL, 'game': GAME, 'model': MODEL, 'snapshot': str(SNAPSHOT)}), flush=True)
try:
    result = runner.run_arc_thin_e2e(OUT / 'arc-run', arc_root=Path('D:/arc-agi-benchmark/arc-agi-3-benchmarking'),
        game=GAME, foundation='native', variant='treatment', max_actions=ACTIONS, max_decisions=MAXDEC,
        max_reported_tokens=TOKENS, experiment_timeout_seconds=SECONDS, decision_timeout_seconds=0, turn_idle_timeout_seconds=0,
        max_no_action_decisions=float('inf'), pi_provider='yibu', pi_model=MODEL, thinking=THINKING,
        pi_api=PI_API, thinking_format=THINKING_FORMAT, input_modalities='text,image',
        ledger=True, critic=True, replay_reasoning=False,
        **({'fork_from': Path(FORK)} if FORK else {}), **({'snapshot_after_decisions': SNAPSHOTS} if SNAPSHOTS else {}),
        **({'snapshot_at_levels': SNAPLEVELS} if SNAPLEVELS else {}), **({'max_levels': MAXLEVEL} if MAXLEVEL is not None else {}))
    print(str(result), flush=True)
except BaseException:
    traceback.print_exc()
    raise
