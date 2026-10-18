---
name: sg-skill-improve-architecture
version: 0.1.0
description: "Periodic architecture health checks that proactively control architecture entropy and uncover deep module optimization opportunities"
---

# Improve Codebase Architecture

**Run periodically** (once every 7 days is recommended), or trigger it when debugging reveals architectural problems.

Proactively detect architecture entropy in the codebase and prevent the code from turning into a "Big Ball of Mud".

---

## Core Principle

> **Architecture rots slowly, then all at once.**
> 
> Architecture decay is slow, then suddenly it collapses all at once.

---

## When to Use

### Periodic triggers
- ⏰ Run it proactively once every 7 days
- 📅 After a large feature is merged
- 🔄 Before a refactoring plan begins

### Event triggers
- 🐛 Debugging reveals "no correct test seam" (systematic-debugging Phase 5)
- 📊 Code complexity metrics exceed thresholds (cyclomatic complexity > 10)
- 🧪 Test coverage drops by > 10%
- ⚠️ `specgate doctor` reports that the architecture review is overdue

---

## Core Concepts

### Module

Any unit that has an interface and an implementation:
- Class
- Function
- Service
- Component

### Depth

The amount of behavior behind an interface.

**Deep modules** (high leverage):
- Simple interface (≤ 5 methods)
- Complex internal logic (depth ratio ≥ 10:1)
- Caller-friendly (callers only need to know a few interface methods)
- Concentrated knowledge (related logic is concentrated inside the module)

**Shallow modules** (low leverage):
- Complex interface (> 10 methods)
- Simple internal logic (depth ratio < 5:1)
- Pure pass-through (getter/setter, delegate)
- Scattered knowledge (callers need to understand implementation details)

### Seam

The place where an interface lives, and the point at which the implementation can be replaced.

**Good seams**:
- Clear boundaries
- Mockable
- Swappable implementation

**Bad seams**:
- Tight coupling
- Global state
- Implicit dependencies

---

## Workflow

### Phase 1: Read the Context

**Must read**:
1. `CONTEXT.md` (domain terminology)
2. `.specgate/experiences/decisions/*.md` (architecture decision ADRs)
3. The current codebase structure

**Goal**: Understand the current architectural intent and constraints.

---

### Phase 2: Explore the Codebase and Record Friction Points

**Checklist**:

#### 2.1 Interface Complexity

| Metric | Healthy | Warning | Dangerous |
|------|------|------|------|
| **Number of interface methods** | ≤ 5 | 6-10 | > 10 |
| **Number of parameters** | ≤ 3 | 4-6 | > 6 |
| **Return type** | Single type | Union type | `any` / `unknown` |

**How to check**:
```bash
# Find classes with more than 10 interface methods
grep -r "class.*{" src/ | while read line; do
    # Count methods
    # If > 10, record as a warning
done
```

#### 2.2 Depth Ratio

**Formula**:
```
depth ratio = lines of internal logic / number of interface methods
```

| Depth ratio | Assessment | Action |
|--------|------|------|
| ≥ 10:1 | Deep module (healthy) | Keep |
| 5:1 - 10:1 | Moderate | Monitor |
| < 5:1 | Shallow module (warning) | Consider merging or deleting |

#### 2.3 Test Difficulty

| Difficulty Level | Symptom | Cause |
|---------|------|------|
| **Easy** | Dependencies can be mocked easily | Clear seams |
| **Moderate** | Complex setup required | Partial coupling |
| **Hard** | Cannot be tested in isolation | Tight coupling, global state |

#### 2.4 Deletion Test

**Core question**:
> "Imagine deleting this module — what happens to the complexity?"

| Result | Assessment | Action |
|------|------|------|
| **Complexity disappears** | Shallow module (pure pass-through) | Delete or merge |
| **Complexity reappears in N callers** | Deep module (valuable) | Keep |
| **Complexity partially disappears** | Mixed module | Split |

**Example**:
```typescript
// ❌ Shallow module (complexity disappears after deletion)
class OrderService {
  constructor(private repo: OrderRepository) {}
  
  async createOrder(data: OrderData) {
    return this.repo.create(data);  // Pure pass-through
  }
  
  async getOrder(id: string) {
    return this.repo.findById(id);  // Pure pass-through
  }
}

// ✅ Deep module (complexity reappears in N callers after deletion)
class OrderValidator {
  async validate(order: OrderData): Promise<ValidationResult> {
    // 50 lines of validation logic
    // - Inventory checks
    // - Price calculation
    // - Permission checks
    // - Risk-control rules
    // ...
  }
}
```

---

### Phase 3: Present the List of Deepening Opportunities

**Output format**:

```markdown
## Architecture Deepening Opportunities

### Opportunity 1: Split OrderService

**Files involved**:
- `src/services/OrderService.ts` (250 lines, 15 interface methods)

**Problems**:
- 15 interface methods (healthy threshold ≤ 5)
- Depth ratio 3:1 (healthy threshold ≥ 10:1)
- Test difficulty: Hard (requires mocking 8 dependencies)
- Deletion test: Complexity partially disappears (mixed module)

**Proposed approach**:
Split into 3 deep modules:
1. `OrderCreationService` (creates orders, includes validation logic)
2. `OrderCancellationService` (cancels orders, includes refund logic)
3. `OrderQueryService` (queries orders, includes filtering logic)

**Expected benefits**:
- Interface methods: 15 → 5 + 4 + 6
- Depth ratio: 3:1 → 12:1 + 15:1 + 10:1
- Test difficulty: Hard → Easy

**Risks**:
- Requires updating 12 call sites
- May take 2-3 days to complete

---

### Opportunity 2: Delete UserDelegate

**Files involved**:
- `src/delegates/UserDelegate.ts` (30 lines, 5 interface methods)

**Problems**:
- Pure pass-through to UserRepository
- Depth ratio 2:1 (extremely shallow)
- Deletion test: Complexity disappears completely

**Proposed approach**:
Delete UserDelegate and let callers use UserRepository directly

**Expected benefits**:
- Remove 1 layer of abstraction
- Reduce 30 lines of maintenance cost
- Simplify the call chain

**Risks**:
- Requires updating 8 call sites
- May take 1 day to complete
```

