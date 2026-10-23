# In-Session Environment Preparation Specification

Status: core implementation and dual-platform command checks passed; native
Codex session and release acceptance pending.

## ADDED Requirements

### Requirement: In-Session Environment Preparation Entry

The system MUST provide an environment preparation Skill / command only after the
user enters Codex. `$sg-codex-env` MUST own this flow; the router, project and
change entries MUST use the same gate when preparation is needed.
`$sg-codex-setup` MUST remain a compatibility alias, not a duplicate workflow.
The user MUST NOT need to locate installer
scripts or MCP tool names to follow the normal path.

#### Scenario: Project stack determines the plan

- GIVEN a user enters Codex and starts SpecGate
- WHEN the existing project stack is read or the new project stack is selected
- THEN the system performs read-only preflight and identifies reusable tools
- AND shows the missing or incompatible tools, versions, sources and targets
- AND installs the required missing subset within authorization and host permissions
- AND performs real verification before releasing the workflow

### Requirement: In-Session Runtime Recovery

The system MUST perform environment inspection and installation inside Codex
on Windows and Linux. It MUST NOT provide external installation scripts,
PowerShell/Bash setup entry points or a separate full-toolchain installation mode.
Platform-native commands MAY be invoked internally under host permissions.

#### Scenario: Node is initially absent

- GIVEN a supported Codex session with a loaded setup Skill and no usable Node
- WHEN the Skill coordinates authorized runtime recovery in that session
- THEN it obtains a pinned, integrity-checked Node runtime through the selected
  source policy
- AND reports the actual resulting Node and npm versions
- AND reconnects MCP before continuing the shared environment preparation flow
- AND does not depend on the unstarted Node-based MCP to provision itself
- AND the user is not directed to run an installation script outside Codex

#### Scenario: Runtime recovery is unavailable

- GIVEN the Skill is unavailable or host permissions prevent runtime installation
- WHEN preparation attempts to proceed
- THEN the workflow remains blocked with the actual cause and recovery guidance
- AND no successful readiness state is fabricated

#### Scenario: Check-only execution

- GIVEN any supported Codex session
- WHEN the user selects check-only mode
- THEN the system reports current readiness without downloading or writing
  files

### Requirement: Minimum Workflow Toolchain

The system MUST support Git, a supported Node/npm pair, Codex CLI, JDK 8/17/21
and Maven 3.9.x, but MUST install or reuse only the current project's required
subset and base utilities by default. It MUST reuse the active Codex host and
MUST install a separate CLI only when the selected workflow requires one.

#### Scenario: Only Java 17 is needed

- GIVEN a Java 17 + Vue project and missing JDK 8 and 21
- WHEN preflight and on-demand setup run
- THEN only the selected JDK 17 and other required missing components are installed
- AND absent JDK 8 and 21 neither trigger installation nor block readiness

#### Scenario: Source development dependencies are unnecessary

- GIVEN a user runs a packaged SpecGate plugin
- WHEN environment preparation runs
- THEN plugin source development dependencies are not installed

#### Scenario: Project later requires Java 8

- GIVEN a ready Java 17 environment and a new Java 8 project
- WHEN the new project's preflight runs
- THEN compatible Git, Node/npm and Maven are reused
- AND only the new project's missing JDK and required dependencies are installed

#### Scenario: Compatible tool already exists

- GIVEN a required tool is discovered at a compatible version
- WHEN installation is planned
- THEN the existing tool is reused
- AND it is not downloaded, overwritten or uninstalled

#### Scenario: Optional tool is absent

- GIVEN Gradle, pnpm, Yarn, Docker, a database or a browser is absent
- WHEN in-session project environment preparation runs
- THEN that optional tool is not installed

### Requirement: Bounded Tool Discovery

Discovery MUST inspect only explicit environment values, PATH, owned toolchain
roots and bounded known locations, and MUST NOT recursively scan arbitrary
drives.

#### Scenario: Tool is not in bounded locations

- GIVEN a tool exists only in an unrelated deep filesystem location
- WHEN discovery runs
- THEN discovery completes within its timeout
- AND reports the tool missing rather than scanning the drive

### Requirement: Safe Multi-JDK Coexistence

JDK 8, 17 and 21 MUST support coexistence and MUST be selectable per project without
silently replacing the user's global Java default.

#### Scenario: Existing default JDK differs from project JDK

- GIVEN the user default is JDK 21 and a project requires JDK 8
- WHEN the project verification command runs
- THEN SpecGate invokes the discovered JDK 8 toolchain for that command
- AND the user's global JDK 21 configuration remains unchanged

### Requirement: Domestic Mirror Isolation

The default source profile MUST use domestic mirrors, including npmmirror for
npm and an Alibaba public Maven repository, without permanently modifying the
user's global npm or Maven configuration.

#### Scenario: Default domestic install

- GIVEN the user has not selected another source profile
- WHEN dependencies are installed
- THEN the current operation uses the configured domestic sources
- AND the final report records the effective sources
- AND user-global npm and Maven configuration remains unchanged

#### Scenario: Trustworthy domestic binary source is unavailable

