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
Deploy commit 6fc37086705375a5ef44f2d25fea3a63f20d44e7.

## Rollback
git revert 6fc37086705375a5ef44f2d25fea3a63f20d44e7

No data migration.

Deliver a follow-up change from this accepted commit.
