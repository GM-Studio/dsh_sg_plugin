---
name: sg-codex
description: Use when inspecting the SpecGate Codex adapter, checking its MCP connection, or determining whether its native SG workflow is available.
---

# SpecGate Codex adapter

This package currently implements P0 diagnostics only. Call the packaged MCP
`health`, `version`, and `status` tools to inspect the installed adapter. These
tools take no arguments and do not change project files. A healthy MCP connection
does not mean a Java/Vue project has been generated, built or verified.

The Codex `sg-init`, `sg-verify`, and `sg-change --add` workflow is not available
yet. Report that boundary when requested. Do not replace it with the DSH tools,
write authoritative state from conversation text, or accept model-supplied
approval flags. A missing trusted approval channel must leave gates closed.

The planned responsibilities are:

- Requirements: clarify at most three rounds of five questions; record unresolved
  blockers and assumptions.
- Critique: cite requirements when identifying ambiguity, contradictions and risks.
- Planning: map AC to tasks; freeze contracts before frontend/backend concurrency.
- Test design: freeze executable tests before implementation and preserve hashes.
- Development: frontend and backend each use their own worktree; neither edits
  frozen tests.
- Testing: run frozen tests with real command evidence; do not edit production code.
- Review: inspect a fixed commit read-only and report evidence for findings.
- Verification: mark unexecuted checks `not-run`; never equate generation with success.
- Archive: require H3 bound to current artifacts and preview; never force push or
  automatically retry a failed push.

Skills describe responsibilities. Only the future MCP state kernel may own state,
gate decisions, immutable snapshots and audit events. Hooks are not a substitute
for that kernel. Host-provided subagents and trusted user interaction need separate
integration validation before these responsibilities can execute automatically.
