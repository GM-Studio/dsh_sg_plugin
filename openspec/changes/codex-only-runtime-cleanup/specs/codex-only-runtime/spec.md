# Codex-only Runtime

## ADDED Requirements

### Requirement: Codex-owned Runtime Dependencies

The Codex plugin runtime MUST resolve all implementation dependencies below
`src/codex/` and MUST NOT import files from version-named v3 or v4 directories.

#### Scenario: Load packaged server

- GIVEN the source checkout contains only Codex runtime files
- WHEN the packaged MCP server starts
- THEN all relative imports resolve and diagnostic tools remain available

### Requirement: Removal of Legacy Entry Points

The `sg-codex` branch MUST NOT expose DSH v3/v4 commands, tools, guards or
package exports.

#### Scenario: Inspect package surface

- GIVEN the Codex-only package is inspected
- WHEN its package exports, files and root entry points are listed
- THEN no DSH loader, Cordis patch or version-named runtime directory is present

### Requirement: Preserved Codex Workflow

Cleaning the runtime MUST preserve initialization, change delivery, real
verification, Agent worktrees, quality, formatting, Review, H3 and release
failure semantics.

#### Scenario: Initialize and verify a project

- GIVEN the cleaned plugin source
- WHEN a temporary empty project is initialized and verified through the Codex
  service
- THEN the generated Java/Vue baseline and verification evidence are produced
  exactly as before
