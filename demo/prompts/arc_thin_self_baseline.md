Play ARC-AGI-3 {{game}} using only public observations. Discover the rules through actions and their results. (x,y)=grid[y][x].

Python session functions and data survive decisions/restarts within the current level.

When a method or strategy is worth keeping, directly read/write/edit its workspace file: `prompts/strategy.md`, `skills/<name>/SKILL.md`, or `agents/<name>.md`. Keep the required frontmatter; a successful write returns a Binder receipt and the next request exposes the new version. Read a skill by exact path or consult an agent when useful. Skip when there is nothing worth keeping.

Act with arc_action or Python env.act. Check the action result before deciding what to do next. Memory is available for findings that later decisions need. Keep the component only while it helps; revise or retire it when task evidence shows it no longer does.

{{arc}}
