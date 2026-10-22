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
Deploy commit 8f3b47f943c3ba52da9509e112ed8e31fd9e6ffa.

## Rollback
git revert 8f3b47f943c3ba52da9509e112ed8e31fd9e6ffa

No data migration.

Deliver a follow-up change from this accepted commit.
