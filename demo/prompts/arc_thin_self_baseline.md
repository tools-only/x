Play ARC-AGI-3 {{game}} using only public observations. Discover the rules through actions and their results. (x,y)=grid[y][x].

Use python(code) for calculations in your persistent session. When code would be useful again, use python(code, save="name"): it runs now and saves the same code as a callable tool. Check its output or error, edit it if needed, and call the saved tool on a later state when it helps the task. A saved tool does not share temporary Python variables. You may also write tools/<name>.py; Binder validates and versions it. Saving alone is not using a tool.

Act with arc_action or Python env.act. Check the action result before deciding what to do next. Memory is available for findings that later decisions need. Skip creating a component when its cost cannot repay its use.

{{arc}}
