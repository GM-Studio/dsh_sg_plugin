# Design

## Owned Temporary Directories

Runtime helpers create a unique directory with `fs.mkdtempSync` and return an
idempotent cleanup function. Cleanup is restricted to the exact path returned
by that creation call and uses bounded retries for Windows file-handle races.
Callers capture the operation result, run cleanup unconditionally, and then
rethrow any operation or cleanup error so success and error paths are equivalent.

## Test Process Ownership

The first process loading `test/setup-temp.mjs` creates a run directory below
`<system-temp>/specgate-codex-tests`, writes an ownership marker, exports its
path through `SPECGATE_TEST_TEMP_ROOT`, and redirects `TEMP`, `TMP` and
`TMPDIR`. Test-spawned npm commands also receive a cache below the same run
directory. Node test workers inherit those values and reuse the directory
instead of creating one directory per worker.

At startup, only marked children of `specgate-codex-tests` are considered for
recovery. A directory whose recorded owner process is still alive is retained;
an unmarked directory is never deleted. The owner removes its run directory on
exit or a termination signal. If cleanup cannot complete, the failure is made
visible and a later test run retries it.

## Long-running Scripts

The matrix verifier and delivery pilot keep their durable reports under the
explicit output directory. Their generated project workspaces are wrapped in
the shared lifecycle helper and removed before returning or rethrowing, including
when project generation or verification throws. Reports keep a workspace identifier for
auditability and record when cleanup completed, but never depend on the
workspace remaining present.
