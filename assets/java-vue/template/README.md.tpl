# Java 8 + Vue admin monorepo

Generation copies source and project-local reference examples only. It never installs dependencies, runs checks or starts servers. Golden acceptance is a historical template result, not evidence that this project was tested.

## Start

- Maintained Java 8 JDK and Maven 3.9.x. Set JAVA_HOME; Maven Wrapper (`backend/mvnw` or `backend/mvnw.cmd`) uses Maven 3.9.11.
- Node 24 or Node 22 >=22.12 and npm. Dependencies are pinned and frontend/package-lock.json is included.
- Set APP_ADMIN_PASSWORD and APP_VIEWER_PASSWORD to different private passwords (12+ characters, no more than 72 UTF-8 bytes). There is no default password. Accounts are admin and viewer.
- Run node scripts/run.mjs install, then node scripts/run.mjs dev. Open http://127.0.0.1:5173. Stop with Ctrl+C.
- Optional MAVEN_CMD chooses a full Maven executable path. Ports and database options: docs/operations.md.

The interface is a domain-neutral admin scaffold: login/logout, a dashboard summary, and management of system users, roles, departments, menus and the read-only audit log, each with paged/filtered queries, atomic batch actions and CSV import/export, plus zh-CN/en-US runtime switching. VIEWER reads/exports; ADMIN writes.

## Check final source

- node scripts/run.mjs format: apply Spotless AOSP four-space Java formatting and frontend Prettier.
- node scripts/run.mjs verify: backend tests, JaCoCo thresholds, Checkstyle and format check; frontend typecheck/build, Vitest coverage, ESLint and format check.
- node scripts/run.mjs test/lint/typecheck/static/format:check: focused commands.
- /sg-verify additionally exercises a real isolated server, roles, CSRF, CRUD/batch/CSV and graceful restart persistence, retaining logs and reconciled reports.
- Backend and frontend separately require >=80% line and >=70% branch coverage. Missing reports, skipped required tests or a failed command must not be described as passed.

Read docs/style.md before sg-change. The fixed reference snapshots in .specgate/examples and their manifest are intentional, committed inputs for planning, implementation and review. Modify normal business files; do not rewrite snapshots to hide drift.

API contracts: docs/api.md and docs/openapi.yaml. Security scope and stack risks: docs/security.md. This is a small local starter; production migrations, SSO and distributed infrastructure are outside its scope.
