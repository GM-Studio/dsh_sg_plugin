# User Entry Points Specification

Status: core implementation and dual-platform command checks passed; native
Codex session and release acceptance pending.

## ADDED Requirements

### Requirement: Four Task Entries and One Router

The public Skill surface MUST provide `$sg-codex-env` for environment
preparation, `$sg-codex-project` for project preparation, `$sg-codex-change` for
business changes and `$sg-codex-status` for read-only information. `$sg-codex`
MUST route intent and provide help using those same capabilities.

#### Scenario: Prepare only the environment

- GIVEN a user requests only environment preparation
- WHEN `$sg-codex-env` completes selected-stack inspection, reuse, installation
  and real verification
- THEN environment readiness is reported separately from project readiness
- AND no project generation or development begins automatically

#### Scenario: Route a status question

- GIVEN a user asks the router for the current project state
- WHEN intent is routed
- THEN the status capability returns facts and suggested actions
- AND no installation, initialization or task resumption is triggered

### Requirement: Project Preparation Reuses Environment Preparation

The project entry MUST initialize new projects or adopt existing projects using
the selected/detected stack, the shared environment gate and existing baseline
rules. Repeated invocation MUST NOT repeat choices, generation or installation
already completed for unchanged inputs.

#### Scenario: New project

- GIVEN a user requests a new project
- WHEN the user selects its path and stack
- THEN required environment preparation precedes generation
- AND Agent/Skill/MCP configuration and real baseline verification follow
- AND the system waits after readiness if no business requirement was supplied

#### Scenario: Existing or partially prepared project

- GIVEN the target contains an existing business project or generated files
- WHEN project preparation runs
- THEN existing configuration and user files are retained
- AND adoption or outstanding verification continues without reinitialization

### Requirement: Strictly Read-Only Status Aggregation

Status MUST aggregate project identity/path, stack, environment tool versions and
paths, missing tools, profile/baseline state, Change/WorkItem progress, pending
approvals, blocking reasons, recent verification/delivery and possible next
actions using existing state sources. Evidence MUST identify its age and
applicable commit. Missing information MUST remain unknown or unavailable.

#### Scenario: Incomplete environment or unavailable MCP

- GIVEN the project is unbound, preparation is incomplete or MCP is unavailable
- WHEN status is requested
- THEN available facts and actual limitations are returned
- AND no binding, installation, configuration generation or repair occurs
- AND files, configuration and task state remain unchanged

#### Scenario: Task awaits approval

- GIVEN a task is waiting for H1 or H3
- WHEN status is requested
- THEN the pending approval and available user action are reported
- AND the task is neither approved nor resumed

### Requirement: Preparation Alias Compatibility

`$sg-codex-setup` MUST remain a compatibility alias for environment/project
preparation, explain the mapping once and delegate without duplicating work.
Ambiguous intent MUST be clarified before mutation. It MUST NOT start business
development or count as implicit installation approval.

#### Scenario: Old environment repair request

- GIVEN a user calls the old setup Skill to repair missing tools
- WHEN the request is routed
- THEN the environment capability handles it exactly once

#### Scenario: Old initialization request

- GIVEN a user calls the old setup Skill to initialize or adopt a project
- WHEN the request is routed
- THEN the project capability handles it using the same environment handoff
- AND no second initialization flow is created

### Requirement: Task Controls and Delivery Remain in Change

Pause, resume, cancel, acceptance and delivery MUST belong to the change entry.
Task controls MUST identify the target and use existing stable checkpoints,
state and approval authority. Diagnosis MUST belong to env and help to the
router. Separate control, delivery, diagnosis and help Skills are not required.

#### Scenario: Resume an identified task

- GIVEN a paused task with a recorded checkpoint
- WHEN the user requests continuation through the change entry
- THEN that task resumes from the checkpoint without creating a duplicate Change
- AND environment and approval gates still apply

#### Scenario: Cancel preserves evidence

- GIVEN a user requests cancellation of an identified task
- WHEN cancellation completes
- THEN existing code, branches and evidence are preserved

#### Scenario: Delivery without push authorization

- GIVEN a task reaches acceptance and delivery
- WHEN H3 has not been approved or push has not been authorized
- THEN the corresponding archive or push action remains blocked under existing rules

### Requirement: Shared Implementation and Consistent Discovery

Skill definitions, onboarding metadata, UI labels, generated project Skill
copies and user documentation MUST describe the same responsibilities. Optional
command-menu surfaces MUST call the same orchestration, permissions and state
handling. Existing MCP tools remain the execution/state source; splitting
Skills MUST NOT introduce a second authoritative state store.

#### Scenario: Command and Skill share an action

- GIVEN the host exposes a command-menu action for a task Skill
- WHEN either surface is invoked with the same intent and context
- THEN both select the same flow and respect the same permissions and gates

#### Scenario: Project configuration tool is described accurately

- GIVEN the internal `sg_project_setup` tool configures Agent/Skill/MCP assets
- WHEN public help describes project preparation
- THEN the tool is not described as installing the complete development environment
