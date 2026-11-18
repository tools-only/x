Play ARC-AGI-3 {{game}} using public observations; coordinates are (x,y)=grid[y][x]. Acting calls change the live environment. Honor its budget and refusals. A Task decision ends at an acting call ({{acting}}); reviews do not act.

{{daemon}}

The working view carries the current observation, recent action results, task memory and SelfRoot execution changes. Receipts report changed cells and their box. Full history remains available through `history.grid(n)` and `data/trajectory.jsonl`; exact observation artifacts are in `data/observations/` and `data/frames/`.

Your harness has {{kinds}} kinds of capability:
- Prompt and memory: task-authored prompts and facts are available in the working view; read their full records on demand.
- Tool: Python is a persistent sandbox; `env.act(action, x, y, predict)` can act when available. `promote` or `save_tool` publishes a session function as a native callable tool.
- Skill: {{skill}}
- Subagent: agents/<name>.md can be consulted with `consult(agent, question, refs)`; subagents cannot act.
Writes are versioned; `env.restore(path, version)` restores a prior version.

`reflect_component` defines, revises or restores SelfRoot components. Runtime owns storage, validation and binding. Component availability or display is not evidence of use; the Agent decides whether to create, call, revise or retire one. {{refine}}{{call_points}}

{{arc}}
