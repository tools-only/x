"""Bounded real-provider ARC capture; only the diagnostic task prompt is replaced.

The ordinary mode leaves the runner's gameplay prompt intact. This script mocks
neither model, SDK, bridge, Pi, broker, tools nor observations.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import os
import sys
from pathlib import Path

PROJECT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT / 'src'))
from autoresearch_pi import arc_agi_3_e2e as runner
from autoresearch_pi.project import load_project_dotenv
from autoresearch_pi.arc_agi_3_adapter import resolve_model_settings


def hashes():
    paths = [*PROJECT.glob('demo/*.ts'), *PROJECT.glob('demo/prompts/*.md'),
             *PROJECT.glob('src/autoresearch_pi/*.py'), *PROJECT.glob('demo/harness-methods/*/SKILL.md')]
    return {str(p.relative_to(PROJECT)): hashlib.sha256(p.read_bytes()).hexdigest() for p in paths}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', type=Path, required=True)
    parser.add_argument('--mode', choices=('diagnostic', 'ordinary'), required=True)
    parser.add_argument('--max-reported-tokens', type=int, default=150000)
    parser.add_argument('--diagnostic-prompt', type=Path)
    parser.add_argument('--max-actions', type=int, default=12)
    parser.add_argument('--experiment-timeout', type=int, default=300)
    args = parser.parse_args()
    if args.diagnostic_prompt and args.mode != 'diagnostic':
        raise ValueError('Custom diagnostic guidance cannot change ordinary gameplay')
    token_cap = 2000000 if args.mode == 'ordinary' else 150000
    if not 0 < args.max_reported_tokens <= token_cap:
        raise ValueError(f'Capture allowance must be within 1..{token_cap} reported tokens')
    if not 0 < args.max_actions <= 50 or not 0 < args.experiment_timeout <= 1800:
        raise ValueError('Capture must be within 1..50 actions and 1..1800 seconds')
    root = args.root.resolve()
    if root.exists() and any(root.iterdir()):
        raise ValueError('Use a new or empty capture directory')
    overrides = {'ARC_PI_THINKING_FORMAT': 'qwen', 'PI_AUTORESEARCH_PROVIDER_PROMPT_CAPTURE': 'all',
        'PI_PROVIDER_REPORTED_ADMISSION': 'enabled', 'PI_AUTORESEARCH_DELEGATE_MAX_RUNTIME_MS': '60000',
        'PI_AUTORESEARCH_DELEGATE_MAX_REPORTED_TOKENS': '40000'}
    # ARC model registry settings are resolved from process/.env before the
    # runner's Pi-only overrides are applied. Set the provider format here.
    os.environ['ARC_PI_THINKING_FORMAT'] = overrides['ARC_PI_THINKING_FORMAT']
    settings = resolve_model_settings({**load_project_dotenv(PROJECT), **overrides})
    protocol = {'mode': args.mode, 'guided': args.mode == 'diagnostic', 'model': settings['model'],
        'provider': 'yibu', 'provider_mocked': False, 'environment_mocked': False,
        'max_actions': args.max_actions, 'max_reported_tokens': args.max_reported_tokens,
        'experiment_timeout_seconds': args.experiment_timeout,
        'max_output_tokens': 4096, 'reasoning_policy': 'adaptive', 'reasoning_levels': ['off'],
        'auto_research_enabled': False, 'overrides': overrides, 'source_hashes_before': hashes(),
        'claim': 'Bounded direct-use capability/adoption capture; not a performance comparison.',
        'input_modalities': settings['input_modalities'],
        'launcher_sha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest()}
    prompt_path = args.diagnostic_prompt or PROJECT / 'tools/arc_direct_use_real_prompt.md'
    if args.mode == 'diagnostic':
        protocol['diagnostic_prompt'] = str(prompt_path.resolve())
        protocol['diagnostic_prompt_sha256'] = hashlib.sha256(prompt_path.read_bytes()).hexdigest()
    root.parent.mkdir(parents=True, exist_ok=True)
    protocol_path = root.parent / (root.name + '-protocol.json')
    protocol_path.write_text(json.dumps(protocol, ensure_ascii=False, indent=2), encoding='utf-8')
    original = runner._load_prompt
    if args.mode == 'diagnostic':
        prompt = prompt_path.read_text(encoding='utf-8')
        runner._load_prompt = lambda name, **kwargs: prompt if name == 'arc_harness_validation.md' else original(name, **kwargs)
    try:
        result = runner.run_arc_agi_3_e2e(root, arc_root=Path('D:/arc-agi-benchmark/arc-agi-3-benchmarking'),
            game='ft09', experiment_variant='treatment', max_actions=args.max_actions, auto_research_enabled=False,
            harness_validation=args.mode == 'diagnostic', experiment_timeout_seconds=args.experiment_timeout,
            max_reported_tokens=args.max_reported_tokens, max_output_tokens=4096, reasoning_policy='adaptive',
            reasoning_levels=('off',), pi_environment=overrides, review_mode='advisory')
        protocol['source_hashes_after'] = hashes()
        protocol['source_unchanged'] = protocol['source_hashes_before'] == protocol['source_hashes_after']
        (root / 'direct-use-protocol.json').write_text(json.dumps(protocol, ensure_ascii=False, indent=2), encoding='utf-8')
        print(json.dumps({'summary': str(result), 'mode': args.mode, 'source_unchanged': protocol['source_unchanged']}))
    finally:
        runner._load_prompt = original


if __name__ == '__main__':
    main()
