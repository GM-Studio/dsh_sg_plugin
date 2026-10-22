# Add task completion statistics.

Pilot customer delivery completed with real build and test evidence.

## Included
- AC-STATS

## Verification
- <local-path> -B -ntp spotless:apply
- <local-path> -B -ntp -Dtest=TaskStatsApiTest test
- <local-path> Files\nodejs\npm.cmd run test
- <local-path> Files\nodejs\npm.cmd run build

## Known issues
- None

## Upgrade
Deploy commit f48764f3a8414d8e90830c59e28d0f3fb9b62a04.

## Rollback
git revert f48764f3a8414d8e90830c59e28d0f3fb9b62a04

No data migration.

Deliver a follow-up change from this accepted commit.
