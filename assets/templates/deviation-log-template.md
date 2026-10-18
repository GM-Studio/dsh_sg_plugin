# Deviation Log Template

## Deviation Record Format

Whenever the standard workflow is deviated from, record it in `.specgate/deviations.log` using the following format:

```yaml
- timestamp: "ISO 8601 timestamp"
  session: "session ID (if any)"
  deviation: "description of the deviation"
  rule_violated: "rule that was violated (if any)"
  reason: "reason for the deviation"
  impact: "low|medium|high"
  user_approval: true|false
  alternatives_considered: "alternatives considered (optional)"
  mitigation: "mitigation measures (optional)"
```

## Example Records

```yaml
- timestamp: "2025-05-03T10:30:00Z"
  session: "abc123"
  deviation: "Skipped requirements-grilling and wrote code directly"
  rule_violated: "Use requirements-grilling before starting creative work"
  reason: "User asked for a quick implementation of a simple feature (single-line configuration change)"
  impact: "low"
  user_approval: true
  alternatives_considered: "Quick requirements-grilling (5 minutes)"
  mitigation: "Add the design document afterwards"

- timestamp: "2025-05-03T11:15:00Z"
  session: "abc123"
  deviation: "Implemented without writing tests"
  rule_violated: "Do not commit without tests"
  reason: "Third-party library API call, hard to write unit tests for"
  impact: "medium"
  user_approval: true
  alternatives_considered: "Use a mock framework"
  mitigation: "Add integration test coverage"

- timestamp: "2025-05-03T14:20:00Z"
  session: "def456"
  deviation: "Started writing code without a Spec"
  rule_violated: "Do not write code without a Spec"
  reason: "Urgent bug fix; the user asked for immediate action"
  impact: "high"
  user_approval: true
  alternatives_considered: "Create a quick Spec (10 minutes)"
  mitigation: "Write the Spec document after the fix"
```

## Deviation Statistics

Review deviation records regularly to identify process improvement opportunities:

```bash
# View recent deviations
tail -n 50 .specgate/deviations.log

# Count deviations by impact level
grep "impact:" .specgate/deviations.log | sort | uniq -c

# View the most frequent deviation reasons
grep "reason:" .specgate/deviations.log | sort | uniq -c | sort -rn | head -10
```

## Review Recommendations

Review the deviation log weekly or once per sprint:

1. **Frequent deviations**: Which rules are violated often? Do they need adjustment?
2. **High-impact deviations**: Which deviations caused real problems?
3. **User feedback**: Does the user consider some rules too strict?
4. **Process improvements**: Can deviations be reduced through tooling or automation?
