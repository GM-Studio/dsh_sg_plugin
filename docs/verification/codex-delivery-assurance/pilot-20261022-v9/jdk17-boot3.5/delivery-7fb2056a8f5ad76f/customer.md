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
Deploy commit 2cf5192376c9b722a5bfaa90d349397674c28bae.

## Rollback
git revert 2cf5192376c9b722a5bfaa90d349397674c28bae

No data migration.

Deliver a follow-up change from this accepted commit.
