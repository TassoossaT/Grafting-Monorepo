# Shared agent state

Task coordination is handled entirely by `tools/ia-graft` (see
`.ai/coordination/PROTOCOL.md`): a task is a Git worktree + branch, not a
file here. This directory is deliberately empty of task/handoff records.

No secret, credential, private prompt, transcript, or generated build output
belongs here.
