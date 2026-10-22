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
Deploy commit d78d39c303a0fc143f75397863453342f88f76bc.

## Rollback
git revert d78d39c303a0fc143f75397863453342f88f76bc

No data migration.

Deliver a follow-up change from this accepted commit.
