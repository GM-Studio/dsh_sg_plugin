## ADDED Requirements

### Requirement: Check the actual Git candidate

Commit hooks SHALL inspect staged blobs, and push hooks SHALL inspect each selected ref against the remote base. Checks SHALL NOT format files or stage changes. Deletions and renames SHALL trigger relevant checks. Source/index races, unmerged paths, unsupported code and missing dependencies/tools SHALL block.

#### Scenario: Partial staging

- **WHEN** staged content differs from the working copy
- **THEN** only staged content is checked and both source and index remain unchanged

#### Scenario: Failed quality check

- **WHEN** a checker or test exits nonzero
- **THEN** the operation is blocked and real command evidence is retained

### Requirement: Approved acceptance strength

Every code change SHALL trigger the complete plugin tests and language static/format checks. Affected Java/Vue template changes SHALL additionally run materialized JDK8 acceptance before commit and four Windows presets before push. Reference Notes SHALL run independent materialization with actual Maven, frontend type/build/test/lint/format, coverage and HTTP smoke checks, without requiring the unrelated full sg-change agent/browser workflow. Legacy Java SHALL run actual JUnit, Checkstyle and Spotless checks.

#### Scenario: Template source changed

- **WHEN** template or verification/gate infrastructure changes
- **THEN** candidate templates run real checks without requiring stale Golden hashes to pass

#### Scenario: Deferred platform

- **WHEN** Linux template acceptance has not been executed
- **THEN** it remains not-run, automatic template CI runs on Windows, and Linux is available only through an explicit manual option

### Requirement: Installation and scope transparency

The installer SHALL respect effective hooksPath and preserve custom hooks. Installation and diagnosis SHALL be explicit. Formatting SHALL be a separate non-staging command. Third-party wrappers SHALL be content-pinned and changed/deleted wrappers SHALL block until reviewed validation is added. Static-only external reference checks SHALL NOT be reported as external project runtime acceptance. Server protection and source repository commit/push SHALL require separate user approval.

#### Scenario: Custom hooks

- **WHEN** a hook contains user additions, even under a managed header
- **THEN** installation fails before modifying either hook
