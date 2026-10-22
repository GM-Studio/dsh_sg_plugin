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
Deploy commit 75f662daca9f480c157d42e08ed06d82266a85b0.

## Rollback
git revert 75f662daca9f480c157d42e08ed06d82266a85b0

No data migration.

Deliver a follow-up change from this accepted commit.
