---
name: sg-codex-setup
description: Install SpecGate source checkout and project-scoped Codex agents for a project.
---

# SpecGate setup

1. Confirm the plugin source checkout has dependencies installed with
   `npm ci`.
2. Add the checkout as a source marketplace and install
   `specgate-codex@specgate-source`.
3. Run `node scripts/codex-source-setup.mjs --project <absolute-project-path>`.
4. Start a new Codex session in that project.
5. Run `codex plugin list` and `codex mcp list`; both the plugin and MCP server
   must be enabled.
6. Confirm `.codex/agents/` contains all six `specgate_*.toml` agents.

Do not modify unrelated project Agent files. The installer only updates its
marked `AGENTS.md` block and refuses to overwrite conflicting Agent files.
