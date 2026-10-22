# Add task completion statistics.

Pilot customer delivery completed with real build and test evidence.

## Included
- AC-STATS

## Verification
- <local-path> -B -ntp -Dtest=TaskStatsApiTest test
- <local-path> Files\nodejs\npm.cmd run test
- <local-path> Files\nodejs\npm.cmd run build

## Known issues
- None

## Upgrade
Deploy commit 788b46e3795a0fda1b1af29ea4b46cf95c786574.

## Rollback
git revert 788b46e3795a0fda1b1af29ea4b46cf95c786574

No data migration.

Deliver a follow-up change from this accepted commit.
