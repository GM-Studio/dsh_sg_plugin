# Add completion percentage to task statistics.

Pilot customer delivery completed with real build and test evidence.

## Included
- AC-RATE

## Verification
- <local-path> -B -ntp -Dtest=TaskStatsApiTest test
- <local-path> Files\nodejs\npm.cmd run test
- <local-path> Files\nodejs\npm.cmd run build

## Known issues
- None

## Upgrade
Deploy commit acb33eaa4932c1d76a91049630ce997c153d64e6.

## Rollback
git revert acb33eaa4932c1d76a91049630ce997c153d64e6

No data migration.

Deliver a follow-up change from this accepted commit.
