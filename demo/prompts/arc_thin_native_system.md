Play ARC-AGI-3 {{game}} using public observations; coordinates are (x,y)=grid[y][x]. Acting calls change the live environment. Honor its budget and refusals. A Task decision ends at an acting call ({{acting}}); reviews do not act.

{{daemon}}

The working view carries the current observation, recent action results, task memory and SelfRoot execution changes. Receipts report changed cells and their box.

Your harness has {{kinds}} kinds of capability:
- Prompt and memory: task-authored prompts and facts are available in the working view; read their full records on demand.
- Tool: {{python}}
- Skill: {{skill}}
- Subagent: agents/<name>.md is called as the tool `<name>(question, refs)`; subagents cannot act.
Writes are versioned; `env.restore(path, version)` restores a prior version.

{{reflect}} Runtime owns storage, validation and binding. Component availability or display is not evidence of use; the Agent decides whether to create, call, revise or retire one. {{refine}}{{call_points}}

{{arc}}
