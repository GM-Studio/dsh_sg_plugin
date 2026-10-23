# Design

## Binding boundary

`server.js` owns initial root resolution. It classifies the actual plugin root
separately from the fallback cwd and returns `null` when the only candidate is
plugin source/cache. `workflow-tools.js` then keeps a session-level
`projectBound` bit and blocks project mutations until `sg_project_bind` or a
successful create/setup operation rebuilds all bound services.

## Onboarding interaction

`onboarding.js` sends one native elicitation form. The MCP `accept` action is the
confirmation signal. The response parser tolerates the legacy `confirm` field
without rendering that obsolete checkbox. `peer.js` can make a bounded
form-first request when capability advertisement is missing; a real rejection
becomes a structured `WAITING_FOR_USER` result. The draft remains in memory for
continuation and is cleared only by `reset: true`.

## Verification entrypoints

Both `sg_verify` and `sg_project_verify` dispatch to the same helper in
`workflow-tools.js`; this avoids divergent validation or evidence formats. The
project status response names `sg_project_verify` as the preferred next tool
and lists the legacy/general alias. Finalization continues to validate evidence
server-side.

## Golden revisions

Historical matrix records remain immutable. A separate current-revision map
identifies hashes changed after the recorded matrix run and reports them as
pending. The selected frontend is passed through every Golden lookup. No
pending record is promoted to passed by this change.

## Verification strategy

Start with focused protocol, onboarding, project-tool, verification and Golden
tests. Then run the repository-required full suite, lint, formatting check and
pack dry-run. A local MCP smoke must show both verification entrypoints. Host UI
rendering and cache reload are reported separately from source-level proof.
