# Project onboarding and verification specification

## Requirement: safe session project binding

- An explicit `--project-root` business directory wins over environment and MCP
  roots.
- A host-provided business directory may be read from supported environment
  keys or `roots/list`.
- A plugin source/cache directory is never reported as the bound business
  project. If no business root is available, status reports an unbound session
  and only binding/setup/create/status operations are allowed.

## Requirement: form-first creation

- `sg_project_create` attempts native MCP elicitation whenever a trusted local
  identity and peer request channel exist, including hosts that implement the
  request but omit the capability flag.
- Submitting the form is the initialization confirmation; no second checkbox is
  required.
- Cancellation writes nothing and the next invocation attempts the form again.
- When native elicitation is rejected, the result stays `WAITING_FOR_USER` and
  includes a structured fallback form. Text fallback is not used before the
  native attempt.
- Stack and path selections survive environment/preflight failures unless the
  user explicitly requests reset.

## Requirement: honest template and project verification

- A known current template revision with no new matrix run is reported as
  `awaiting-verification`, not as an unknown hash mismatch and not as passed.
- Frontend-specific hashes are compared with the selected frontend record.
- `sg_verify` remains available. `sg_project_verify` is an equivalent
  project-scoped entrypoint using the same implementation and evidence format.
- Successful verification writes `.specgate/codex-verify-report.json`; status
  advertises the next callable verification tool.
- `sg_project_finalize_new` refuses to create a ProjectBaseline unless current,
  complete server-validated verification evidence exists.

## Requirement: cache-safe release identity

- All portable manifests and package metadata use the same new version so a
  host creates a fresh plugin cache instead of reusing 0.3.2.
