# Delivery Assurance Delta

## ADDED Requirements

### Requirement: Adopted Quality Verification

The quality gate MUST verify adopted projects through the commands recorded in
their ProjectProfile rather than requiring template initialization metadata.

#### Scenario: Adopted project passes

- GIVEN an adopted project with a current ProjectProfile and ProjectBaseline
- WHEN quality verification runs at the fixed integration commit
- THEN every configured command executes in its declared working directory
- AND command output, exit status, duration and commit are recorded
- AND the project may continue when no new failures exist

### Requirement: Baseline Failure Delta

Quality verification MUST distinguish unchanged baseline failures from failures
introduced by the current change.

#### Scenario: Known failure remains unchanged

- GIVEN a baseline known failure with a stable signature
- WHEN the same command produces the same signature at the current commit
- THEN the failure remains a known failure
- AND it is not recorded as passed evidence

#### Scenario: New failure blocks

- GIVEN a command succeeds or has a different failure at baseline
- WHEN the current verification produces a failure with a new signature
- THEN quality is blocked

#### Scenario: Environment drift blocks reuse

- GIVEN verification runs with a different environment fingerprint
- WHEN the adopted verifier compares results with the baseline
- THEN verification is blocked until the baseline is re-established

### Requirement: Generated Project Namespace

New Java/Vue projects MUST use a validated
`com.<company>.<business>` package and MUST NOT generate source under
`com.example`.

#### Scenario: Custom namespace

- GIVEN company `acme` and business `orders`
- WHEN a Java/Vue project is generated
- THEN backend sources use `com.acme.orders`
- AND source files are placed under `com/acme/orders`
- AND the Maven group and application names use the configured identity

### Requirement: Chinese Generated Comments

Generated Java and TypeScript/Vue source files MUST include Chinese comments
that identify the file purpose and project generation boundary.

### Requirement: Chinese-First Frontend I18n

The generated Vue application MUST include typed `zh-CN` and `en-US` locale
messages, MUST default to `zh-CN`, and MUST allow switching locale at runtime.
