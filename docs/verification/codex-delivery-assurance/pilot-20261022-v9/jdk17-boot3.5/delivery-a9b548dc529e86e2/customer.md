# Add completion percentage to task statistics.

Pilot customer delivery completed with real build and test evidence.

## Included
- AC-RATE

## Verification
- <local-path> -B -ntp spotless:apply
- <local-path> -B -ntp -Dtest=TaskStatsApiTest test
- <local-path> Files\nodejs\npm.cmd run test
- <local-path> Files\nodejs\npm.cmd run build

## Known issues
- None

## Upgrade
Deploy commit 59fcda970824f3f9463ffa877dd8ff3de726b542.

## Rollback
git revert 59fcda970824f3f9463ffa877dd8ff3de726b542

No data migration.

Deliver a follow-up change from this accepted commit.