- GIVEN a component has no configured domestic source with a trusted integrity
  path
- WHEN installation reaches that component
- THEN installation stops with an actionable official-source option
- AND does not silently change sources

### Requirement: Verified and Atomic Download Publication

Portable downloads MUST use a fixed version and trusted checksum or signature,
and MUST pass an executable probe before becoming the active installation.

#### Scenario: Checksum mismatch

- GIVEN a downloaded archive does not match trusted integrity metadata
- WHEN verification runs
- THEN the archive is rejected and removed
- AND the active installation remains unchanged
- AND the command exits nonzero

### Requirement: Explicit Privilege Handling

The installer MUST prefer user-scoped installation and MUST make any required
privilege escalation visible before it occurs.

#### Scenario: Package manager needs elevation

- GIVEN a missing component could be installed by an elevated package manager
- WHEN the installer plans that method
- THEN the pending elevated operation is shown explicitly
- AND denial leads to a safe user-scoped fallback or a clear failure

### Requirement: Idempotent and Recoverable Installation

Repeated execution MUST reuse verified state, avoid duplicate downloads and
configuration entries, and recover from partial earlier runs based on real
state rather than completion markers alone.

#### Scenario: Immediate rerun after success

- GIVEN in-session environment preparation completed successfully
- WHEN the same command runs again
- THEN required components are reported as ready or reused
- AND no component is downloaded again
- AND no PATH or environment entry is duplicated

### Requirement: Codex and SpecGate Readiness Layers

The system MUST separately report toolchain, Codex, SpecGate and end-to-end
workflow readiness, using real probes for every layer.

#### Scenario: Codex is installed but unauthenticated

- GIVEN the Codex executable starts but user authentication is required
- WHEN readiness is checked
- THEN CLI installation and startup are reported accurately
- AND authentication remains a manual pending action
- AND full workflow readiness is not reported as passed

#### Scenario: Plugin capability is unavailable

- GIVEN the host Codex lacks plugin capability
- WHEN SpecGate readiness is checked
- THEN the supported project MCP + Skill degradation path is probed
- AND the degradation is visible in the report

### Requirement: Project-Scoped Workflow Environment Gate

The system MUST block generation, implementation and delivery until the current
project's required environment passes real verification. Formal build/test
MUST check its corresponding environment. Project selection, stack clarification,
diagnosis and preparation's own verification commands MAY run before readiness.

#### Scenario: Preparation fails or is cancelled

- GIVEN required installation or verification fails, is denied, is cancelled or
  has not run
- WHEN the user attempts to continue the workflow
- THEN the gate remains blocked with the actual reason and retry instructions
- AND installation exit success alone cannot release the gate

#### Scenario: Inputs change after a successful preflight

- GIVEN readiness was recorded for a project, stack, tool paths and versions
- WHEN the project, stack or effective tool environment changes
- THEN readiness is rechecked for the new inputs before workflow release
- AND another project's ready flag is not accepted

#### Scenario: Environment remains ready

- GIVEN the readiness inputs remain unchanged
- WHEN the workflow continues
- THEN valid environment results are reused
- AND the installer does not download again or require the full release matrix

### Requirement: Owned Temporary Data Cleanup

Every installer staging, download, extraction, temporary mirror configuration
and generated verification directory MUST have an owner and MUST be cleaned on
success, failure and controlled interruption.

#### Scenario: Installation fails after extraction

- GIVEN an owned archive has been extracted to staging
- WHEN the executable probe fails
- THEN the staging and archive paths are cleaned with bounded retries
- AND unrelated temporary content is untouched
- AND any cleanup failure is recorded for safe later recovery

### Requirement: Truthful Structured Evidence

The final human and JSON reports MUST contain actual platform, component,
source, path, version, command, exit-code, integrity and cleanup results, and
MUST identify all pending or unexecuted work.

#### Scenario: A verification command was not run

- GIVEN an acceptance command was skipped or could not start
- WHEN the report is written
- THEN that item is marked unexecuted or pending with its reason
- AND it is not counted as passed

### Requirement: Real Dual-Platform Acceptance

The change MUST NOT be described as dual-platform verified until the same Git
commit passes on a real supported Windows host and the user-approved Ubuntu
26.04.1 x64 VM running in VMware Workstation. Other distro versions remain
unverified until separately executed.

#### Scenario: Only Windows has passed

- GIVEN the complete Windows acceptance has passed
- AND Ubuntu acceptance has not run or has failed
- WHEN the overall status is computed
- THEN the status remains pending or failed

#### Scenario: Both required platforms pass

- GIVEN Windows and the VMware Ubuntu VM run the same Git commit
- AND both execute the in-session preflight, reuse, selected-stack installation,
  verification and workflow-gate path
- WHEN Codex/SpecGate smoke, JDK 8/17/21 Maven verification, Vue/React locked
  install/test/lint/format/build, mirror checks, failure checks, cleanup checks
  and idempotent reruns all pass
- THEN the change may be marked dual-platform verified
- AND exact evidence and any untested operating-system variants are recorded
