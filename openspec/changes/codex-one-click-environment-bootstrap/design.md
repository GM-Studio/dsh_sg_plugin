# Codex / SpecGate User Entry Points and Environment Preparation Design

Status: core implementation and dual-platform command checks passed; native
Codex session and release acceptance pending.

## Boundaries

Acceptance topology amendment (user confirmed 2026-10-23): retain Codex account
authentication and orchestration on the Windows host; execute actual Linux
commands and SG/MCP checks inside the VMware Ubuntu guest via existing Guest
Tools. Do not transfer auth caches or tokens, expose an app-server listener, or
configure a new SSH service. This is not a remotely connected guest Codex CLI.
Guest-native CLI authentication/session acceptance is deferred, not passed.
Host Skill, approval and subagent checks still need their own evidence.

All user entries are in-session Skills / commands. `$sg-codex-env` owns
environment preparation; project and change entries call the same preflight
gate as needed. A shared internal core
owns component metadata, bounded discovery, install planning, mirror selection,
integrity verification, environment persistence, post-install probes and reports.
There are no external installer scripts, PowerShell/Bash setup entry points or
separate full-toolchain setup mode. The Skill may coordinate native commands
within the session under the host's permissions.

Existing toolchain discovery under `src/codex/core/` remains authoritative and
is extended only where the approved requirements expose a gap. Any installer
prototype already present in the worktree is input to the implementation audit,
not evidence of completion.

## Public Entry Responsibilities

| Skill               | Responsibility                                                            | Stop condition                                                             |
| ------------------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `$sg-codex-env`     | Inspect, reuse, install missing selected-stack tools, verify and diagnose | Report environment readiness; do not create a project or start development |
| `$sg-codex-project` | Initialize or adopt, configure project agents, establish baseline         | Project ready; wait if no business request was supplied                    |
| `$sg-codex-change`  | Feature, modification, fix, task control, acceptance and delivery         | Existing workflow gates and approved delivery boundaries                   |
| `$sg-codex-status`  | Aggregate project, environment, baseline, task and delivery facts         | Return information only                                                    |
| `$sg-codex`         | Route intent and provide help                                             | Delegate to one task flow without duplicating it                           |

The old `$sg-codex-setup` remains a compatibility alias. It routes environment
requests to env and initialization/adoption requests to project, explaining the
mapping once. Ambiguous intent is clarified before mutation. It is not a sixth
independent workflow.

Project preparation collects new-project stack choices before invoking env;
adoption reads the existing stack. Both reuse the same choices and results, and
resume existing generation/verification rather than initializing twice. An
environment-ready result does not imply a project baseline is ready.

Status uses read-only project status, authoritative change state and WorkItem
status capabilities without constructing runtime services that create files.
It returns partial information if MCP is unavailable or a project is unbound,
and marks missing or old evidence explicitly. Status and help never trigger
binding, installation, repair, initialization, resume or approval.

Pause, resume and cancel stay within change and identify the target task.
Existing state-store checkpoints and H1/H3 authority remain in force. Diagnosis
stays in env; help stays in the router. Optional command-menu surfaces delegate
to the same orchestration rather than creating another implementation.

Skill definitions, UI metadata, onboarding routing, generated project copies and
documentation must describe the same responsibilities. `sg_project_setup`
continues to configure project Agent/Skill/MCP assets and must not be labelled
as a complete environment installer. No additional state authority is created.

## In-Session Flow and Workflow Gate

The flow is project/stack identification, read-only preflight, reuse, missing
component plan, authorized installation, real verification and workflow release.
Project selection, stack clarification and diagnosis can happen before the gate.
Generation, implementation and delivery require readiness; formal build/test
also checks the corresponding environment. Preparation's own verification
commands may run while the gate is pending.

Gate state is bound to the project, stack and actual tool versions and paths.
Changes invalidate readiness. Failure, denial, cancellation and unexecuted
required checks keep the gate blocked with actionable retry information.
Unchanged inputs reuse valid results without rerunning the full release matrix
at each step.

The Node-based MCP cannot install a missing runtime before startup. When a setup
Skill is already readable by Codex, it coordinates native runtime discovery and
authorized installation within the current session, verifies Node and reconnects
MCP. It does not require a separate external script or a working MCP server for
this recovery. If the Skill is unavailable or host permissions prevent recovery,
the workflow stays blocked with an actionable reason. Check-only mode never
installs Node.

## Readiness Model

The report separates readiness layers so a partial success cannot masquerade as
a complete setup:

1. `toolchainReady`: the selected project's required binaries pass real probes.
2. `codexReady`: Codex starts and its required capabilities are reported.
3. `specgateReady`: plugin smoke or the explicit MCP + Skill fallback passes.
4. `workflowReady`: the selected project's necessary environment validation passes.

Release acceptance covers the full supported matrix separately. An ordinary
Java 17 project does not install or validate JDK 8 and 21 before proceeding.

Authentication that needs user interaction remains a visible pending action.
It is never copied, fabricated or inferred from an installed executable.

## Installation Strategy

Discovery runs first and is bounded to PATH, explicit environment variables,
SpecGate-owned toolchain roots and a small set of known install locations.
Compatible installations are reused. Missing tools prefer user-scoped portable
installations; an OS package manager may be used only with visible privilege
handling. Existing working versions are never uninstalled or overwritten.

JDK 8, 17 and 21 can coexist; only the selected missing major is installed by
default. SpecGate records their homes and selects one for each project command
instead of changing the user's global default. Maven is shared
but is always reprobed with the selected JDK.

Downloads land in an owned staging directory. An archive is not published to
its final directory until its fixed version and trusted checksum or signature
have passed, and its executable has been probed. A failed publication leaves
the previous working installation intact.

## Mirrors and Configuration Isolation

The default domestic profile uses npmmirror for npm and an Alibaba public Maven
repository. Binary mirror entries are centralized metadata selected only after
their provenance and integrity path are established. If a trustworthy domestic
path is unavailable, the installer fails with an explicit official-source
option instead of silently switching.

npm and Maven mirror settings are process-scoped or written to an owned
temporary configuration. User-global `.npmrc`, Maven `settings.xml` and shell
profiles are not rewritten. Persistent tool paths use an owned environment file
or a replaceable marked block, never repeated blind appends.

## Safety and Temporary Data

All subprocesses use argument arrays, bounded timeouts and redacted logging.
The installer never disables TLS verification, PowerShell policy or platform
security controls. It rejects unsupported architecture before changing state.

Each staging, download, extraction, mirror-config and verification directory is
marked and owned by one run. Cleanup executes on success, failure and controlled
termination with bounded retries. Only provably owned paths are eligible for
recovery on a later run.

## Verification

Unit and integration tests cover planning and failure behavior, but acceptance
requires real commands from one Git commit on:

- a supported real Windows environment; and
- the user's Ubuntu 26.04.1 x64 VM running in VMware Workstation (explicitly
  accepted during implementation); other distro versions remain unverified.

WSL, containers and mocked platform values do not count as Linux evidence. The
matrix executes Codex/SpecGate smoke, JDK 8/17/21 Maven verification, and locked
Vue and React install/test/lint/format/build flows. Both platforms rerun the
installer to prove idempotency and inspect owned temporary roots afterward.

Operating-system variants not actually executed remain explicitly unverified.
