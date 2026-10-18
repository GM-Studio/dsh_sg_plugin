# Code Review Checklist

> **Purpose**: Checklist used by sg-agent-reviewer when performing code review  
> **Two-layer mechanism**: Layer 1 quick check (mandatory) + Layer 2 deep check (on demand)  
> **Reference**: [Refactoring Best Practices](../../../../.specgate/experiences/best-practices/BP-refactoring-improving-existing-code.md)

---

## Layer 1: Quick Checklist (Mandatory)

**Goal**: Complete within 5-10 minutes, catching obvious problems.

### P0 - Blocking Issues (Must Fix)

| # | Check Item | How to Check | Pass Criteria |
|---|------------|--------------|---------------|
| 1 | **Functional completeness** | Compare against requirements/Spec | All requirement points implemented |
| 2 | **Test coverage** | Run the test suite | All tests pass, core logic is tested |
| 3 | **Security vulnerabilities** | Check input validation, permission checks | No injection risk, sensitive data protected |
| 4 | **Obvious bugs** | Check logic, boundary conditions | No logic errors, boundary conditions handled |

**Quick check methods:**
```bash
# Run tests
npm test

# Check the scope of changes
git diff --stat {BASE_SHA}..{HEAD_SHA}

# Check test coverage
npm run test:coverage
```

**Decision criteria:**
- ❌ Any item fails → **Critical**, must fix
- ✅ All pass → Continue to P1 checks

---

### P1 - Important Issues (Should Fix)

| # | Check Item | How to Check | Pass Criteria | Threshold to Trigger Layer 2 |
|---|------------|--------------|---------------|------------------------------|
| 1 | **Error handling** | Check exception handling and error returns | Exceptions properly caught and handled | - |
| 2 | **Type safety** | Check type definitions and type conversions | Types accurate, no implicit conversions | - |
| 3 | **Clear naming** | Check function/variable names | Names express "what it does" rather than "how it does it" | - |
| 4 | **Code duplication** | Check for duplicated code blocks | No obvious copy-paste (rule of three) | Duplication > 3 places |
| 5 | **Function length** | Check function line count | Function ≤ 50 lines (except special cases) | Function > 100 lines |
| 6 | **Nested conditions** | Check if-else nesting depth | Nesting ≤ 2 levels | Nesting > 3 levels |
| 7 | **Parameter count** | Check the number of function parameters | Parameters ≤ 4 | Parameters > 6 |

**Quick check methods:**
```bash
# Find duplicated code (manual review)
grep -n "duplicated code snippet" src/**/*.ts

# Find overlong functions
# Manually review functions > 50 lines

# Find magic numbers
grep -n "[0-9]\{2,\}" src/**/*.ts | grep -v "const\|//\|*"
```

**Decision criteria:**
- ⚠️ 1-2 issues found → **Important**, should fix
- ⚠️ More than 3 issues found → Record all issues, continue to P2 checks
- ⚠️ "Threshold to trigger Layer 2" reached → Mark the clue and recommend a deep check in the review report
- ✅ No issues or only a few acceptable issues → Continue to P2 checks

---

### P2 - Improvement Suggestions (Record for Later Handling)

| # | Check Item | How to Check | Pass Criteria | Threshold to Trigger Layer 2 |
|---|------------|--------------|---------------|------------------------------|
| 1 | **Performance risks** | Check loops, queries, resource usage | No obvious performance problems | - |
| 2 | **Complexity** | Check nesting and conditional branches | switch ≤ 5 branches | switch > 8 branches |
| 3 | **Class length** | Check the total line count of the class | Class ≤ 200 lines | Class > 300 lines |
| 4 | **Documentation comments** | Check comments on complex logic | Complex logic has clear comments | - |
| 5 | **Code style** | Check formatting and consistency | Follows the project style guide | - |
| 6 | **Interface design** | Check the get/set method ratio | Has business behavior, not a pure data class | get/set > 10 |
| 7 | **Call chain length** | Check chained object calls | Chaining ≤ 2 levels | Chaining > 3 levels |

**Decision criteria:**
- 💡 Issues found → **Minor**, record them in the technical debt list
- ✅ No issues → Review complete

---

## When to Escalate to a Layer 2 Deep Check

**Trigger conditions (any one is sufficient):**

