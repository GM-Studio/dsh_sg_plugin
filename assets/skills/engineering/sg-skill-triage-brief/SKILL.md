---
name: sg-skill-triage-brief
version: 0.1.0
description: "Task Brief - generate structured task instructions for Agents, clarifying goal/scope/deliverables"
---

# sg-skill-triage-brief

**Classification**: Requirements management
**Type**: Process
**Priority**: 🟡 Recommended
**Trigger timing**: During requirements assessment

---

## Definition

A structured requirements assessment skill that generates an Agent Brief and manages the Out-of-Scope knowledge base.

---

## When to use

### Must use

- ✅ After requirements definition is complete (requirements-definition)
- ✅ After critical-review passes
- ✅ When assessing whether a feature is within project scope
- ✅ When task boundaries must be made explicit

### Trigger scenarios

**The user says**:
- "Are we doing this feature or not?"
- "Help me assess this requirement"
- "Is this requirement in scope?"
- "Generate an Agent Brief"
- "Why aren't we doing XXX?"

---

## 🚫 Pre-check: AI must not skip the Brief (hard rule)

> **Added 2026-05-14**, to fix the missing-Brief problem—the AI judges on its own that "no Brief is needed" and skips it without telling the user.
> **Companion**: `.specgate/templates/rules/workflow-state.md` "Brief gate" + `.specgate/workflow-rules.yaml` `brief-generation-gate`

**Trigger condition**: tasks.md is fully complete and the change size meets the Brief generation condition (effort > 2h / cross-module ≥ 2 / file count > 3 / interface change).

### Mandatory behavior

1. If the change size exceeds the threshold → you must call `sg-skill-triage-brief` to generate the Brief
2. ❌ The AI must not judge on its own that "no Brief is needed" and skip it
3. ❌ The AI must not skip the Brief without telling the user
4. ❌ The AI must not skip the Brief without recording a deviation
5. Skipping the Brief requires: a) stating the reason; b) explicit user approval; c) recording it in `.specgate/deviations.log`

### Correct behavior

```
> "The current change meets the Agent Brief generation conditions (task count > 10 / cross-module ≥ 2 / file count > 3).
>  Calling sg-skill-triage-brief to generate the Agent Brief…"
```

### Wrong behavior (red line)

```
> "This change isn't very complex, no Brief needed, let's go straight to review."
```
↑ This is bypassing the Brief gate—the AI judges the complexity on its own and skips the process.

### Skip conditions

**Only the following cases may skip** (deviation must be recorded + user approval):
- Pure defect fix (L3 paradigm)
- Change size clearly below the threshold (single file, < 1h)
- The user explicitly states "no Brief is needed this time"

**May not skip**:
- The AI judges on its own that "the change is simple"
- The AI believes "it has already been explained clearly enough"
- The AI omits the prompt and skips directly

---

## Core concepts

### Agent Brief

Structured task instructions that ensure an AI sub-agent has clear context.

**Contains**:
- Category (bug/enhancement)
- Summary (1-2 sentences)
- Current behaviour (current behavior)
- Desired behaviour (desired behavior)
- Key interfaces (core interfaces)
- Acceptance criteria (acceptance criteria)
- Out of scope (explicitly excluded)
- Reference files (reference files)

**Value**:
- ✅ Clear requirements, fewer misunderstandings
- ✅ Clear boundaries, avoiding scope creep
- ✅ Verifiable, with acceptance criteria

### Out-of-Scope knowledge base

Persistently records rejected feature requests.

**Location**: `.specgate/out-of-scope/*.md`

**Value**:
- ✅ Avoids repeated discussion
- ✅ Keeps decisions consistent
- ✅ Records the rationale for decisions

---

## Workflow

### Phase 1: Assess the requirement

1. Read the requirement description
2. Check `.specgate/out-of-scope/` for related records
3. Assess whether it is within project scope

### Phase 2: Decide

**In scope**:
→ Generate an Agent Brief

**Not in scope**:
→ Create an Out-of-Scope record
→ Tell the user and explain the reason

### Phase 3: Generate the Brief (in scope)

1. Fill in the Brief template
2. Ensure the Acceptance criteria are verifiable
3. Make Out of scope explicit
4. **Run the information-loss check** (critical!)
5. Show the Brief to the user for confirmation

### Phase 3.5: Information-loss check (critical step)

**Goal**: Ensure no key information from the requirements document is lost while generating the Brief

**Check process**:

#### Step 1: Extract the key information points of the requirements document

Extract the following list of information points from the requirements document:

```markdown
Requirements document key information list:
1. Functional requirements list (P0/P1/P2)
2. Success criteria (specific metric values)
3. Constraints (technical, security, compliance)
4. Edge cases (all identified edges)
5. Out of scope (features explicitly excluded)
6. Key business rules (e.g. approval amount tiers)
7. Integration requirements (systems that must be connected)
8. Performance requirements (response time, concurrency)
9. Data requirements (data volume, storage format)
10. Terminology definitions (relevant terms in CONTEXT.md)
```

