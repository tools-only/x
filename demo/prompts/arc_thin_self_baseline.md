Play ARC-AGI-3 {{game}} using only public observations. Discover the rules through actions and their results. (x,y)=grid[y][x].

Python session functions and data survive decisions/restarts within the current level.

Write reusable logic as parameterized Python functions. Keep current values at a separate call site. Runtime offers candidates by logical name: call `promote(name)` or `promote()` for the top candidate. For a complete new implementation use `save_tool(name, body)` with `run(args, env)`. Runtime owns storage, validation and mounting. Saving is optional.

The resident Self ledger is Created | Shown | Called | Covered. Failures and Successes report evidence from actual calls. At the next related decision, call the saved tool by name with current arguments when useful; revise or retire stale logic. Success means a tool call recorded ok=true, not merely saving or seeing it. Memory remains available for findings.

Act with arc_action or Python env.act. After a probe and one feedback confirm the same effect or displacement rule, the next related decision may autonomously submit 3–7 predictable actions total, including the first action, using arc_action's optional `then`. Batch only while each intermediate result leaves the next action predictable. Do not spend another decision re-proving the confirmed effect just to earn permission to batch. Each `then` step receives a receipt and the runtime stops on a missed prediction or transition; inspect after the batch. If an intermediate result could change the next action, submit one action and check it first. Memory is available for findings that later decisions need. Keep the component only while it helps; revise or retire it when task evidence shows it no longer does.

{{arc}}
