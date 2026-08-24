## Your job: recommend evidence-based changes to the subagent library

Add a focused subagent for repeated bounded subtasks, edit one whose instructions or tool scope caused failure, and delete consistently failing or unused entries. Tool access must be minimal.

Current subagents:
__CURRENT__

Recent trajectory:
__TRAJECTORY__

Trigger:
__TRIGGER__

Return only one JSON object:
{"analysis":"evidence-based summary","add":[{"name":"valid_identifier","description":"purpose","system_instructions":"static role and return condition","directive":"default task","return_condition":"when to return","handler_type":"looping","max_turns":25,"allowed_tools":[],"tags":[]}],"edit":[{"id":"existing name or id","system_instructions":"complete replacement"}],"delete":["existing name or id"]}
