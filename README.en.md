# SpecGate for Codex

Public in-session Skills: `$sg-codex` routes intent, `$sg-codex-env` checks/reuses
and installs missing tools for the selected stack, `$sg-codex-project` prepares
or adopts a project, `$sg-codex-change` handles changes and task controls, and
`$sg-codex-status` reports read-only status. `$sg-codex-setup` remains a preparation
alias. See the [in-session guide](docs/environment-codex.zh.md).

SpecGate is a native Codex plugin for project readiness, asynchronous delivery,
accepted changes, independent verification, delivery records and incremental
redelivery with real subagents, isolated worktrees, executable tests and
auditable MCP state.

[中文](README.md) · [Windows / Linux installation guide (Chinese)](docs/install-config-codex.zh.md) · [Source-loading Quickstart (Chinese)](docs/quickstart-codex-source.zh.md)

## Capabilities

- Initialize a new Java/Vue project or adopt an existing repository without
  recreating it.
- Commit a dirty existing worktree only through an explicit approved file set.
- Use `sg_change` for feature, modify and fix while retaining `sg_change_add`.
- Freeze requirements, ChangeContract and acceptance criteria through H1.
- Run the Test Designer before implementation.
- Run Frontend and Backend implementation serially in isolated worktrees.
- Run frozen tests and real Maven, Vitest, HTTP and runtime verification.
- Format in a dedicated worktree and perform read-only Review on a fixed commit.
- Record commit, AC, environment fingerprint, flaky outcomes and unexecuted
  checks as evidence.
- Create immutable DeliveryRecords, local tags, internal evidence packs and
  customer delivery packs after H3.
- Reuse or invalidate prior acceptance evidence for incremental redelivery.
- Require explicit `push: true`; force push is forbidden.
- Keep WorkItems running in a detached supervisor after MCP, Web and Feishu
  clients disconnect.
- Release H1/H3 execution leases and resume the persisted Codex session after a
  trusted Decision.
- Monitor attention, projects, WorkItems, ExecutionRuns, evidence and Decisions
  in a local Web management UI.
- Send only actionable Feishu notifications. Buttons open an authenticated
  management page and never act as approval by themselves.
- Require TOTP step-up, CAS and artifact binding for high-risk Decisions.
- Separate H3 release approval from customer acceptance in DeliveryRecords.
- Do not deploy production or roll back production data automatically.

## Generated admin scaffold

What `sg_init` generates is not a bare skeleton but a **domain-neutral management
system**, with runnable backend modules built in:

- Backend management APIs for users, roles, departments and menus, fixed under
  `/api/sys/**`.
- A read-only paged audit log and a dashboard summary endpoint.
- CSV import and export for users and roles (validate, template, import, export),
  alongside batch actions, pagination and filtering.
- A Vue 3 admin UI: login, the `AppLayout` shell, a sidebar menu, the dashboard and
  the sys views, defaulting to Chinese (`zh-CN`) with an `en-US` runtime switch.

Generation follows the `com.<company>.<business>` package, Chinese source comments
and the shared response envelope. Generation only writes source, tests and docs: it
does **not** install dependencies, build or start services. Generation is not
verification: a real build, test and run must be performed by a later `sg_verify` in
an environment you authorize, and an unrun or failed command must never be described
as passed.

The scaffold ships an enforceable review baseline, `docs/style.md`. Read it before a
change; the Reviewer treats an unjustified deviation as a finding, and as a blocking
finding when it affects layering, contracts, transactions, security or frontend /
backend consistency.

## Stack

Initialization lets you choose the JDK and frontend framework; the choice is frozen
into `ProjectProfile` (`frontendFramework`, `javaPreset`), later changes work only
within that fact, and a stack mismatch fails closed.

- Backend JDK: JDK 8, 17 or 21 (the default is JDK 8 + Spring Boot 2.7).
- Spring Boot: 2.7.x and 3.5.x; plus a JDK 21 + Spring Boot 4.0 preview preset.
- Frontend: Vue 3 (default); React 18 is planned, and selecting React fails closed
  until its template lands.

The frontend scaffold uses Vue 3.5 + Element Plus + vue-router + vue-i18n +
TypeScript. These are the versions the scaffold selects; they do **not** mean any
preset is verified on both Windows and Linux: every preset in `GOLDEN_MANIFEST` is
currently `pending` and is marked `verified` only once the real matrix is re-run on
both platforms.

## Load from source

First confirm that the selected Codex binary supports `codex plugin`. The local
npm CLI 0.117.0 does not support it; the desktop-bundled CLI can differ from the
terminal default. See the [installation guide](docs/install-config-codex.zh.md)
for platform-specific setup and installation checks.

```powershell
cd E:\ai_workflow\specgate
npm ci
codex plugin marketplace add E:\ai_workflow\specgate
codex plugin add specgate-codex@specgate-source
node E:\ai_workflow\specgate\scripts\codex-source-setup.mjs --project <absolute-project-path>
codex -C <absolute-project-path>
```

