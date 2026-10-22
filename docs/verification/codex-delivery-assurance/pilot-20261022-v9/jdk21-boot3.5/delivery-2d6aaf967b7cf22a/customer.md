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
Deploy commit 4272323ac0352452af2cbd1f96f195a81ef5a3af.

## Rollback
git revert 4272323ac0352452af2cbd1f96f195a81ef5a3af

No data migration.

Deliver a follow-up change from this accepted commit.
