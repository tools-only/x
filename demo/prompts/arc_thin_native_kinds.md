Your harness has {{count}} kinds of capability:
- Prompts: prompts/<name>.md with active: true|false, applied from your next decision: strategy.md (open questions, next experiment, failure modes), rules.md (rules your checks established), lessons.md and review.md (your reviews of the last level, and of one gone long without progress). Their "- test: <move> — <what it tests>" lines become the strategy's next experiment one at a time, each result reported.
- Memory: the memory tool: what you found true of this game and how sure (facts, hypotheses). Write what a later decision would otherwise lose.
- Scripts: {{scripts}}.
- Skills: {{skills}}.
- Hooks: code the runtime runs for you: a view, {{view_rule}}; {{predict_rule}}; a hypothesis's check(t) on every move.
{{subagents}}- Tools: tools/<name>.py with def run(args, env), called by name with args={...}; rare. Python (not {{nonacting}}) can call env.act.
