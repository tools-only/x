import json
from autoresearch_pi import cli
from autoresearch_pi.project import ProjectPaths


def test_foundation_cli_routes_native_defaults_and_explicit_legacy(monkeypatch, tmp_path):
    paths = ProjectPaths(tmp_path / 'project', tmp_path / 'jit', tmp_path / 'meta')
    monkeypatch.setattr(cli.ProjectPaths, 'from_environment', lambda: paths)
    seen = []
    def run(root, **kwargs):
        seen.append(kwargs)
        root.mkdir(parents=True)
        result = root / 'summary.json'
        result.write_text(json.dumps({'passed': True}), encoding='utf-8')
        return result
    monkeypatch.setattr(cli, 'run_arc_thin_e2e', run)
    assert cli.main(['arc-thin-e2e', '--root', str(tmp_path / 'native')]) == 0
    assert seen[-1]['foundation'] == 'native'
    assert seen[-1]['replay_reasoning'] is False
    assert seen[-1]['review_at_level_change'] is None
    assert cli.main(['arc-thin-e2e', '--root', str(tmp_path / 'legacy'), '--foundation', 'legacy', '--level-change-review', '--replay-reasoning']) == 0
    assert seen[-1]['foundation'] == 'legacy' and seen[-1]['review_at_level_change'] is True
