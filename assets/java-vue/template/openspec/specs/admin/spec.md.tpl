# Java/Vue admin scaffold requirements

## Requirements

### Requirement: System administration modules (REQ-001)

The system SHALL provide CRUD, pagination and filtering for system users, roles,
departments and menus through the authenticated Vue/API interface, including
atomic batch operations where a batch endpoint exists.

#### Scenario: Administration workflow (AC-001)

- **WHEN** an administrator manages users, roles, departments or menus
- **THEN** the correct page and atomic mutation results are returned and shown

### Requirement: Read-only audit log (REQ-002)

The system SHALL expose the audit log as a read-only, filtered and paged query
with no mutation endpoint.

#### Scenario: Audit review (AC-002)

- **WHEN** a user opens the audit log
- **THEN** entries can be filtered and paged but never created, updated or
  deleted through the API

### Requirement: Dashboard summary (REQ-003)

The system SHALL expose a read-only dashboard summary of record counts.

#### Scenario: Dashboard load (AC-003)

- **WHEN** an authenticated user opens the dashboard
- **THEN** the summary counts are returned and rendered

### Requirement: Local Session authentication (REQ-004)

The system SHALL authenticate configured local accounts, enforce CSRF and
distinguish ADMIN and VIEWER permissions.

#### Scenario: Login and permission boundaries (AC-004)

- **WHEN** a user logs in, writes, is logged out or exceeds login limits
- **THEN** Session/CSRF/role rules are enforced on the backend and the UI returns
  to the login gate whenever the session is not authenticated

### Requirement: Bounded CSV transfers (REQ-005)

The system SHALL prevalidate and atomically import UTF-8 CSV for users and roles,
and export filtered rows safely.

#### Scenario: Import and export (AC-005)

- **WHEN** an administrator imports a CSV or a user exports results
- **THEN** row/size limits, atomicity and spreadsheet formula protection are
  enforced

### Requirement: Uniform HTTP errors (REQ-006)

The system SHALL use GET queries, POST JSON mutations, validated inputs and safe
uniform errors.

#### Scenario: Invalid input or unexpected failure (AC-006)

- **WHEN** a request fails
- **THEN** a safe JSON error with traceId and appropriate HTTP status is returned

### Requirement: Bilingual admin interface (REQ-007)

The system SHALL render all display text from i18n keys, default to zh-CN and
switch to en-US at runtime.

#### Scenario: Language switching (AC-007)

- **WHEN** a user switches the language
- **THEN** the navigation, dashboard and module labels update without a reload

### Requirement: Health and configurable runtime (REQ-008)

The system SHALL expose safe public health information and accept configured
local ports.

#### Scenario: Health check (AC-008)

- **WHEN** the backend is healthy
- **THEN** its health endpoint returns status without requiring login or exposing
  details
