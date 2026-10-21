# Codex Native Agent Orchestration

## ADDED Requirements

### Requirement: Source Plugin Loading

Codex SHALL discover the plugin's bundled stdio MCP server from a portable root manifest and SHALL provide a documented source marketplace installation path.

#### Scenario: Install from source

- GIVEN a clean SpecGate checkout with locked dependencies installed
- WHEN the user adds the checkout as a local marketplace and installs `specgate-codex`
- THEN a new Codex session exposes the SpecGate MCP tools without manually adding a second MCP server

### Requirement: Truthful Skill Surface

The packaged `sg-codex` Skill MUST describe the tools and workflow implemented by the current package and MUST NOT claim that the workflow is unavailable.

#### Scenario: Agent reads the plugin Skill

- GIVEN the plugin is enabled
- WHEN Codex loads `skills/sg-codex/SKILL.md`
- THEN the Skill identifies `sg_init`, `sg_verify`, `sg_change_add`, planning, agent handoff, quality, formatting, Review and archive tools
- AND it requires real subagents for role work

### Requirement: Test-First Agent Handoff

Test design MUST complete in an independent Git worktree before frontend or backend implementation begins.

#### Scenario: Freeze native Test Designer output

- GIVEN the plan is in `TEST_DESIGN`
- WHEN the Test Designer commits test code, fixtures, runner and a manifest in its worktree
- THEN MCP validation accepts only manifest entries whose files match their hashes and AC mappings
- AND it freezes immutable test assets before creating frontend/backend worktrees

#### Scenario: Test-asset revision after freeze

- GIVEN frozen tests fail only because the test source or runner contract is invalid
- WHEN the Test Designer commits a corrected revision and submits its complete assets with a bounded reason
- THEN SpecGate preserves the previous immutable manifest and creates a versioned replacement
- AND product frontend/backend agents are not asked to edit tests

### Requirement: Native Runner Contract

The native runner adapter SHALL provide a canonical test-root argument and SHALL remain compatible with previously frozen runners.

#### Scenario: Legacy runner fallback

- GIVEN a frozen runner interprets `--tests` as the snapshot parent
- WHEN the canonical invocation produces no report or a setup-only duplicated `specgate-tests/specgate-tests` error
- THEN the adapter retries once with the snapshot parent
- AND explicit failing case reports are never retried or hidden

### Requirement: Parallel Development

Codex SHALL dispatch real Frontend and Backend subagents concurrently after the red baseline and fixed worktrees exist.

#### Scenario: Integrate two role commits

- GIVEN frontend and backend worktrees point at the same freeze commit
- WHEN both subagents commit their role-scoped changes
- THEN SpecGate validates each commit descends from the freeze commit, contains no test changes and stays within its role prefix
- AND it merges both through the integration worktree

### Requirement: Post-Development Test Agent

The Tester SHALL run the frozen cases after development integration and before formatting.

#### Scenario: Frozen tests pass

- GIVEN the integration commit is fixed and the Test worktree is aligned to it
- WHEN the Tester invokes the frozen runner
- THEN every frozen case must be present and pass without skips
- AND real Java/Vue verification evidence must also pass before the phase becomes `FORMATTING`

#### Scenario: Retry after generated test cleanup

- GIVEN a previous Tester run left only untracked generated files under test paths
- WHEN the server aligns its test worktree for a retry
- THEN those server-generated test files are removed before checkout
- AND unrelated or tracked changes still fail closed

### Requirement: Dedicated Formatter

Formatting MUST run in its own worktree after tests pass and before Review.

#### Scenario: Formatter commits

- GIVEN quality passed and integration is fixed
- WHEN the Formatter runs the configured formatters
- THEN only formatter-safe source/docs changes may be committed
- AND the formatted commit is merged before Review starts

### Requirement: Read-only Review

Review MUST inspect a fixed integration commit in the review worktree without modifying it.

#### Scenario: Clean Review

- GIVEN formatting merged and the review worktree is detached at that commit
- WHEN the Reviewer submits findings bound to current quality and diff evidence
- THEN a visible pass enters `H3_PENDING`
- AND any write to review or main worktrees is rejected

### Requirement: High-risk Rework Loop

Blocking Review findings MUST return to new frontend/backend development worktrees and rerun the full test-format-review sequence.

#### Scenario: Strict Review blocks

- GIVEN Review found a blocking finding for the active mode
- WHEN the orchestration starts rework
- THEN a new round number and new dev worktrees are recorded
- AND the state returns to `DEVELOPING`
- AND after rework it must pass TESTING, FORMATTING and REVIEWING again

### Requirement: Interactive Host Approval

Host approval MUST remain user-visible, single-use and durably audited.

#### Scenario: Native H1 elicitation

- GIVEN the MCP client advertises elicitation and the local host explicitly enables interactive approval
- WHEN H1 is requested
- THEN the user sees the gate summary in Codex
- AND only an accepted native response bound to the current artifact hash may freeze requirements
- AND missing capability, rejection, timeout or artifact drift keeps the gate pending
