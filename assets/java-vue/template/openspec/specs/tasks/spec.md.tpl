# Java/Vue reference requirements

## Requirements

### Requirement: Task administration (REQ-001)

The system SHALL provide CRUD, pagination, filtering, sorting and atomic batch operations through the authenticated Vue/API interface.

#### Scenario: Task workflow (AC-001)

- **WHEN** an administrator manages tasks
- **THEN** the correct page and atomic mutation results are returned and shown

### Requirement: Durable tasks (REQ-002)

The system SHALL persist tasks in a file database.

#### Scenario: Graceful restart (AC-002)

- **WHEN** the backend restarts normally
- **THEN** saved tasks remain available

### Requirement: Uniform HTTP errors (REQ-003)

The system SHALL use GET queries, POST JSON mutations, validated inputs and safe uniform errors.

#### Scenario: Invalid input or unexpected failure (AC-003)

- **WHEN** a request fails
- **THEN** a safe JSON error with traceId and appropriate HTTP status is returned

### Requirement: Local Session authentication (REQ-004)

The system SHALL authenticate configured local accounts, enforce CSRF and distinguish ADMIN and VIEWER permissions.

#### Scenario: Login and permission boundaries (AC-004)

- **WHEN** a user logs in, writes, logs out or exceeds login limits
- **THEN** Session/CSRF/role rules are enforced on the backend

### Requirement: Bounded CSV transfers (REQ-005)

The system SHALL prevalidate and atomically import UTF-8 CSV and export filtered rows safely.

#### Scenario: Import and export (AC-005)

- **WHEN** an administrator imports a CSV or a user exports results
- **THEN** row/size limits, atomicity and spreadsheet formula protection are enforced

### Requirement: Authorized local files (REQ-006)

The system SHALL validate uploaded names, MIME/content and size, store opaque file ids and authorize downloads.

#### Scenario: Upload, download and failure handling (AC-006)

- **WHEN** a file is transferred or storage fails
- **THEN** permissions, content limits and metadata/content consistency are maintained

### Requirement: Health and configurable runtime (REQ-007)

The system SHALL expose safe public health information and accept configured local ports.

#### Scenario: Health check (AC-007)

- **WHEN** the backend is healthy
- **THEN** its health endpoint returns status without requiring login or exposing details