| Clue | Trigger Threshold | P1 Attention Threshold | Possible Problem | Layer 2 Check Path |
|------|-------------------|------------------------|------------------|--------------------|
| Duplicated code | > 3 places | > 2 places | Violates the DRY principle | Path 1: Duplicated code check |
| Nested conditions | > 3 levels | > 2 levels | Arrow code | Path 2: Conditional logic check |
| Function length | > 100 lines | > 50 lines | Responsibilities not singular | Path 3: Function/class responsibility check |
| Class length | > 300 lines | > 200 lines | Oversized class | Path 3: Function/class responsibility check |
| Parameter count | > 6 | > 4 | Long parameter list | Path 4: Interface design check |
| switch branches | > 8 branches | > 5 branches | Complex conditional logic | Path 2: Conditional logic check |
| get/set methods | > 10 | > 5 | Anemic model | Path 4: Interface design check |
| Call chain length | > 3 levels | > 2 levels | Message chain coupling | Path 5: Coupling and dependency check |

**Execution strategy:**
- **P1 attention threshold**: During P1/P2 checks, mark it as "needs attention" and record it in the review report
- **Layer 2 trigger threshold**: Explicitly recommend "trigger a deep check" in the review report and explain why
- **Reviewer judgment**: The reviewer ultimately decides whether to perform Layer 2 based on context

---

## Layer 2: Deep Checklist (On Demand)

**Goal**: When Layer 1 finds serious clues, analyze code quality in depth.

### Path 1: Duplicated Code Check

