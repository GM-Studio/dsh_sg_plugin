# Codex Temporary Workspace Lifecycle

## Why

SpecGate tests and long-running verification scripts create large temporary
workspaces. The current test bootstrap only removes its directory on a clean
process exit, while matrix and delivery pilot workspaces are retained even
after their evidence has been copied. Interrupted runs therefore accumulate
millions of files in the operating-system temporary directory and eventually
degrade Windows startup and general filesystem performance.

## What Changes

- Put each test invocation below one SpecGate-owned temporary root and make all
  test workers reuse it.
- Remove the owned root on normal, failing and signalled exits, and scavenge
  safely identified leftovers on the next run.
- Add a shared temporary-directory lifecycle helper with bounded, cross-platform
  cleanup retries.
- Make matrix verification and delivery pilot workspaces temporary on both
  success and failure while preserving their durable evidence directories.
- Add regression coverage for cleanup after success, exceptions and stale-run
  recovery.

## Non-goals

- Delete arbitrary files from the user's temporary directory.
- Treat reusable tool or dependency caches as disposable workspaces.
- Automatically purge historical directories that cannot be proven to belong
  to the new managed-root scheme.
