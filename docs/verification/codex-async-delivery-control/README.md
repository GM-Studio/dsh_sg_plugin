# Codex Async Delivery Control Verification

- Date: 2026-10-22
- Branch: `feat/async-delivery-control`
- Base commit: `5df74a548824344a9179ef1d74dab2f8d5a9c912`
- Requirement:
  `docs/requirements/2026-10-22-codex-async-delivery-control-v2.zh.md`
- Plan: `docs/plans/2026-10-22-codex-async-delivery-control-plan.zh.md`

## Automated Verification

- `npm test`: 330 tests passed, 0 failed.
- `npm run lint`: passed.
- `npm run format:check`: passed.
- `npm pack --dry-run --cache <temporary-cache>`: passed.
- `npm run codex:smoke`: stdio diagnostics passed and advertised 47 tools.
- `git diff --check`: passed.

The focused suites cover:

- durable control events, snapshot recovery and event-chain tamper rejection;
- WorkItem/ExecutionRun state, project leases, heartbeat, interruption and queue
  ordering;
- waiting checkpoints, persisted Codex session IDs and resume after H1 Decision;
- H1/H3 artifact and scope-bound control approval bridge;
- pause/resume/retry/cancel idempotency and stale/replayed Decision rejection;
- TOTP step-up and expiry checks;
- Web pairing, HttpOnly session, CSRF, rate limiting, HTTPS cookie mode and
  sensitive-field redaction;
- Feishu card rendering, webhook validation, timeout/error classification and
  secret/path redaction;
- Notification Outbox deduplication, retry, restart and failure isolation;
- failure, offline, completion and budget AttentionRequest generation;
- DeliveryRecord schema 3 and append-only customer-acceptance receipt.
- project-bound MCP injection, bounded child environment and daemon diagnostics;
- cross-platform file-based graceful stop;
- hash-linked customer acceptance and idempotent delivery receipts;
- Feishu handled/superseded follow-up cards and expiry.

The same 60 focused control-plane tests also passed under WSL/Linux using
Node.js 22:

```text
60 tests, 60 passed, 0 failed
```

Before commit, an isolated detached worktree was created from the staged tree
alone, excluding the unrelated conventions change set. In that clean tree:

- `node --import ./test/setup-temp.mjs --test`: 319 tests passed, 0 failed;
- `npm run lint`: passed;
- `npm run format:check`: passed;
- `npm run pack:check`: passed, 196 package files;
- `npm run codex:smoke`: passed, 47 tools;
- `git diff --check`: passed.

## Browser Verification

A local control daemon was started on `127.0.0.1:43129`, paired through a
one-time fragment token, and verified in the in-app browser.

Observed:

- attention count updated from 0 to 1 after a sample H3 request;
- the attention card displayed reason, result, risk, expiry, revision and
  controlled actions;
- the WorkItems view displayed the durable WorkItem;
- the detail view exposed user-visible result, next owner, heartbeat, collapsed
  Execution details, Evidence/Outcome and controlled management actions;
- the daemon stopped successfully and retained durable state.

## Multi-Surface Feishu Verification

### Windows desktop client

- Located the installed executable at
  `D:\Program Files\feishu\Feishu.exe`.
- The Windows Feishu desktop client launched successfully and exposed one
  targetable main window.
- The client was already authenticated and showed its normal workspace. No
  colleague, customer or group chat was opened or messaged.
- Windows Graphics Capture repeatedly timed out for the Electron client, while
  UI Automation returned the application tree. The desktop client therefore
  passed launch/login/window verification, but element-coordinate automation
  was not available in this run.

### PC Web management

- A fresh local daemon was started on `127.0.0.1:43130`.
- A one-time pairing link was opened at desktop width.
- The paired desktop page showed one H3 AttentionRequest, expiry, revision,
  risk/summary and controlled actions.

### App-style WebView branch

- A separate daemon and fresh one-time pairing token were used on
  `127.0.0.1:43131`.
- The management page was verified at `390x844` with `innerWidth=390` and the
  narrow-screen media query active.
