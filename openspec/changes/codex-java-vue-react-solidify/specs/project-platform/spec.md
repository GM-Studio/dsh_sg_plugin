# Project Platform Specification

Status: approved (2026-10-22).

## ADDED Requirements

### Requirement: Interactive Stack Selection

The system MUST let the user choose a JDK major (8, 17 or 21) and a frontend
framework (Vue 3 or React 18) when initializing a project, and MUST echo the
effective choice.

#### Scenario: Choose JDK 21 with React

- GIVEN a user initializes a new project
- WHEN the user selects JDK 21 and React
- THEN the generated `ProjectProfile` records JDK 21 and React
- AND the generated output contains a React frontend and a JDK 21 backend

#### Scenario: Default selection is visible

- GIVEN a user initializes a project without choosing
- WHEN initialization completes
- THEN the effective default JDK and frontend are reported explicitly

### Requirement: Stack Enforcement

The system MUST record the selected stack in `ProjectProfile` and MUST enforce it
in subsequent changes, failing closed on mismatch.

#### Scenario: React project

- GIVEN a project whose `ProjectProfile` selects React
- WHEN a change runs
- THEN only the React frontend agent and its dependencies are dispatched
- AND a mismatched stack or dependency fails closed before implementation

### Requirement: Domain-Neutral Management Scaffold

The system MUST generate a complete, domain-neutral management-system scaffold
covering users, roles, departments, menus, permissions, audit log, pagination,
import/export and a dashboard, with both a complete backend and a complete
frontend that run together.

#### Scenario: Generated scaffold runs

- GIVEN a generated scaffold
- WHEN a real build, test and run are performed
- THEN both frontend and backend pass
- AND the pre-seeded modules are usable

#### Scenario: Generation conventions

- GIVEN any generated scaffold
- THEN package names use `com.<company>.<business>`
- AND source files carry Chinese descriptions
- AND display text is provided through i18n keys with a `zh-CN` default and an
  `en-US` runtime switch
- AND no `com.example.*` package is generated

### Requirement: Frontend Parity

The Vue and React scaffolds MUST share one backend contract, one menu model and
one i18n key set, and MUST present equivalent interactions.

#### Scenario: Same capability on both frontends

- GIVEN the same business capability exists in both scaffolds
- WHEN a user operates it on each frontend
- THEN both use the same backend contract and i18n keys
- AND both present an equivalent information hierarchy and action path

### Requirement: Style Baseline Enforcement

The system MUST ship the runnable scaffold together with a separate style guide
and MUST make it an enforceable review baseline.

#### Scenario: Unjustified deviation

- GIVEN a change implementation deviates from the style baseline
- WHEN the Reviewer reviews it
- THEN the Reviewer can raise a blocking finding
- AND the round does not pass unless the deviation has an explicit, recorded
  justification

### Requirement: Multi-Project Control

The system MUST maintain a multi-project registry exposing an aggregate console
(cross-project attention, queue and a global concurrency limit) and an isolated
mode (per-project control home and port), switchable by one command.

#### Scenario: Aggregate console

- GIVEN several projects exist
- WHEN the user opens the aggregate console
- THEN cross-project attention and queue are visible
- AND the global concurrency limit is enforced

#### Scenario: Isolated mode

- GIVEN a project needs isolation
- WHEN the user switches it to isolated mode
- THEN it runs with its own control home and port
- AND other projects are unaffected

#### Scenario: Project isolation

- GIVEN two configured projects
- WHEN one project runs
- THEN it does not share MCP configuration or credentials with the other

### Requirement: Durable Web Session

Web sessions and pairing tokens MUST remain valid across a control-plane restart
within their configured TTLs.

#### Scenario: Restart keeps a session

- GIVEN a Web console session is established
- WHEN the control plane restarts
- THEN the session and pairing remain usable within their TTLs

### Requirement: Host Capability Detection

The system MUST probe host Codex capabilities (`plugin`, `exec --json`, native
subagents, elicitation), MUST report `available`, `missing` or `not-probed`, and
MUST NOT rely on a version string as the sole decision input.

#### Scenario: Probing is visible

- GIVEN a host Codex of any version
- WHEN capability detection runs
- THEN each capability is reported as `available`, `missing` or `not-probed`

### Requirement: Explicit Degradation

When a capability is missing the system MUST take a defined degradation path
(project-level MCP + skill) and MUST report it, never failing silently.

#### Scenario: No plugin support

- GIVEN a host Codex that does not support `plugin`
- WHEN the workflow starts
- THEN it runs through the project-level MCP + skill path
- AND the degradation is explicitly reported

### Requirement: Version Gate Hint

The system MUST present an explicit refusal or degradation notice with upgrade
guidance when required capabilities are absent.

#### Scenario: Insufficient capability

- GIVEN required host capabilities are absent
- WHEN the user attempts to start delivery
- THEN the system refuses or degrades explicitly with upgrade guidance

### Requirement: Dual-Platform Verification

A stack combination MUST NOT be marked verified until it passes on both Windows
and Linux, recorded against the same `templateHash`.

#### Scenario: Both platforms required

- GIVEN a stack combination
- WHEN one real verification completes on Windows and one on Linux
- THEN results are recorded against the same `templateHash`
- AND the combination is marked verified only when both passed

#### Scenario: Real Linux environment

- GIVEN Linux acceptance is required
- WHEN it is performed
- THEN it runs in a real Ubuntu environment
- AND WSL is not accepted as evidence

### Requirement: Toolchain Reuse

The system MUST reuse installed JDK/Maven/Node toolchains and MUST NOT download
silently when one is missing.

#### Scenario: Missing toolchain

- GIVEN a required toolchain is not installed
- WHEN verification runs
- THEN the system gives explicit guidance
- AND it does not download silently

### Requirement: Incremental Delivery Intake

The system MUST compute incremental delivery impact (affected and reused
acceptance criteria, invalidated tests) from the accepted parent delivery at the
`sg_change` intake.

#### Scenario: Feedback against a previous delivery

- GIVEN an accepted parent delivery and new feedback
- WHEN a change is created with the parent reference
- THEN the intake records affected ACs, reused ACs and invalidated tests
- AND the parent delivery is not overwritten
