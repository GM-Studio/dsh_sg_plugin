# Proposal: repair session binding, onboarding and verification continuity

## Why

Codex can launch the portable plugin from its cache directory without exposing
an MCP root. That cache path was then treated as the business project. In the
same flow, the create-project form required an extra boolean confirmation,
current template revisions were compared with historical Golden hashes, and a
host-side tool projection could omit the standalone `sg_verify` tool. Together
these faults prevented a newly selected project from reaching a verified
ProjectBaseline.

## Scope

- Resolve a business project from an explicit binding, supported host
  environment, or MCP roots, but never from the plugin source/cache fallback.
- Keep the project-create flow form-first. Treat submission as confirmation,
  retain selections across environment failures, and reopen the form after a
  cancellation or unavailable form response.
- Distinguish the current template revision awaiting verification from a truly
  unknown/mismatched template.
- Keep `sg_verify` and expose the same operation as `sg_project_verify` so the
  project workflow remains callable when a host projects only project tools.
- Require complete, current verification evidence before finalizing a baseline.
- Bump the plugin version so hosts cannot reuse the faulty 0.3.2 cache.

## Non-goals

- Do not mark a template or generated project verified without real commands.
- Do not modify an installed plugin cache in place.
- Do not commit, push, or alter unrelated working-tree changes.
