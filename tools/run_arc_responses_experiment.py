"""Two bounded ordinary ARC arms; frozen source, exact wire capture, no gameplay guidance."""
from __future__ import annotations
import argparse
import hashlib
import json
import os
import subprocess
import sys
from pathlib import Path

PROJECT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT / 'src'))
from autoresearch_pi.project import load_project_dotenv
from autoresearch_pi import arc_thin_e2e as runner
from autoresearch_pi.pi_kernel import PiKernel


def source_hashes():
    paths = [*PROJECT.glob('demo/*.ts'), *PROJECT.glob('demo/*.py'), *PROJECT.glob('demo/prompts/*.md'),
             *PROJECT.glob('src/autoresearch_pi/*.py'), PROJECT / 'tools/arc_foundation_runtime_audit.ts', Path(__file__)]
    sdk = PROJECT / 'node_modules/@earendil-works'
    paths += list((sdk / 'pi-ai/dist').rglob('*.js')) + list((sdk / 'pi-coding-agent/dist').rglob('*.js'))
    return {str(p.relative_to(PROJECT)): hashlib.sha256(p.read_bytes()).hexdigest() for p in paths}


class AuditedKernel(PiKernel):
    def start(self):
        audit = str(PROJECT / 'tools/arc_foundation_runtime_audit.ts')
        if audit not in self.command:
            self.command = (*self.command, '--extension', audit)
        return super().start()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--api', choices=['openai-completions', 'openai-responses'], required=True)
    parser.add_argument('--root', type=Path, required=True)
    args = parser.parse_args()
    root = args.root.resolve()
    if root.exists():
        parser.error('Use a fresh run root')
    os.environ.update(load_project_dotenv(Path('D:/autoresearch_pi_project')))
    os.environ['ARC_PI_API'] = args.api
    os.environ.pop('ARC_PI_THINKING_FORMAT', None)
    os.environ['ARC_MODEL'] = 'qwen3.8-27b'
    before = source_hashes()
    protocol = dict(provider='yibu', model='qwen3.8-27b', api=args.api, thinking='high', game='ls20',
        provider_mocked=False, environment_mocked=False, max_actions=8, max_decisions=3,
        max_uncached_input_plus_output_tokens=100000, max_output_tokens=32768,
        experiment_timeout_seconds=540, decision_timeout_seconds=540, turn_idle_timeout_seconds=180,
        foundation='native', input_modalities=['text'], ledger=True, critic=True,
        decision_reasoning='all', observation='query', source_hashes_before=before,
        source_commit=subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=PROJECT, text=True).strip(),
        scope='Ordinary real ARC protocol/context diagnostic, no benchmark-improvement claim')
    protocol_path = root.parent / (root.name + '-protocol.json')
    protocol_path.parent.mkdir(parents=True, exist_ok=True)
    protocol_path.write_text(json.dumps(protocol, indent=2) + '\n', encoding='utf-8')
    runner.PiKernel = AuditedKernel
    try:
        result = runner.run_arc_thin_e2e(root, arc_root=Path('D:/arc-agi-benchmark/arc-agi-3-benchmarking'),
            game='ls20', foundation='native', max_actions=8, max_decisions=3, max_reported_tokens=100000,
            experiment_timeout_seconds=540, decision_timeout_seconds=540, turn_idle_timeout_seconds=180,
            pi_provider='yibu', pi_model='qwen3.8-27b', thinking='high', input_modalities='text',
            max_output_tokens=32768, ledger=True, critic=True, review_at_level_change=False,
            replay_reasoning=False, extension_env={'ARC_THIN_REASONING_MODE': 'all',
            'ARC_THIN_AUTO_COMPACTION': '1', 'ARC_THIN_RESPONSES_CONTINUATION': '1'})
        summary = json.loads(result.read_text(encoding='utf-8'))
        print(json.dumps({k: summary.get(k) for k in ['passed', 'stop_reason', 'decisions', 'reported_tokens', 'actions', 'levels_completed']}, ensure_ascii=False), flush=True)
    finally:
        after = source_hashes()
        protocol.update(source_hashes_after=after, source_unchanged=before == after)
        (root / 'responses-experiment-protocol.json').write_text(json.dumps(protocol, indent=2) + '\n', encoding='utf-8')
        if before != after:
            raise RuntimeError('Source/SDK drift; interpretation must be invalidated')


if __name__ == '__main__':
    main()
