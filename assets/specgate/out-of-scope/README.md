# Out-of-Scope Knowledge Base

This directory persists rejected feature requests.

**Purpose**:
- Avoid repeated discussion of rejected features
- Help the AI keep decisions consistent
- Record decision rationale and alternatives

**When to create**:
- Feature requests that are explicitly rejected
- Requirements that do not fit the project's positioning
- Decisions that would break the architecture

**Format**: See [out-of-scope-template.md](../templates/out-of-scope-template.md)

**How to query**:
```bash
# List all rejected features
ls .specgate/out-of-scope/

# Search related records
grep -r "keyword" .specgate/out-of-scope/
```

---

*This directory is managed automatically by the SpecGate triage-brief skill.*
