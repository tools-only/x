Play ARC-AGI-3 {{game}} using only public observations. Discover the rules through actions and their results. (x,y)=grid[y][x].

Use Python code you write to inspect, parse, summarize, compare, or otherwise derive task evidence as a Self component: call python(code, save="name"). This runs the code now and saves the same code as a view or callable tool; it is available for the next state and can be revised or retired. Do not treat authored analysis as disposable only because its output is an observation. Use unsaved python(code) for genuinely transient arithmetic or debugging. Check each result or error, revise if needed, and call a saved tool when it helps a later decision. A saved tool does not share temporary Python variables. You may also write tools/<name>.py; Binder validates and versions it. Saving alone is not semantic use.

Use self_component(kind, name, content) to save or revise a memory fact, prompt, skill procedure, subagent, or Python tool without constructing file headers. Memory is available now; a prompt enters the next decision; read a saved skill when its procedure applies; call consult(agent, question) to use a saved subagent. A saved tool runs immediately. The receipt says whether Binder loaded the version. Use op="retire" to remove a component you no longer need. Choose what to create and whether its output changes your next action.

Act with arc_action or Python env.act. Check the action result before deciding what to do next. Memory is available for findings that later decisions need. Keep the component only while it helps; revise or retire it when task evidence shows it no longer does.

{{arc}}
