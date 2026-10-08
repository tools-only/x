"""Startup switch diagnostics; no ARC/provider performance claim."""
import json

import pytest

from autoresearch_pi import arc_agi_3_e2e as runner, cli


@pytest.mark.parametrize("environment,explicit,expected,source", [
    ({}, None, False, "arc_default"),
    ({"PI_ARC_AUTO_RESEARCH": "enabled"}, None, True, "PI_ARC_AUTO_RESEARCH"),
    ({"PI_ARC_AUTO_RESEARCH": "disabled"}, None, False, "PI_ARC_AUTO_RESEARCH"),
    ({"PI_AUTORESEARCH_ENABLED": "disabled", "PI_ARC_AUTO_RESEARCH": "enabled"}, None, False, "PI_AUTORESEARCH_ENABLED"),
    ({"PI_AUTORESEARCH_ENABLED": "enabled", "PI_ARC_AUTO_RESEARCH": "disabled"}, None, True, "PI_AUTORESEARCH_ENABLED"),
    ({"PI_AUTORESEARCH_ENABLED": "disabled"}, True, True, "explicit"),
    ({"PI_AUTORESEARCH_ENABLED": "enabled"}, False, False, "explicit"),
    ({"PI_AUTORESEARCH_ENABLED": "typo"}, False, False, "explicit"),
])
def test_config_precedence(environment, explicit, expected, source):
    assert runner._resolve_auto_research(environment, explicit) == (expected, source)


@pytest.mark.parametrize("key", ["PI_AUTORESEARCH_ENABLED", "PI_ARC_AUTO_RESEARCH"])
@pytest.mark.parametrize("value", ["", "enabld", "0", "true"])
def test_invalid_effective_environment_fails_before_launch(tmp_path, monkeypatch, key, value):
    monkeypatch.setattr(runner, "load_project_dotenv", lambda _: {key: value})
    root = tmp_path / "run"
    with pytest.raises(ValueError, match=key):
        runner.run_arc_agi_3_e2e(root, arc_root=tmp_path, game="test")
    assert not root.exists()


def test_probe_default_and_conflict_and_control():
    assert runner._resolve_auto_research({}, validation=True) == (True, "validation_probe")
    for environment, explicit in [({}, False), ({"PI_ARC_AUTO_RESEARCH": "disabled"}, None)]:
        with pytest.raises(ValueError, match="validation requires"):
            runner._resolve_auto_research(environment, explicit, validation=True)
    assert runner._resolve_auto_research({}, True, variant="control") == (False, "control_variant")
    with pytest.raises(ValueError, match="bool"):
        runner._resolve_auto_research({}, "disabled")


@pytest.mark.parametrize("flag,enabled", [("--auto-research", True), ("--no-auto-research", False)])
def test_cli_routes_switch(tmp_path, monkeypatch, flag, enabled):
    seen = []
    def capture(root, **kwargs):
        seen.append(kwargs)
        root.mkdir()
        summary = root / "summary.json"
        summary.write_text('{"passed":true}', encoding="utf-8")
        return summary
    monkeypatch.setattr(cli, "run_arc_agi_3_e2e", capture)
    assert cli.main(["arc-agi-3-e2e", "--root", str(tmp_path / "run"), flag]) == 0
    assert seen[0]["auto_research_enabled"] is enabled


def test_cli_switches_are_mutually_exclusive():
    with pytest.raises(SystemExit) as caught:
        cli.main(["arc-agi-3-e2e", "--auto-research", "--no-auto-research"])
    assert caught.value.code == 2


@pytest.mark.parametrize("enabled", [True, False])
@pytest.mark.parametrize("concise", [True, False])
def test_launch_environment_prompt_and_config_agree(tmp_path, monkeypatch, enabled, concise):
    monkeypatch.setattr(runner, "_resolve_pi_cli", lambda: ("node", "cli.js"))
    monkeypatch.setattr(runner, "load_project_dotenv", lambda _: {"PI_ARC_AUTO_RESEARCH": "enabled"})
    seen = {}
    class EndDiagnostic(Exception):
        pass
    class Kernel:
        def __init__(self, *args, **kwargs): seen["env"] = kwargs["env"]
        def __enter__(self): return self
        def __exit__(self, *args): pass
        def send(self, *args, **kwargs): return {"success": True}
        def prompt(self, message):
            seen["prompt"] = message
            raise EndDiagnostic
    monkeypatch.setattr(runner, "PiKernel", Kernel)
    with pytest.raises(EndDiagnostic):
        runner._run_pi(tmp_path, bridge_url="http://test", game="test", variant="treatment",
                       context_compaction=False, provider_extension=tmp_path / "provider.ts",
                       auto_research_enabled=enabled,
                       environment_overrides={"PI_ARC_CONCISE_GUIDANCE": "enabled" if concise else "disabled"})
    assert seen["env"]["PI_AUTORESEARCH_ENABLED"] == ("enabled" if enabled else "disabled")
    assert ("Auto-Research" in seen["prompt"]) is enabled
    assert "{{" not in seen["prompt"]
    config = json.loads((tmp_path / "arc-runtime-config.json").read_text(encoding="utf-8"))
    assert config["auto_research_enabled"] is enabled
    assert config["auto_research_configuration_source"] == "explicit"


@pytest.mark.parametrize("name", ["arc_length_recovery.md", "arc_recovery_followup.md", "arc_followup.md", "arc_action_boundary_recovery.md"])
def test_disabled_recovery_does_not_offer_research(name):
    prompt = runner._load_prompt(name, research_enabled=False, research_notice="")
    assert "auto_research" not in prompt and "Auto-Research" not in prompt
    assert "bounded research" not in prompt
    assert "#auto_research" not in prompt
    assert "arc_action" in prompt
