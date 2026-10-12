"""One ordinary native ARC observation run, bounded by 100 actions. No substitutions."""
from __future__ import annotations
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
    return {str(p.relative_to(PROJECT)): hashlib.sha256(p.read_bytes()).hexdigest() for p in paths}


class AuditedKernel(PiKernel):
    def start(self):
        if self.process is None:
            self.command = (*self.command, '--extension', str(PROJECT / 'tools/arc_foundation_runtime_audit.ts'))
            config = Path(self.env['ARC_RUN_ROOT']) / 'run-config.json'
            data = json.loads(config.read_text(encoding='utf-8')); data['command'] = list(self.command)
            data['developer_audit'] = 'read-only provider input capture, no gameplay modifications'
            config.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        return super().start()


def main():
    root = Path(sys.argv[1]).resolve()
    if root.exists() and any(root.iterdir()):
        raise ValueError('Use a new or empty run directory')
    # Credentials stay in host process environment, outside the agent workspace and evidence files.
    os.environ.update(load_project_dotenv(Path('D:/autoresearch_pi_project')))
    protocol = dict(format='foundation-real-observation-v1', mode='ordinary', game='ls20', foundation='native',
        provider='yibu', model='qwen3.8-27b', provider_mocked=False, environment_mocked=False,
        source_commit=subprocess.check_output(['git','rev-parse','HEAD'],cwd=PROJECT,text=True).strip(),
        runtime_base_commit='d0a76641', source_hashes_before=source_hashes(),
        max_actions=100, max_decisions=None, max_reported_tokens=None, experiment_timeout_seconds=None,
        runner_timeout_argument=0, decision_timeout_seconds=900, turn_idle_timeout_seconds=180, max_output_tokens=None,
        thinking='high', thinking_format='qwen', input_modalities=['text'], ledger=True, critic=True,
        auto_research=False, auto_compaction=False, replay_reasoning=False, level_change_review=False,
        claim='Ordinary real ARC observation: native lifecycle, evidence delivery and continuity; no causal benefit claim.',
        guidance='Production ordinary gameplay only; no game solution or required component-creation probe.',
        budget_limit='User requested 100 actions with no experiment time, decision or total-token cap. Native environment rules, provider output capacity, tool bounds and request fault timeouts remain.',
        acceptance=['official actions and later real parent turns', 'ledger/critic configured and trigger/delivery evidence',
                    'workspace versions/receipts and semantic use if autonomously written',
                    'reasoning excluded from replay; only latest injected grid; exact results available',
                    'source integrity and total parent/critic/consult reported cost'],
        stop_rules='First runtime/secret/source-integrity defect: stop and preserve evidence; no automatic paid retry after analysis.')
    protocol_path = root.parent / (root.name + '-protocol.json')
    protocol_path.parent.mkdir(parents=True, exist_ok=True)
    protocol_path.write_text(json.dumps(protocol, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    runner.PiKernel = AuditedKernel
    try:
        result = runner.run_arc_thin_e2e(root, arc_root=Path('D:/arc-agi-benchmark/arc-agi-3-benchmarking'),
            game='ls20', foundation='native', max_actions=100, max_decisions=None, max_reported_tokens=None,
            experiment_timeout_seconds=0, decision_timeout_seconds=900, turn_idle_timeout_seconds=180,
            pi_provider='yibu', pi_model='qwen3.8-27b', thinking='high', thinking_format='qwen',
            input_modalities='text', ledger=True, critic=True,
            review_at_level_change=False, replay_reasoning=False, extension_env={'ARC_THIN_AUTO_COMPACTION':'0'})
        protocol['source_hashes_after'] = source_hashes()
        protocol['source_unchanged'] = protocol['source_hashes_before'] == protocol['source_hashes_after']
        (root / 'real-observation-protocol.json').write_text(json.dumps(protocol, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        data = json.loads(result.read_text(encoding='utf-8'))
        print(json.dumps({'summary':str(result), 'passed':data['passed'], 'stop_reason':data['stop_reason'],
            'source_unchanged':protocol['source_unchanged']}, ensure_ascii=False), flush=True)
    except BaseException:
        protocol['source_hashes_after'] = source_hashes()
        protocol['source_unchanged'] = protocol['source_hashes_before'] == protocol['source_hashes_after']
        protocol_path.write_text(json.dumps(protocol, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        raise


if __name__ == '__main__':
    main()
