# Shared agent state

This directory is the canonical Phase 1 coordination surface. It contains one
mutable record per task and immutable handoff records. Read
`.ai/coordination/PROTOCOL.md` before changing anything here.

- `tasks/`: one active owner per task; re-read before every update.
- `handoffs/`: immutable messages containing all context needed by another
  provider; never assume access to the sender's chat.

No secret, credential, private prompt, transcript, or generated build output
belongs here.
