# Local run and persistence

Set environment variables before starting; .env.example is documentation and is not automatically loaded.

PowerShell:

    $env:APP_ADMIN_PASSWORD='<your private 12+ character password>'
    $env:APP_VIEWER_PASSWORD='<another private 12+ character password>'
    node scripts/run.mjs install
    node scripts/run.mjs dev

POSIX:

    export APP_ADMIN_PASSWORD='<your private 12+ character password>'
    export APP_VIEWER_PASSWORD='<another private 12+ character password>'
    node scripts/run.mjs install
    node scripts/run.mjs dev

Do not copy placeholders as real credentials. Backend startup fails if either password is missing/invalid. Tests and isolated verification generate their own test-only credentials; they never configure the normal application's account passwords.

BACKEND_PORT defaults to 8080; FRONTEND_PORT to 5173. Servers bind loopback and Vite strictPort rejects occupied ports. Optional MAVEN_CMD accepts the Maven executable path. The launchers preserve spaces and reject Windows shell metacharacters in executable arguments.

DB_URL defaults to jdbc:h2:file:./data/tasks;DB_CLOSE_ON_EXIT=FALSE. Backend cwd is backend, so data is in backend/data/tasks.mv.db. DB_USER defaults to sa and DB_PASSWORD to empty for this loopback demonstration. H2 console is disabled. Use one process per database file. ddl-auto=update is for the starter, not production migrations.

FILE_DIRECTORY defaults to backend/data/uploads, resolved relative to the backend cwd. Keep this directory outside web/static roots and restrict disk permissions. Back up database and file contents together while the service is stopped. Metadata uses generated ids; uploads and tasks survive a normal restart with the same database and directory.

Optional limits: FILE_MAX_BYTES=10485760, CSV_MAX_BYTES=2097152, CSV_MAX_ROWS=1000. Multipart transport limit remains 10 MiB per file / 11 MiB request; raising application limits requires reviewing the transport limits too. Session idle timeout is SESSION_TIMEOUT=30m. Set SESSION_COOKIE_SECURE=true behind HTTPS; local HTTP development uses false. Session cookies are HttpOnly/SameSite=Lax. Writes require X-CSRF-TOKEN; do not disable CSRF to fix a client error.

Task limits can be tightened with APP_TASKS_MAX_PAGE_SIZE (20–100, preserving the default page size) and APP_TASKS_MAX_BATCH_SIZE (1–100). The DTO/transport hard ceilings remain 100; raising them requires a reviewed contract and test update.

node scripts/run.mjs build creates backend/target/task-api-1.0.0.jar and frontend/dist. Run the jar from backend; serve the frontend using a server that forwards /api and /actuator to the backend. Vite preview is not a production API proxy. Configure TLS, proxy trust, migrations and operational monitoring before deployment. Do not expose the legacy stack without a separate production/security review.

Generated runtime data, build outputs, dependencies, reports and credentials are ignored by Git. Golden/reference files contain none of those artifacts. See docs/style.md for change workflow and quality commands.