- The H1 attention card, navigation, expiry, revision and actions remained
  usable without horizontal overflow.
- Opening “安全检查并批准” displayed the step-up authentication dialog instead
  of submitting an approval.
- Reloading without the fragment token restored the HttpOnly session, covering
  the App/WebView reopen branch.

### Feishu notification-to-app branch

Executed on 2026-10-22 with a private Feishu test group and custom bot:

- The webhook was transferred through a temporary 0600 local file and was never
  written to the repository or displayed in the final report.
- A real H1 card was delivered and rendered in the Feishu Windows client.
- The card contained the WorkItem, reason, result, risk, expiry, controlled
  actions, secure-link button and the explicit warning that the button is not
  itself approval.
- The same secure link was opened with the one-time pairing token and an isolated
  TOTP secret. H1 `approve` was consumed with `step-up`.
- The WorkItem returned to `QUEUED` with the Decision payload.
- After the retry-boundary checks, a real failed-run card was also delivered and
  rendered.
- The management page reduced its attention count to zero after a Decision and
  hid the decided item from the active queue.

### Final authenticated multi-surface closure

Executed later on 2026-10-22 after the host Codex authentication probe succeeded:

- The host CLI initially rejected the CC Switch model catalog because
  `codex-cli 0.117.0` does not accept the `max` reasoning-effort enum. A
  temporary, read-only compatible catalog removed that test-environment
  blocker; the user's global configuration was not changed.
- A host-identity `codex exec` probe returned `PROBE_OK` through
  `thread.started`, `item.completed` and `turn.completed`.
- A second workspace-write probe returned `PROBE_MINIMAL_OK`. A minimal
  temporary `CODEX_HOME` was required because the full desktop configuration
  loaded unrelated MCP servers into the isolated acceptance project.
- WorkItem `work-b5f9e72ab916ef55` reached a real H1
  `WAITING_FOR_USER` boundary. Feishu accepted the card with HTTP 200 and
  application code 0. The card link was exchanged for a one-time management
  session, TOTP step-up was verified, Decision was consumed, and the WorkItem
  returned to `QUEUED`.
- The daemon automatically resumed the persisted Codex session. The acceptance
  prompt then reached an environment/tool-execution blockage and a second real
  H1 card was delivered. Continued execution crossed the configured model-token
  budget, produced a real `MODEL_TOKEN_BUDGET` AttentionRequest, and delivered a
  `运行预算` card with resume/cancel actions. This confirms abnormal-state
  notification and budget fail-safe behavior rather than false completion.
- WorkItem `work-75e90e85b30365da` executed a no-side-effect completion task.
  Codex completed normally, the `交付结果` card was accepted by Feishu with
  HTTP 200, the card link completed TOTP step-up `accept_delivery`, and the
  WorkItem reached `COMPLETED` with business milestone `DELIVERY_ACCEPTED`.
- The Feishu Windows desktop UI Automation tree rendered the H1, repeated H1,
  budget and completion cards, including reason, decision, actions, expiry and
  secure-action button. Graphics Capture still timed out for the Electron
  client, so automated coordinate clicking remains unverified.

The later Portability and Delivery Closure run replaced that Control-only
acceptance with a real schema 3 DeliveryRecord receipt.

### Portability and delivery closure

Executed after the P8 review:

- The supervisor now launches Codex with `mcp_servers={}` and `plugins={}`,
  then adds only `specgate_control` bound to the WorkItem project. A real
  Windows Codex session called `sg_project_status` through that server and its
  session log contained no `node_repl` or browser MCP call.
- The child environment allowlist excludes the Feishu webhook and MFA secret.
  Unit tests proved both values cannot cross into the Codex process.
- `specgate-control doctor` runs `codex --version` through the same bounded
  environment and reports platform, command, control home and isolation status.
- Web WorkItem creation ignores a caller-supplied `projectRoot`; acceptance also
  uses only the project stored on the authoritative WorkItem.