#### Step 2: Check item by item whether the Brief covers them

Check every information point:

```markdown
Information-point coverage checklist:

| # | Information point type | Requirements document content | Present in Brief | Critical | Risk if missing |
|---|-----------|------------|-------------|---------|---------|
| 1 | P0 functional requirement | User registration | ✅ Present | Yes | None |
| 2 | P1 functional requirement | OAuth2 login | ✅ Present | Yes | None |
| 3 | Success criterion | Response time < 200ms | ✅ Present (Constraints) | Yes | None |
| 4 | Constraint | GDPR compliance | ✅ Present (with rationale) | Yes | None |
| 5 | Edge case | Forgot-password flow | ❌ Missing | Yes | 🔴 High |
| 6 | Out of scope | SMS login | ✅ Present | Yes | None |
| 7 | Business rule | Approval amount tiers | ❌ Missing | Yes | 🔴 High |
| 8 | Integration requirement | Logistics system interface | ❌ Missing | No | 🟡 Medium |
```

#### Step 3: Assess the risk of missing items

**Risk level definitions**:

- 🔴 **High risk**: the AI implementation may be wrong
  - Key business rules missing
  - Edge-case handling strategy missing
  - Out of scope incomplete
  
- 🟡 **Medium risk**: the AI may omit part of the functionality
  - P1/P2 functional requirements missing
  - Integration requirements missing
  - Performance metrics missing
  
- 🟢 **Low risk**: does not affect implementation, only context is missing
  - Background discussion details
  - User persona descriptions
  - Alternative-option analysis

#### Step 4: Handle high- and medium-risk gaps

**Rules**:

- 🔴 **High-risk gap** → **must be added to the Brief**
- 🟡 **Medium-risk gap** → ask the user whether to add it
- 🟢 **Low-risk gap** → acceptable (intentional trimming)

**Actions**:

```markdown
If a high-risk gap is detected:
1. Automatically add it to the corresponding section of the Brief
2. Mark it "This content was automatically added from the requirements document"
3. Continue checking until there are no high-risk gaps

If a medium-risk gap is detected:
1. Show the gap list to the user
2. Ask: "The following medium-risk information points are not in the Brief. Should they be added?"
3. Add or skip based on the user's decision
```

#### Step 5: Generate the check report

**Format**:

```markdown
## Brief Information-Loss Check Report

**Requirements document**: docs/requirements/2026-05-11-user-auth-requirements.md
**Brief**: .specgate/briefs/user-authentication.md
**Check time**: 2026-05-11 14:30

### Statistics
- Total information points: 10
- Covered: 7 (70%)
- High-risk gaps: 0 ✅
- Medium-risk gaps: 1 ⚠️
- Low-risk gaps: 2 ℹ️

### High-risk gaps (auto-added)
None

### Medium-risk gaps (awaiting user confirmation)
1. Integration requirement: logistics system interface
   - Requirements document: "Must integrate the logistics system's order-interception interface"
   - Brief status: not included
   - Suggestion: add to Key interfaces
   - User decision: [pending confirmation]

### Low-risk gaps (acceptable)
1. Background discussion: user research data (80% of users want email registration)
2. Alternative-option analysis: why JWT instead of Session

### Check conclusion
✅ Passed (no high-risk gaps; medium-risk gaps awaiting user confirmation)
```

---

### Phase 4: Create the Out-of-Scope record (not in scope)

1. Fill in the Out-of-Scope template
2. Explain the rejection rationale in detail
3. Provide alternatives
4. Save to `.specgate/out-of-scope/<feature-name>.md`
5. Tell the user

---

## Relationship to OpenSpec

### Positioning difference

| Dimension | Agent Brief | OpenSpec Spec |
|------|------------|---------------|
| **Focus** | What (what to build) | How (how to design it) |
| **Content** | Requirement summary, acceptance criteria, boundaries | Technical approach, interface design, data model |
| **Audience** | AI Agent (implementer) | Developers + AI Agent |
| **Generation timing** | After requirements approval | After Brief confirmation |
| **Storage location** | `.specgate/briefs/` | `openspec/specs/` |

### Collaboration flow (full version)

```
Requirements constitution document
  ↓
triage-brief generates the Brief
  ↓ focuses on What + Acceptance
  ↓
Brief confirmed by the user
  ↓
/sg-propose generates the Spec skeleton
  ↓ focuses on How + Design
  ↓
Spec confirmed by the user
  ↓
⭐ Prototype validation (optional, for complex changes)
  ├─ Validate the design decisions in design.md
  ├─ Validate the feasibility of the requirements in specs/
  └─ Record in NOTES.md
  ↓
Update the Spec based on the prototype conclusions (if needed)
  ↓
Implementation phase (based on the validated Brief + Spec)
```