---

### Phase 4: User Confirmation → Grilling Loop

**After presenting the opportunity list**, enter the Grilling loop for each candidate:

```
Opportunity 1: Split OrderService

Let me challenge this proposal:

1. Is this refactor really worth it? (2-3 days of investment)
2. Is there a simpler way? (for example, split only the most complex method)
3. What are the risks? (12 call sites need updating)
4. What happens if we don't do it? (technical debt keeps accumulating)

What do you think?
```

**Wait for user feedback**:
- ✅ User approves → Proceed to Phase 5
- ❌ User rejects → Record the rejection rationale as an ADR
- 🔄 User requests changes → Adjust the proposal

---

### Phase 5: Lock In the Decision

#### If accepted

1. **Create an implementation plan**:
   ```
   Use the writing-plans Skill to create a detailed plan
   ```

2. **Record new terms** (if applicable):
   ```markdown
   # CONTEXT.md
   
   ## Language
   
   ### OrderCreationService
   Deep module responsible for order creation and validation.
   Interface: create(), validate()
   Depth ratio: 12:1
   ```

3. **Record the timestamp**:
   ```bash
   date > .specgate/architecture-review-last.txt
   ```

4. **Generate a report**:
   ```markdown
   # .specgate/architecture-reports/YYYY-MM-DD.md
   
   ## Accepted deepening opportunities
   - Split OrderService (planned)
   
   ## Rejected opportunities
   - None
   
   ## Next review date
   YYYY-MM-DD + 7 days
   ```

#### If rejected

**Record the rejection rationale as an ADR**:

```markdown
# .specgate/experiences/decisions/ADR-XXX-reject-order-service-refactor.md

## Decision

Reject the proposal to split OrderService.

## Context

The architecture review found that OrderService has 15 interface methods and a depth ratio of 3:1.

## Rejection Rationale

1. The current iteration cycle is tight, so 2-3 days cannot be invested
2. OrderService may undergo major changes soon (waiting for new requirements)
3. Test coverage is already 85%, so the risk is manageable

## Re-evaluation Conditions

- When OrderService has more than 20 interface methods
- When the new requirements are clear
- When the next iteration cycle begins

## Date

YYYY-MM-DD
```

---

## Integration with systematic-debugging

### Trigger Condition

**When systematic-debugging Phase 5 finds "no correct test seam"**:

```markdown
## Architecture Problem Record

**Problem**: Cannot write a regression test for token refresh

**Cause**: 
- The refresh logic is tightly coupled to the HTTP client
- Concurrent scenarios cannot be mocked

**Recommendation**: 
- Run the improve-architecture Skill
- Analyze the seam quality of TokenRefreshService
- Consider extracting the refresh logic into an independent module
```

### Workflow

```
Debug a bug
  ↓
Phase 5: Discover there is no correct test seam
  ↓
Record the architecture problem
  ↓
Automatically trigger improve-architecture
  ↓
Analyze: TokenRefreshService has a depth ratio of 2:1
  ↓
Recommend: Extract it into an independent deep module
  ↓
Enter the Grilling loop
  ↓
Implement the refactor
```

---

## Ensuring Periodic Execution

### Option 1: DSH system prompt reminder

The plugin injects a SpecGate status summary into the system prompt (when enabled in `.specgate/config.yaml`). You can add the following to the project's `AGENTS.md`:

```markdown
- Check architecture entropy once every 7 days: read `.specgate/architecture-review-last.txt`, and if it is overdue, recommend running an architecture review.
```

The AI checks this rule on its own before each response; DSH has no `PreToolUse` shell Hook, so do not rely on a Hook script.

### Option 2: specgate doctor check

Record the last review date in the project knowledge assets or `AGENTS.md`, and have `sg-skill-doctor-analysis` check it during a health check:

```text
Check .specgate/architecture-review-last.txt:
- Does not exist → recommend the first architecture review
- Older than 7 days → flag the architecture review as overdue
```

---

## Quick Reference

| Concept | Definition | Health Metric |
|------|------|---------|
| **Deep module** | Simple interface, complex internals | Depth ratio ≥ 10:1 |
| **Shallow module** | Complex interface, simple internals | Depth ratio < 5:1 |
| **Deletion test** | Imagine deleting the module | Complexity should reappear |
| **Seam** | The point where the implementation can be replaced | Clear, mockable |

---

## Real-World Impact

From architecture review sessions:
- Proactively detect entropy: avoid a refactoring crisis 2-3 months later
- Improve testability: test difficulty goes from Hard → Easy
- Improve AI navigability: AI can understand the code structure more easily
- Reduce technical debt: resolve 1-2 problems per review

---

## Related Knowledge Assets

- **Deep module theory**: [BP-vertical-slice-and-deep-module.md](../../.specgate/experiences/best-practices/BP-vertical-slice-and-deep-module.md)
- **Systematic debugging**: [sg-skill-systematic-debugging](../sg-skill-systematic-debugging/SKILL.md)
- **Architecture decisions**: `.specgate/experiences/decisions/*.md`
- **Domain terminology**: `CONTEXT.md`
