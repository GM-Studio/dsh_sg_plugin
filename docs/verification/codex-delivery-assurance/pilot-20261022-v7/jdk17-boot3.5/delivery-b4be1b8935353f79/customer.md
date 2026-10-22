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
Deploy commit c36d22662b7dc93566e3f3eb4c79dadb369ab4bc.

## Rollback
git revert c36d22662b7dc93566e3f3eb4c79dadb369ab4bc

No data migration.

Deliver a follow-up change from this accepted commit.
