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
Deploy commit d9863e18ac04e90f388b5e85875c0c53fa62bc0c.

## Rollback
git revert d9863e18ac04e90f388b5e85875c0c53fa62bc0c

No data migration.

Deliver a follow-up change from this accepted commit.
