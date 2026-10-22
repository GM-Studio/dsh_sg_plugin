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
Deploy commit 038c8490c5c305aaffb944854709f21e9c98c561.

## Rollback
git revert 038c8490c5c305aaffb944854709f21e9c98c561

No data migration.

Deliver a follow-up change from this accepted commit.
