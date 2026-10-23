# Codex / SpecGate User Entry Points and In-Session Environment Preparation

Status: core implementation and dual-platform command checks passed; native
Codex session and release acceptance pending.

The aligned requirements document is
`docs/requirements/2026-10-23-codex-one-click-environment-bootstrap.zh.md`.

## Why

SpecGate's Codex, Java, Vue and React workflows depend on a consistent Git,
Node/npm, Codex CLI, multi-JDK and Maven environment. Manual setup is fragile,
especially on domestic networks, and a successful download does not prove that
the resulting workflow can actually build or run.

## What Changes

- Provide four task Skills: `$sg-codex-env`, `$sg-codex-project`,
  `$sg-codex-change` and `$sg-codex-status`, with `$sg-codex` as the shared router.
- Route environment preparation through `$sg-codex-env`: identify the project
  and stack, preflight, reuse, show missing components, install, verify and gate.
- Keep `$sg-codex-setup` as a compatibility alias for environment/project
  preparation; share orchestration rather than duplicating the old flow.
- Make status strictly read-only and aggregate project, environment, baseline,
  task, approval and delivery information with actionable next steps.
- Keep pause/resume/cancel and acceptance/delivery under the change entry,
  diagnosis under environment preparation and help under the router.
- Perform all environment recovery inside the Codex session, including missing
  MCP runtime recovery coordinated by a loaded Skill before reconnecting MCP.
- Support Git, Node/npm, Codex CLI, JDK 8/17/21, Maven 3.9.x and base utilities,
  installing only the current workflow's missing subset. Reuse the active host;
  install a separate CLI only when the selected workflow requires it.
- Install source dependencies only for source-based setup and verify the plugin path or its
  explicit project MCP + Skill degradation path.
- Use process-scoped domestic mirrors by default without permanently changing
  the user's global npm or Maven configuration.
- Pin downloadable versions, verify archive integrity, support safe reruns and
  clean owned temporary data after success and failure.
- Produce truthful structured evidence and require real Windows plus VMware
  Ubuntu acceptance before the change is described as dual-platform verified.

## Impacted Capabilities

- In-session environment inspection, first-run preparation and recovery.
- Public Skills, onboarding metadata, generated project Skill copies and docs.
- Project initialization/adoption, task control and read-only status aggregation.
- Java, Maven and Node toolchain discovery.
- Codex host and SpecGate plugin readiness checks.
- Project-scoped workflow gating and rechecks after environment or stack changes.
- Domestic mirror and download-integrity handling.
- Temporary workspace lifecycle and verification evidence.
- Windows/Linux installation documentation.

## Non-Goals

- Gradle, pnpm, Yarn, Docker, databases, browsers or IDE installation.
- Codex Desktop installation or Codex authentication automation.
- macOS, WSL or container acceptance.
- Silent global environment replacement or permanent global mirror changes.
- Claiming support evidence for an operating system that was not actually run.
- Installing every supported JDK by default for an individual project.
- External installation scripts, PowerShell/Bash setup entry points and a
  separate complete-toolchain installation mode.
- A second slash-command implementation or a new authoritative state store.
