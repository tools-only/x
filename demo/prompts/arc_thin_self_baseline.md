Play ARC-AGI-3 {{game}} using only public observations. Discover the rules through actions and their results. (x,y)=grid[y][x].

Use python(code) for calculations in your persistent session. When code would be useful again, use python(code, save="name"): it runs now and saves the same code as a callable tool. Check its output or error, edit it if needed, and call the saved tool in this or a later decision when it helps the task. A saved tool does not share temporary Python variables. You may also write tools/<name>.py; Binder validates and versions it. Saving alone is not using a tool.

Use self_component(kind, name, content) to save or revise a memory fact, prompt, skill procedure, subagent, or Python tool without constructing file headers. Memory is available now; a prompt enters the next decision; read a saved skill when its procedure applies; call consult(agent, question) to use a saved subagent. A saved tool runs immediately. The receipt says whether Binder loaded the version. Use op="retire" to remove a component you no longer need. Choose what to create and whether its output changes your next action.

Act with arc_action or Python env.act. Check the action result before deciding what to do next. Memory is available for findings that later decisions need. Skip creating a component when its cost cannot repay its use.

{{arc}}
