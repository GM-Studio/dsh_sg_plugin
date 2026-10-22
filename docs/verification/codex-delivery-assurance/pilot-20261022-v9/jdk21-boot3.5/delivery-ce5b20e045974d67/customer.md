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
Deploy commit 45aa75e759e30563c0ad382d27608467fbc91a9e.

## Rollback
git revert 45aa75e759e30563c0ad382d27608467fbc91a9e

No data migration.

Deliver a follow-up change from this accepted commit.
