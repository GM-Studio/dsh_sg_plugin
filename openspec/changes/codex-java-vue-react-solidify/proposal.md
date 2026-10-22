# Java/Vue+React Stack Solidify, Scaffold Baseline and Multi-Project Control

Status: approved for implementation (2026-10-22). The aligned requirements
document (`docs/requirements/2026-10-22-codex-java-vue-react-solidify.zh.md`)
was approved. Work proceeds on branch `sg-codex-stack-solidify` and merges back
to `sg-codex` only after acceptance.

## Why

SpecGate today generates a single Vue starter, keeps one control plane bound to
one project, and does not require a host Codex capability check. A solo builder
taking small and medium commercial Java projects needs three things the current
runtime does not guarantee:

- a selectable, enforced stack (JDK major and Vue or React) instead of a single
  fixed frontend;
- an initialization output that is a complete, runnable management-system
  scaffold usable as the style and implementation reference for later changes;
- a control plane that can aggregate several client projects, isolate them when
  needed, and run on whichever Codex build is actually available.

Verification today is also Windows-first; a template combination is not trusted
until it passes on both Windows and Linux.

## What Changes

- Add interactive stack selection for JDK major (8/17/21) and frontend framework
  (Vue 3 / React 18) during initialization, recorded in `ProjectProfile` and
  enforced by the change workflow.
- Add a React 18 scaffold (Vite + TypeScript + React Router + Zustand +
  Ant Design + react-i18next + Vitest/RTL) that is functionally aligned with the
  existing Vue scaffold: same backend contract, menu, and i18n keys.
- Turn the generated starter into a complete, domain-neutral management-system
  scaffold (users, roles, departments, menus, permissions, audit log,
  pagination, import/export, dashboard) across backend and frontend, kept
  runnable and verifiable.
- Ship a separate style guide alongside the scaffold and make it an enforceable
  review baseline: the Reviewer may raise blocking findings on unjustified
  deviation.
- Add a multi-project project registry with an aggregate console (cross-project
  attention and queue, global concurrency limit) and an isolated mode
  (per-project control home and port) with a switching command.
- Persist Web sessions and pairing across control-plane restarts.
- Add host capability detection (`plugin`, `exec --json`, native subagents,
  elicitation) with a defined degradation path to the project-level MCP + skill
  route, plus a version gate hint, so behavior is never silently wrong.
- Require dual-platform golden verification (Windows + Linux, Ubuntu 24.04 LTS
  VM, WSL not accepted) before a stack combination is marked verified.
- Wire incremental delivery impact analysis (`createIncrementalPlan`) into the
  `sg_change` entry so reuse/invalidation is a live capability.

## Impacted Capabilities

- Project initialization, stack selection and `ProjectProfile`.
- Java/Vue/React template assets and the style baseline.
- Change workflow stack enforcement and review baselines.
- Control plane configuration, project registry, management console and Web
  session persistence.
- Host capability detection, `doctor`, and degradation behavior.
- Verification matrix, platform evidence and golden manifest.
- Incremental delivery intake.

## Non-Goals

- Adding stacks beyond Java + Vue/React.
- Spring Boot 4.0 preview in this phase.
- macOS acceptance.
- WSL as Linux acceptance evidence.
- Multi-tenant SaaS, complex RBAC, or portfolio management.
- A Web IDE, remote shell, or arbitrary file writes.
- Pre-seeding business modules into the scaffold.
- Changing H1/H3, evidence, delivery, or customer-acceptance semantics.
