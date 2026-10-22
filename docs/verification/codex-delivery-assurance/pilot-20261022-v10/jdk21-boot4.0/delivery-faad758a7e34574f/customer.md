# Fix zero-task completion percentage regression.

Pilot customer delivery completed with real build and test evidence.

## Included
- AC-ZERO

## Verification
- <local-path> -B -ntp spotless:apply
- <local-path> -B -ntp -Dtest=TaskStatsApiTest test
- <local-path> Files\nodejs\npm.cmd run test
- <local-path> Files\nodejs\npm.cmd run build

## Known issues
- None

## Upgrade
Deploy commit 9c73be215faa8449235e52426219be76459acb7e.

## Rollback
git revert 9c73be215faa8449235e52426219be76459acb7e

No data migration.

Deliver a follow-up change from this accepted commit.
