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
Deploy commit 8472cdaf04e6fb72292a45e42f256a614ba97dd8.

## Rollback
git revert 8472cdaf04e6fb72292a45e42f256a614ba97dd8

No data migration.

Deliver a follow-up change from this accepted commit.