- WorkItem `work-81127424c67c17f3` ran real Codex against a clean temporary
  project with a schema 3 DeliveryRecord. Codex reached `turn.completed`, called
  `sg_project_status`, and the supervisor linked:
  `delivery-e2e-20261022`
  with record hash
  `4f64a6215143cd0e75530f48e07a45fdab699a5ea465f541d4fd4e72f598d1ee`.
- The completion card exposed `accept_delivery`. Its secure link completed TOTP
  step-up and `POST /api/deliveries/accept` wrote
  `customer-acceptance.json`, changed the DeliveryRecord to
  `customer-accepted`, consumed the Control Decision and completed the WorkItem
  with milestone `DELIVERY_ACCEPTED`.
- Feishu delivered both the original completion card and a second
  `SpecGate · 已处理` follow-up, each with HTTP 200 and provider code 0. The
  desktop UI Automation tree showed “已记录操作：accept_delivery” and “原消息不再
  可操作”.
- The new file-based stop request shut down the final daemon successfully.

Runtime defects found and fixed during this real run:

- the daemon background loop condition prevented automatic queue claiming;
- approved WorkItems without a prior session attempted resume instead of a fresh
  run;
- a reopened Attention key reused revision 1 and collided with the previous
  notification outside the active-window filter;
- decided requests remained visible in the Web attention queue.

The earlier isolated-identity probe produced `thread.started`, but
`CodexSandboxOffline` received HTTP 401 from the model endpoint. The resulting
WorkItem entered an explicit FAILED state and sent a real failure card; it was
never marked complete or delivered. The later host-identity probes resolved the
authentication blocker.

The Feishu desktop client's Electron window did not expose Graphics Capture
geometry, so coordinate automation could not click the card button. The UI
Automation tree was available and confirmed rendering, while the same sent secure
URL was consumed through the controlled management API to finish the Decision
path. Mobile Feishu App delivery remains unexecuted because the management URL was
localhost-only; a phone-reachable HTTPS endpoint is still required.

## Codex Runtime Probe

- Installed CLI: `codex-cli 0.117.0`.
- `codex exec --help` exposes `--json`, `--sandbox` and `--cd`.
- `codex exec resume --help` exposes explicit session resume.
- A real `codex exec --json` probe emitted:

```json
{ "type": "thread.started", "thread_id": "01a16187-ae68-7cb1-830b-b55f8844e36e" }
```

The earlier probe could not complete a model turn because the isolated
`CodexSandboxOffline` identity received HTTP 401 from the model endpoint. Under
the host identity, the probe completed normally. The real H1 Decision path then
created a new ExecutionRun and invoked `codex exec resume` with the persisted
session ID.

## Unexecuted Checks

- A real customer repository acceptance with a customer-owned package was not
  executed; the acceptance receipt was exercised on an isolated schema 3
  DeliveryRecord fixture.
- Mobile Feishu App delivery and card interaction were not executed against a
  phone-reachable HTTPS endpoint.
- Feishu card button coordinate automation was not executed because Windows
  Graphics Capture timed out for the Electron client.
- Production deployment and production data rollback were not attempted.
- macOS daemon lifecycle was not executed.
- A real Codex model turn on Linux was not executed because the installed WSL1
  Node executable needs an explicit loader and the Codex CLI is not available
  there. The Linux control-plane suite itself passed.
- The existing Java/Vue verification matrix was not re-run because this change
  does not alter generated application runtime code.

## Residual Risks

- Generic Feishu webhook bots cannot mutate the original card; the implemented
  fallback is a second idempotent “已处理/已失效” card.
- Customer acceptance and Control Decision share two append-only stores rather
  than one distributed transaction. The acceptance is idempotent and a failed
  Control commit returns an explicit retry instruction.
- The host Codex configuration still supplies model/provider authentication;
  deployments that require stronger isolation should set
  `SPECGATE_CODEX_HOME` to a reviewed minimal home.
- Control events include a full state snapshot per event for simple tamper
  evidence; long-running production histories may need snapshot compaction.
- Web UI uses four-second polling rather than SSE.

## Delivery Boundary

Only a local commit for the async-control change set is included. No push,
archive, merge, deployment or customer delivery has been performed.