**Reference**: [Refactoring Best Practices - Duplicated Code](../../../../.specgate/experiences/best-practices/BP-refactoring-improving-existing-code.md#1-duplicated-code)

**Check items:**

| Check Point | Characteristic | Refactoring Technique |
|-------------|----------------|-----------------------|
| Duplication within the same class | The same code block appears ≥ 2 times | Extract Method |
| Duplication between parent and child classes | Parent and child classes share the same logic | Pull Up Method |
| Duplication across classes | Different classes share the same logic | Extract Class / Extract Superclass |
| Duplication inside conditional branches | Each branch contains the same code | Consolidate Duplicate Conditional Fragments |

**Check method:**
```bash
# Find similar code blocks (manual review)
# Focus on: similar if-else blocks, similar loops, similar data-processing logic
```

**Evaluation criteria:**
- 🔴 Duplicated code makes maintenance difficult → must refactor
- 🟡 Duplicated code with limited impact → refactoring recommended
- 🟢 The duplication is justified (e.g., configuration files) → accept

---

### Path 2: Conditional Logic Check

**Reference**: [Refactoring Best Practices - Complex Conditional Logic](../../../../.specgate/experiences/best-practices/BP-refactoring-improving-existing-code.md#category-4-complex-conditional-logic)

**Check items:**

| Check Point | Characteristic | Refactoring Technique |
|-------------|----------------|-----------------------|
| Nested conditions > 3 levels | Arrow code | Replace Nested Conditional with Guard Clauses |
| switch/case > 5 branches | Switch statements gone bad | Replace Conditional with Polymorphism |
| Duplicated conditional expressions | The same condition appears in multiple places | Consolidate Conditional Expression + Extract Method |
| Control flag variables | Flags such as found/done | Remove Control Flag |

**Check method:**
```typescript
// Bad example: nested conditions
if (user) {
  if (user.isActive) {
    if (user.hasPermission) {
      // business logic
    }
  }
}

// Good example: guard clauses
if (!user) return;
if (!user.isActive) return;
if (!user.hasPermission) return;
// business logic
```

**Evaluation criteria:**
- 🔴 Deep nesting, hard to understand → must refactor
- 🟡 Many conditions but clear logic → optimization recommended
- 🟢 Simple conditions with good readability → accept

---

### Path 3: Function/Class Responsibility Check

**Reference**: [Refactoring Best Practices - Code Bloat and Redundancy](../../../../.specgate/experiences/best-practices/BP-refactoring-improving-existing-code.md#category-1-code-bloat-and-redundancy)

**Check items:**

| Check Point | Characteristic | Refactoring Technique |
|-------------|----------------|-----------------------|
| Overlong function > 50 lines | Takes on multiple responsibilities | Extract Method |
| Oversized class > 300 lines | Violates single responsibility | Extract Class |
| Temporary field | Used only in specific scenarios | Extract Class |
| Over-engineering | Unused abstractions/extension points | Inline Class/Method |

**Check method:**
```bash
# Find large files
find src -name "*.ts" -size +10k

# Find long functions (manual review)
# Focus on: functions containing multiple comment blocks, functions with unclear responsibilities
```

**Evaluation criteria:**
- 🔴 Tangled responsibilities, hard to maintain → must refactor
- 🟡 Many responsibilities but some logic → splitting recommended
- 🟢 Single, clear responsibility → accept

---

### Path 4: Interface Design Check

**Reference**: [Refactoring Best Practices - Function and Interface Design Flaws](../../../../.specgate/experiences/best-practices/BP-refactoring-improving-existing-code.md#category-5-function-and-interface-design-flaws)

**Check items:**

| Check Point | Characteristic | Refactoring Technique |
|-------------|----------------|-----------------------|
| Long parameter list > 5 | Hard to call | Introduce Parameter Object |
| Anemic model | Only get/set | Move Method (form a rich domain model) |
| Mixed query and modification | Function has side effects | Separate Query from Modifier |
| Error codes instead of exceptions | return -1 to indicate failure | Replace Error Code with Exception |

**Check method:**
```typescript
// Bad example: long parameter list
function createUser(name: string, email: string, age: number, 
                    address: string, phone: string, role: string) {}

// Good example: parameter object
interface CreateUserParams {
  name: string;
  email: string;
  age: number;
  address: string;
  phone: string;
  role: string;
}
function createUser(params: CreateUserParams) {}
```

**Evaluation criteria:**
- 🔴 Hard-to-use interface, error-prone → must refactor
- 🟡 Usable but inelegant interface → optimization recommended
- 🟢 Clear, easy-to-use interface → accept

---

### Path 5: Coupling and Dependency Check

**Reference**: [Refactoring Best Practices - Excessive Coupling and Dependencies](../../../../.specgate/experiences/best-practices/BP-refactoring-improving-existing-code.md#category-3-excessive-coupling-and-dependencies)

**Check items:**

| Check Point | Characteristic | Refactoring Technique |
|-------------|----------------|-----------------------|
| Divergent change | One class is modified for multiple reasons | Extract Class |
| Shotgun surgery | One requirement changes multiple classes | Move Method + Move Field |
| Feature envy | A function heavily manipulates another class's data | Move Method |
| Long message chain | a.getB().getC().getD() | Hide Delegate |
| Middle man | A class's methods only delegate | Remove Middle Man |

**Check method:**
```bash
# Find long call chains
grep -n "\.get[A-Z].*\.get[A-Z].*\.get[A-Z]" src/**/*.ts

# Find circular dependencies (manual review)
# Focus on: A references B, and B references A
```

**Evaluation criteria:**
- 🔴 Tight coupling, hard to modify → must refactor
- 🟡 Some coupling but with boundaries → optimization recommended
- 🟢 Loose coupling, clear dependencies → accept

---

## Review Output Format

### Review Report Template

```markdown
# Code Review Report

## Basic Information
- Review scope: {BASE_SHA}..{HEAD_SHA}
- Implementation: {DESCRIPTION}
- Review date: {YYYY-MM-DD}
- Review level: [ ] Layer 1 quick check  [ ] Layer 2 deep check

## Strengths
- [Specific strengths, citing file:line]

## Issues

### Critical (Must Fix)
| # | Issue | Location | Impact | Suggestion |
|---|-------|----------|--------|------------|
| 1 | ... | file:line | ... | ... |

### Important (Should Fix)
| # | Issue | Location | Impact | Suggestion |
|---|-------|----------|--------|------------|
| 1 | ... | file:line | ... | ... |

### Minor (Fix Recommended)
| # | Issue | Location | Impact | Suggestion |
|---|-------|----------|--------|------------|
| 1 | ... | file:line | ... | ... |

## Assessment

**Ready?** [ ] Yes  [ ] No  [ ] Passes after fixes

**Rationale:** [1-2 sentences of technical assessment]

## Deep Check Record (if triggered)

**Trigger reason:** [Clue found]

**Check path:** [Path 1/2/3/4/5]

**Additional findings:** [New issues discovered by the deep check]
```

---

## Review Principles

### DO ✅
- Check in the order P0 → P1 → P2
- Provide a specific location (file:line) for each issue
- Explain why the issue matters
- Provide fix suggestions (if not obvious)
- Acknowledge strengths

### DON'T ❌
- Do not say "looks good" without checking
- Do not mark detail issues as Critical
- Do not give feedback on code you have not reviewed
- Do not give vague feedback ("improve error handling")
- Do not fail to reach a clear conclusion

---

**Maintainer**: sg-agent-reviewer  
**Update timing**: When new common code issues are discovered  
**Related document**: [Refactoring Best Practices](../../../../.specgate/experiences/best-practices/BP-refactoring-improving-existing-code.md)