Ask Codex to follow `AGENTS.md` and the `sg-codex` Skill. See the
[Quickstart](docs/quickstart-codex-source.zh.md) for installation details.

Start the asynchronous control plane separately:

```powershell
npm run codex:control -- status
npm run codex:control -- start --project <absolute-project-path>
```

The start result contains a one-time Web pairing URL. Closing Codex does not stop
the supervisor. Use `npm run codex:control -- stop` to stop it while preserving
WorkItem state.

The control plane runs in one of two modes, and the console exposes a
cross-project portfolio view:

- `aggregate` (default): one shared control home and management port register and
  summarize every project, and the console shows the cross-project attention queue.
- `isolated`: the project gets its own control home under
  `<controlRoot>/projects/<projectId>` and a deterministic per-project port, so it
  never shares MCP configuration, credentials or state with another project.

Control-plane Web sessions and pairing tokens persist to disk
(`web-sessions.json`), so a session stays usable across a restarted control plane
within its TTL, without re-pairing.

Remote mode requires password + TOTP account authentication with device binding;
a pairing link cannot establish a remote management session. Supply the MySQL
configuration, a 256-bit authentication encryption key and a new-device
confirmation code through local environment variables, then provision the owner:

```powershell
$env:SPECGATE_MYSQL_CONFIG = 'C:\secure\specgate-mysql.json'
$env:SPECGATE_AUTH_ENCRYPTION_KEY = '<64 hex chars or 43-char base64url key>'
$env:SPECGATE_AUTH_DEVICE_CONFIRMATION_CODE = '<new-device confirmation code>'
$env:SPECGATE_AUTH_USERNAME = '<owner name>'
$env:SPECGATE_AUTH_PASSWORD = '<owner password>'
npm run codex:control -- auth-init
```

`auth-init` reveals the TOTP enrollment URI/seed once. MySQL stores only a scrypt
password digest, an AES-256-GCM encrypted TOTP seed, and hashed session/CSRF
tokens. High-risk actions consume a one-time proof bound to the action and
resource; notification deep links carry only a short-lived Attention nonce.

Multi-Worker mode reuses the same outbound Worker API. A Worker may declare its
project whitelist, `toolchains`, `labels`, `maxConcurrency`, `region`, `priority`
and skill states at registration or connection time. The control plane applies
project binding, hard capability/region constraints, business priority, deadline,
risk and project fairness. A project still has only one active lease; timeout
takeover issues a new fencing token and rejects the old Worker's renew, waiting and
finish requests. Reconnect replays are deduplicated by `eventId`/`dedupeKey` in the
durable event ledger, while Decision cursors advance independently. Multi-host
pressure tests and real network-partition drills must still run in the target
environment and cannot be replaced by local controlled tests.

Use `npm run codex:control -- doctor --project <absolute-project-path>` before
starting on a new host. Besides the Codex `--version` check, `doctor` runs a
read-only, non-interactive, bounded capability probe of the host Codex (`plugin`,
`exec --json`, native subagents, elicitation), reporting each as `available`,
`missing` or `not-probed` together with the effective mode, the degradations and an
upgrade hint. A missing capability is never silent: no `plugin` degrades to the
project-level MCP + skill path, missing elicitation keeps interactive gates pending,
and `not-probed` is treated as unavailable. The supervisor also clears unrelated
user MCP servers, injects only the project-bound SpecGate MCP, excludes control-plane
credentials from the child environment, and uses a cross-platform stop request.

## Layout

```text
plugin.json / mcp.json                 portable plugin entry
.codex-plugin/ / .mcp.json             compatibility manifests
skills/                                sg-codex and setup Skills
assets/codex/                          six project Agent templates
assets/java-vue/template/              generated Java/Vue baseline
src/codex/                             MCP server and workflow services
src/codex/core/                        shared state, verification and Java tooling
src/codex/control/                     WorkItems, supervisor, Decision and Outcome
src/codex/management/                  local management API and Web UI
src/codex/channels/                    Feishu notifications and Outbox
scripts/codex-source-setup.mjs         project Agent installer
scripts/specgate-control.mjs           control daemon CLI
scripts/codex-plugin-smoke.mjs         packaged MCP smoke check
scripts/verify-codex-matrix.mjs        real Java/Vue preset matrix
test/codex-*.test.js                   focused Codex regressions
```

This branch contains the Codex plugin runtime only, with no legacy host entry
point or compatibility directories.

## Verification

MySQL integration tests are mandatory rather than silently skipped. Point
`SPECGATE_MYSQL_TEST_CONFIG` to a local connection JSON file, or place the same
configuration in the ignored `.runtime/mysql-test/config.json`. Missing real
MySQL fails the suite explicitly. The test account should only create and drop
random `sg_*` databases and must never target a production database.

```powershell
npm test
npm run lint
npm run format:check
npm run pack:check
npm run codex:smoke
npm run codex:control -- help
```

## License

MIT
