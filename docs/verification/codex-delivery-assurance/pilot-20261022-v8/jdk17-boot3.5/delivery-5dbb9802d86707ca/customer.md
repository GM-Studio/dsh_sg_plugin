# Fix zero-task completion percentage regression.

Pilot customer delivery completed with real build and test evidence.

## Included
- AC-ZERO

## Verification
- <local-path> -B -ntp -Dtest=TaskStatsApiTest test
- <local-path> Files\nodejs\npm.cmd run test
- <local-path> Files\nodejs\npm.cmd run build

## Known issues
- None

## Upgrade
Deploy commit 5f1fa0acb406fa7f4be233162b339b4bfa85528a.

## Rollback
git revert 5f1fa0acb406fa7f4be233162b339b4bfa85528a

No data migration.

Deliver a follow-up change from this accepted commit.
