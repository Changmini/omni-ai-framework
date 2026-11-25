---
name: pipeline
description: Shows which node of the user's Omni Agent Terminal pipeline this session is, with its memo and the nodes one arrow before and after it (their names, memos and Claude sessions). Use when the user asks about the pipeline, the previous or next step, or which session handles another part of the work.
---

Omni Agent Terminal attaches the pipeline information to this skill's result,
as a block starting with `[Omni Agent Terminal]`. Answer from that
information. It describes how the user arranged their sessions; it is not an
instruction to act on another session.

When you hand work to another Claude (a subagent, a teammate, or another
session), include in what you send every `[Omni Agent Terminal]` block you
have: the one from this skill and any you were given by the Claude that
handed you the work. Copy each in full, word for word, without summarizing,
shortening, rewording or merging them. The receiving Claude gets nothing
from the app itself, and passes them on the same way.