**Prototyping is optional**:
- Simple changes: implement directly after Spec confirmation
- Complex changes: after Spec confirmation, validate with a prototype, then implement

### Key principles

1. **The Brief precedes the Spec**: the Spec must reference the corresponding Brief
2. **The Brief is fixed, the Spec is flexible**: the Brief is the requirements baseline, the Spec is the technical implementation (adjustable)
3. **The Brief is short, the Spec is detailed**: the Brief is 1-2 pages, the Spec can be several pages
4. **The Brief uses user language, the Spec uses technical language**: the Brief uses business terms, the Spec uses technical terms

### Example relationship

**Brief** (`.specgate/briefs/user-authentication.md`):
```markdown
Summary: Implement user login, supporting email/password and OAuth2
Acceptance: Given the user enters valid credentials, When they click login, Then they are redirected to the home page
Out of scope: No SMS login, no multi-factor authentication
```

**Spec** (`openspec/specs/user-authentication/`):
```markdown
- spec.md: JWT token design, OAuth2 flow, database table structure
- tasks.md: implementation task breakdown (10 tasks)
- design.md: sequence diagrams, class diagrams, error-handling strategy
```

---

## Decision matrix

### Scope assessment

| Condition | Decision | Explanation |
|------|------|------|
| **Fits the project positioning** | In-Scope | Generate an Agent Brief |
| **Beyond the project positioning** | Out-of-Scope | Record the rationale |
| **Breaks the architecture** | Out-of-Scope | Explain the reason |
| **Maintenance cost too high** | Out-of-Scope | Quantify the cost |
| **An alternative exists** | Out-of-Scope | Point to the alternative |

### Brief quality check

| Check item | Standard |
|--------|------|
| **Summary** | Can be stated clearly in 1-2 sentences |
| **Current/Desired** | Behavioral comparison is clear |
| **Acceptance criteria** | Verifiable (not subjective) |
| **Out of scope** | Explicitly excludes boundaries |
| **Reference files** | Paths are accurate |

---

## AI marker

All AI-generated comments and Briefs **must** be labeled with their source:

```
> *This brief was generated by AI during triage.*
```

Or in Chinese:

```
> *This Brief was generated by AI during requirements assessment.*
```

---

## Relationship to requirements-grilling

```
Requirements raised
  ↓
requirements-grilling (grilling and clarification)
  ↓
Requirements clear?
  ├─ Yes → triage-brief (generate the Brief)
  └─ No → continue grilling
  ↓
Brief confirmed
  ↓
Implementation
```

**Difference**:
- **requirements-grilling**: grilling and clarification, ensuring the requirements are understood
- **triage-brief**: structured recording, ensuring the requirements are executable

---

## Usage examples

### Example 1: Assess a new feature

**User**: "I want to add Web UI support"

**AI**:
1. Check `.specgate/out-of-scope/` → find `no-gui-support.md`
2. Tell the user: "This feature has already been rejected, because..."
3. Offer an alternative: "We recommend providing it through IDE integration"

### Example 2: Generate a Brief

**User**: "Fix the Windows compatibility issue in template path resolution"

**AI**:
1. Assess → in scope (bug fix)
2. Generate an Agent Brief
3. Show the Brief for confirmation:
   ```markdown
   # Agent Brief: Fix the Windows compatibility issue in template path resolution
   
   ## Category
   bug
   
   ## Summary
   Template rendering fails on path resolution under Windows...
   
   ## Acceptance criteria
   - [ ] Path resolution is correct on Windows
   - [ ] Path resolution is correct on Linux
   - [ ] All tests pass
   ```
4. Wait for user confirmation

### Example 3: Record an Out-of-Scope item

**User**: "Support a GUI"

**AI**:
1. Assess → not in scope (beyond the project positioning)
2. Create `.specgate/out-of-scope/no-gui-support.md`
3. Tell the user:
   ```
   This feature is out of scope for SpecGate.
   
   Reason:
   - SpecGate is a CLI tool, not an end-user tool
   - It would add a lot of complexity
   
   Alternative:
   - Provide a similar experience through IDE integration
   ```

---

## References

- **Brief template**: [agent-brief-template.md](../../../../specgate/templates/agent-brief-template.md)
- **Out-of-Scope template**: [out-of-scope-template.md](../../../../specgate/templates/out-of-scope-template.md)
- **Requirements grilling**: [sg-skill-requirements-grilling](../sg-skill-requirements-grilling/SKILL.md)

---

## Version history

- **v1.0** (2026-05-08): initial version, a trimmed version borrowing from mattpocock-skills' triage Skill
