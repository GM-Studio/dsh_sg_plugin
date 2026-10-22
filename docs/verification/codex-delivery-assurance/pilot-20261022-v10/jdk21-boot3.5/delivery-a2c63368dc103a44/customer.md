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
Deploy commit 99db4db00c5ec0b56af06934f27d9716baca7a74.

## Rollback
git revert 99db4db00c5ec0b56af06934f27d9716baca7a74

No data migration.

Deliver a follow-up change from this accepted commit.
