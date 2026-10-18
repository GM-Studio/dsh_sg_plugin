# Out-of-Scope Knowledge Base Template

**Purpose**: Persist rejected feature requests so they are not discussed repeatedly, and help the AI keep decisions consistent.

**Location**: `.specgate/out-of-scope/*.md`

---

## Template

```markdown
# [Feature Name] - Out of Scope

**Status**: Rejected  
**Date**: YYYY-MM-DD  
**Category**: bug | enhancement | breaking-change  
**Decision by**: Human maintainer | AI during triage

## Summary
<1-2 sentences describing the rejected feature>

## Requested behaviour
<the behaviour the user wanted>

## Why rejected
<the reasons for rejection, explained in detail>

### Technical reasons
- Reason 1
- Reason 2

### Product reasons
- Reason 1
- Reason 2

### Scope reasons
- Outside the project's positioning
- Inconsistent with the maintenance direction
- Adds complexity

## Alternatives suggested
<recommended alternatives>

1. **Option 1**: description + how to use it
2. **Option 2**: description + how to use it

## Related issues
- #123 — related feature request
- #456 — related discussion

## Reconsideration criteria
<under what conditions this would be reconsidered>

- Condition 1
- Condition 2

**Note**: If the conditions above are met, this decision can be re-evaluated.

---

*This feature was evaluated and rejected during triage on YYYY-MM-DD.*
*Decision recorded to avoid repeated discussion.*
```

---

## Usage Guide

### 1. When to Create an Out-of-Scope Record

**Must create**:
- Feature requests that are explicitly rejected
- Requirements that do not fit the project's positioning
- Decisions that would break the architecture
- Requirements beyond the maintenance capacity

**Optional**:
- Deferred implementation (may be considered in the future)
- Needs more discussion

### 2. File Naming Convention

```
.specgate/out-of-scope/
  ├── no-gui-support.md          # No GUI support
  ├── no-legacy-format.md        # No legacy format support
  ├── no-custom-templates.md     # No custom template support
  └── ...
```

**Naming rules**:
- Lowercase letters
- Separate words with `-`
- Describe the rejected content concisely

### 3. Querying Out-of-Scope

When evaluating a new request:

```bash
# Search for related rejected features
grep -r "keyword" .specgate/out-of-scope/

# List all rejected features
ls .specgate/out-of-scope/

# View details of a specific rejected feature
cat .specgate/out-of-scope/no-gui-support.md
```

---

## Examples

### Example 1: Rejecting GUI Support

```markdown
# GUI Support - Out of Scope

**Status**: Rejected  
**Date**: 2026-05-08  
**Category**: enhancement  
**Decision by**: Human maintainer

## Summary
SpecGate will not provide a graphical user interface (GUI); it stays positioned as a pure CLI tool.

## Requested behaviour
Users want to use SpecGate through a web UI or desktop application instead of the command line.

## Why rejected

### Technical reasons
- Adds a large number of dependencies and complexity
- Requires maintaining multi-platform GUI frameworks
- Conflicts with the existing CLI workflow

### Product reasons
- SpecGate is positioned as a tool for AI agents, not an end-user tool
- Target users (developers) are more accustomed to the CLI
- A GUI would drift away from the core value proposition

### Scope reasons
- Outside the project positioning (CLI-first)
- Maintenance cost far exceeds the benefit
- Distracts effort from core feature development

## Alternatives suggested

1. **IDE integration**: Provide a GUI-like experience through IDE plugins
   - VS Code extension
   - DSH integration
   
2. **Wrapper scripts**: Users can build their own GUI wrapper
   - Use the SpecGate CLI as the backend
   - Implement the frontend themselves

## Related issues
- #789 — "Add Web UI for easier usage"

## Reconsideration criteria
**None** — this is a core design decision and will not be reconsidered.

---

*This feature was evaluated and rejected during triage on 2026-05-08.*
*Decision recorded to avoid repeated discussion.*
```

### Example 2: Rejecting Legacy Format Support

```markdown
# Legacy Format Support - Out of Scope

**Status**: Rejected  
**Date**: 2026-05-08  
**Category**: breaking-change  
**Decision by**: Human maintainer

## Summary
SpecGate v2.0 will not continue to support the legacy v1.x configuration format.

## Requested behaviour
Users want v2.0 to be automatically compatible with the v1.x configuration file format.

## Why rejected

### Technical reasons
- Requires maintaining two sets of parsing logic
- The legacy format has known design flaws
- A migration tool is already provided

### Product reasons
- v2.0 is a major version update; breaking compatibility is expected
- The legacy format limits the implementation of new features
- Encourages users to upgrade to the new format

### Scope reasons
- Increases the maintenance burden
- Delays the v2.0 release
- The migration path is already clear

## Alternatives suggested

1. **Migration tool**: Use `specgate migrate` to convert automatically
   ```bash
   specgate migrate --from v1 --to v2
   ```
   
2. **Documentation**: Provide a detailed migration guide
   - See `docs/migration/v1-to-v2.md`

## Related issues
- #234 — "Please support v1 config format in v2"

## Reconsideration criteria
- Within 6 months after the v2.0 release, if the migration rate is < 50%, this may be reconsidered

---

*This feature was evaluated and rejected during triage on 2026-05-08.*
*Decision recorded to avoid repeated discussion.*
```

---

## Best Practices

### Best Practices

**Must do**:

1. Explain the reasons in detail: helps future readers understand the decision context
2. Provide alternatives: do not just say "no", guide toward the right direction
3. State reconsideration criteria clearly: under what conditions the decision would be revisited
4. Link related issues: makes traceability easy
5. Review regularly: check for outdated Out-of-Scope records

**Must not do**:

1. Reject bluntly: "No, we won't do it" (wrong); explain the reasons in detail (correct)
2. Vague reasons: "too complex" (wrong); specify where the complexity lies (correct)
3. Ignore alternatives: leaving the user with no other option
4. Close permanently: leave no possibility of reconsideration (unless it is a core design decision)
5. Isolated records: not linking related discussions and issues

---

## Relationship to Agent Brief

```
Request assessment
  ↓
In scope?
  ├─ Yes → Generate Agent Brief → Implement
  └─ No → Create an Out-of-Scope record → Reject
       ↓
       Record to .specgate/out-of-scope/
       ↓
       Future similar requests can be referenced quickly
```

**Key distinction**:
- **Agent Brief**: what to do (In-Scope)
- **Out-of-Scope**: what not to do (and why)

Both are equally important and are core assets of requirements management.

---

## Version History

- **v1.0** (2026-05-08): Initial version, adapted from OUT-OF-SCOPE.md in mattpocock-skills
