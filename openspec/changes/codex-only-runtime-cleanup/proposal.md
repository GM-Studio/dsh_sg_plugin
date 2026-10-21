# Codex-only Runtime Cleanup

## Why

The `sg-codex` branch still carries DSH v3/v4 entry points, historical tests,
template evidence and assets that are not part of the Codex plugin runtime.
This makes the checkout larger, keeps obsolete compatibility paths visible and
allows imports to cross version-named implementation directories.

## What Changes

- Move every shared module still used by the Codex MCP server into a
  Codex-owned namespace.
- Remove the DSH root entry point and all unreachable v3/v4 code.
- Remove legacy tests, assets, documentation and release artifacts that do not
  participate in Codex plugin execution.
- Narrow the npm package to the Codex runtime, six Agent templates, setup
  scripts and the Java/Vue template that initialization actually reads.
- Keep the native init, verification, quality, formatting, Review and release
  behavior unchanged.

## Non-goals

- Rewrite Git history.
- Change user project files.
- Publish a release or alter the successful push to `origin/sg-codex`.
- Preserve DSH v3/v4 runtime compatibility on this branch.
