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
Deploy commit 081960a67cb24bbfcdf06456d4e5c78e6f21319d.

## Rollback
git revert 081960a67cb24bbfcdf06456d4e5c78e6f21319d

No data migration.

Deliver a follow-up change from this accepted commit.
