# Java/Vue+React Stack Solidify Design

Status: approved for implementation (2026-10-22). Implementation proceeds on
branch `sg-codex-stack-solidify`; merge back to `sg-codex` only after
acceptance.

## Boundaries

Codex owns code understanding, template authoring, command execution and project
agents. SpecGate owns stack selection, `ProjectProfile`, the scaffold and style
baseline, the control-plane registry, host capability reporting, and platform
verification evidence.

The active-change state remains authoritative in
`src/codex/state-machine.js`. The control plane (`src/codex/control/**`) remains
the owner of WorkItem orchestration. This change widens inputs and carrying
capacity; it does not introduce a second state authority.

## Stack Matrix

`src/codex/core/java/java-versions.js` already models JDK presets. Extend the
selection surface to pair a JDK preset with a frontend framework:

- JDK: 8 (Spring Boot 2.7.x), 17 and 21 (Spring Boot 3.5.x).
- Frontend: Vue 3 (existing) and React 18 (new).

Frontend choice is a separate axis from the JDK preset. The pair is validated
once and recorded; Java 8 with a React frontend remains a valid combination.

Spring Boot 4.0 preview is out of scope for this phase.

## Scaffold

`assets/java-vue/template/` becomes a domain-neutral management-system scaffold
and gains a React sibling. The scaffold must stay runnable and verifiable:
generation is not verification, and the two frontends must share one backend
contract, one menu model and one i18n key set.

Naming, i18n and comment conventions follow the existing adopted-project
conventions: `com.<company>.<business>`, Chinese source comments, `zh-CN`
default with `en-US` runtime switching, no `com.example.*`.

## Style Baseline

The scaffold plus a separate style guide are the baseline. The Reviewer agent's
instructions gain the ability to raise blocking findings for unjustified
deviation. The style guide is the canonical, human-readable statement of the
conventions the scaffold demonstrates.

## Selection and Profile

Selection is an `sg_init_preview` / `sg_init` input and lands in
`ProjectProfile`. The change workflow validates stack match before
implementation and fails closed on mismatch. No tool call may silently change a
project's recorded stack.

## Multi-Project Control

The control store keeps one project registry. Aggregate mode runs a single
daemon with a global concurrency limit and exposes cross-project attention and
queue views. Isolated mode runs one control home and port per project; a single
command switches modes. Project credentials and MCP configuration are never
shared across projects.

Web sessions and pairing tokens move from process memory to durable storage
with their existing TTLs (8 h session, 15 min pairing).

## Host Compatibility

A bounded capability probe reports `plugin`, `exec --json`, native subagents and
elicitation as `available`, `missing` or `not-probed`; the result is surfaced by
`doctor`. Missing capabilities select the project-level MCP + skill route and
are reported explicitly. A version gate hint is presented but never used as the
sole decision input. Probes are bounded and do not mutate the host.

## Verification and Platforms

The golden matrix requires both `win32` and `linux` results for the same
`templateHash` before a combination is `verified`. Linux acceptance runs in a
real Ubuntu 24.04 LTS environment; WSL is not accepted. Toolchain discovery
reuses installed JDK/Maven/Node and never downloads silently.

## Incremental Delivery

`createIncrementalPlan` / `validateIncrementalPlan` are already implemented and
tested but only exercised by the pilot and tests. The intake path validates an
accepted parent and computes affected/reused ACs and invalidated tests, making
reuse and invalidation a live capability rather than a library-only feature.

## Safety and Failure

- Stack mismatch fails closed before implementation.
- Capability probes are bounded and read-only.
- Missing capability degrades explicitly; it never silently no-ops.
- Dual-platform evidence is required; single-platform pass never implies
  verified.
- Existing CAS, evidence-chain and approval semantics are unchanged.
