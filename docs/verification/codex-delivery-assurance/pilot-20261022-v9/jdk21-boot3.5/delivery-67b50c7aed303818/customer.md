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
Deploy commit 0884897f239dd8669a9a16026575a26aa715833d.

## Rollback
git revert 0884897f239dd8669a9a16026575a26aa715833d

No data migration.

Deliver a follow-up change from this accepted commit.
