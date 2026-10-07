"""Ordinary opt-in simplification must not replace explicit closure probes."""
import pytest
from autoresearch_pi import arc_agi_3_e2e as runner


@pytest.mark.parametrize("enabled", [False, True])
@pytest.mark.parametrize("probe", [None, "harness_validation", "auto_research_validation"])
def test_initial_prompt_at_real_runner_launch_seam(tmp_path, monkeypatch, enabled, probe):
    monkeypatch.setattr(runner,"_resolve_pi_cli",lambda:("node","cli.js"))
    monkeypatch.setattr(runner,"load_project_dotenv",lambda _: {})
    seen=[]
    class EndDiagnostic(Exception):
        pass
    class Kernel:
        def __init__(self,*args,**kwargs):pass
        def __enter__(self):return self
        def __exit__(self,*args):pass
        def send(self,*args,**kwargs):return {"success":True}
        def prompt(self,message):
            seen.append(message)
            raise EndDiagnostic
    monkeypatch.setattr(runner,"PiKernel",Kernel)
    with pytest.raises(EndDiagnostic):
        runner._run_pi(tmp_path,bridge_url="http://test",game="test",variant="treatment",
            context_compaction=False,provider_extension=tmp_path/"provider.ts",
            environment_overrides={"PI_ARC_CONCISE_GUIDANCE":"enabled" if enabled else "disabled"},
            **({probe:True} if probe else {}))
    assert len(seen)==1
    if probe=="harness_validation":
        assert "closure probe" in seen[0]
    elif probe=="auto_research_validation":
        assert "five closure targets" in seen[0]
    else:
        prompt = seen[0]
        assert "available_actions" in prompt
        assert "Only ACTION6" in prompt and "integer coordinates" in prompt
        assert "other actions ignore x/y" in prompt
        assert "before/action/after" in prompt and "counterevidence" in prompt
        assert "task_checkpoint" in prompt
        assert "ordered tool batch" in prompt
        assert "material" in prompt and "automatically" in prompt
        assert "creator" in prompt and "assembly" in prompt and "trial" in prompt
        assert "Auto-Research" in prompt and "remaining task" in prompt
        assert "different visual region or color" not in prompt
        assert "Compare ALL repeated structures" not in prompt
        assert "relevant editable location" not in prompt
        assert "After choosing development, finish" not in prompt
        assert "selection={view_ref,candidate_id" not in prompt
