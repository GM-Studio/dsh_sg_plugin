---
name: sg-skill-test-driven-development
version: 1.0.0
description: "Test-Driven Development - use when implementing any feature or bug fix, before writing implementation code. Blends mattpocock's vertical slicing philosophy with behavior testing principles."
---

# Test-Driven Development

**Core principle**: Tests should verify behavior through the public interface, not implementation details. Code can be completely rewritten; the tests should not change.

**Source**: Blends community TDD practice with mattpocock-skills/tdd

---

## Philosophy

### Characteristics of good tests

**Integration style**: test through the real interface, not by mocking internal components.

```typescript
// ✅ Good test: tests observable behavior
test("a user can check out with a valid cart", async () => {
  const cart = createCart();
  cart.add(product);
  const result = await checkout(cart, paymentMethod);
  expect(result.status).toBe("confirmed");
});
```

Characteristics:
- Tests the behavior users/callers care about
- Uses only the public API
- Survives internal refactoring
- Describes WHAT, not HOW
- One logical assertion per test

### Characteristics of bad tests

**Implementation-detail tests**: coupled to internal structure.

```typescript
// ❌ Bad test: tests implementation details
test("checkout calls paymentService.process", async () => {
  const mockPayment = jest.mock(paymentService);
  await checkout(cart, payment);
  expect(mockPayment.process).toHaveBeenCalledWith(cart.total);
});
```

Warning signs:
- Mocking internal collaborators
- Testing private methods
- Asserting call counts/order
- Tests fail on refactoring while behavior is unchanged
- Test names describe HOW instead of WHAT
- Verifying through external means instead of through the interface

---

## Anti-pattern: horizontal slicing

**❌ Never write all tests first, then all the implementation.** That is "horizontal slicing"—treating RED as "write all the tests" and GREEN as "write all the code".

This produces **garbage tests**:

- Tests written in bulk test the behavior you *imagine*, not the behavior that *actually* exists
- In the end you test the *shape* of things (data structures, function signatures) rather than user-facing behavior
- Tests are insensitive to real change—behavior breaks and tests still pass, while behavior is correct and tests fail
- The test structure is locked in before the implementation is understood

**✅ The right approach**: vertical slicing via the Tracer Bullet. One test → one implementation → repeat. Each test responds to what the previous cycle taught you. Because you just finished writing the code, you know exactly which behavior matters and how to verify it.

```
❌ Wrong (horizontal):
  RED:   test1, test2, test3, test4, test5
  GREEN: impl1, impl2, impl3, impl4, impl5

✅ Right (vertical):
  RED→GREEN: test1→impl1
  RED→GREEN: test2→impl2
  RED→GREEN: test3→impl3
  ...
```

---

## Workflow

### 1. Planning

While exploring the codebase, use the project's domain glossary so that test names and interface vocabulary match the project's language, and respect the relevant ADRs.

**Before writing any code**:

- [ ] Confirm with the user what interface changes are needed
- [ ] Confirm with the user which behaviors to test (prioritized)
- [ ] Identify deep module opportunities (small interface, deep implementation)
- [ ] Design interfaces for testability
- [ ] List the behaviors to test (not implementation steps)
- [ ] Get the user's approval of the plan

**Ask**: "What should the public interface look like? Which behaviors matter most to test?"

**You cannot test everything.** Confirm with the user which behaviors are most critical. Focus testing effort on critical paths and complex logic, rather than every possible edge case.

### 2. Tracer Bullet

Write **one** test that confirms **one thing** about the system:

```
RED:   write the test for the first behavior → the test fails
GREEN: write the minimum code to make it pass → the test passes
```

This is your tracer bullet—it proves the end-to-end path works.

### 3. Incremental Loop

For each remaining behavior:

```
RED:   write the next test → fails
GREEN: minimum code to make it pass → passes
```

**Rules**:
- One test at a time
- Write only enough code to pass the current test
- Do not anticipate future tests
- Keep tests focused on observable behavior

### 4. Refactor

Once all tests pass, look for refactoring candidates:

- [ ] Extract duplicated code
- [ ] Deepen modules (move complexity behind a simple interface)
- [ ] Apply SOLID principles where natural
- [ ] Consider what problems in existing code the new code reveals
- [ ] Run the tests after each refactoring step

**❌ Never refactor while RED.** Get to GREEN first.

---

## Test File Organization Guidelines

### Directory separation

Test files should be placed in the corresponding directory by type:

- **Unit tests**: follow the project framework convention (e.g. `tests/`, `__tests__/`, or `*.test.*` alongside the source)
- **Integration/E2E tests**: place in a separate subdirectory (e.g. `tests/e2e/`, `tests/integration/`)
- **Do not mix**: do not put different test types indiscriminately in the same directory

### Artifact guidelines

The output format of test scripts must follow:

- **Standard output**: print only a one-line summary (pass/fail, counts, key metrics)
- **Detailed data**: save as a structured data file (JSON/YAML) with the same name as the test script
- **❌ Forbidden**: creating Markdown test report documents or formatted table output
- **Test conclusions**: give them in the conversation; do not persist them as documents

### Planning-phase confirmation

Confirm with the user before writing tests:

- [ ] Which directory should the test files go in? Which test types are needed (unit/integration/E2E)?
- [ ] Does the output format require an additional data-processing file?
- [ ] Does external data for E2E tests need to be verified and obtained through a search engine? (Do not hardcode guessed URLs)

---

## Mock Usage Principles

### Mock only at system boundaries

**Should mock**:
- External APIs (payments, email, etc.)
- Databases (sometimes—prefer a test database)
- Time/randomness
- File system (sometimes)

**❌ Do not mock**:
- Your own classes/modules
- Internal collaborators
- Anything you control

### Designing for mockability

**1. Use dependency injection**

Pass external dependencies in rather than creating them internally:

```typescript
// ✅ Easy to mock
function processPayment(order, paymentClient) {
  return paymentClient.charge(order.total);
}

// ❌ Hard to mock
function processPayment(order) {
  const client = new StripeClient(process.env.STRIPE_KEY);
  return client.charge(order.total);
}
```

**2. Prefer SDK-style interfaces over a generic fetcher**

Create a specific function for each external operation instead of one generic function with conditional logic:

```typescript
// ✅ Good: each function can be mocked independently
const api = {
  getUser: (id) => fetch(`/users/${id}`),
  getOrders: (userId) => fetch(`/users/${userId}/orders`),
  createOrder: (data) => fetch('/orders', { method: 'POST', body: data }),
};

// ❌ Bad: mocking requires conditional logic
const api = {
  fetch: (endpoint, options) => fetch(endpoint, options),
};
```

---

## Designing Interfaces for Testability

**1. Accept dependencies, do not create them**

```typescript
// ✅ Testable
function processOrder(order, paymentGateway) {}

// ❌ Hard to test
function processOrder(order) {
  const gateway = new StripeGateway();
}
```

**2. Return results, do not produce side effects**

```typescript
// ✅ Testable
function calculateDiscount(cart): Discount {}

// ❌ Hard to test
function applyDiscount(cart): void {
  cart.total -= discount;
}
```

**3. Small surface area**
- Fewer methods = fewer tests needed
- Fewer parameters = simpler test setup

---

## Deep Module Design

**Deep module** = small interface + substantial implementation

```
┌─────────────────────┐
│   Small interface   │  ← few methods, simple parameters
├─────────────────────┤
│                     │
│   Deep              │  ← complex logic hidden
│   implementation    │
│                     │
└─────────────────────┘
```

**Shallow module** = large interface + little implementation (avoid)

```
┌─────────────────────────────────┐
│       Large interface           │  ← many methods, complex parameters
├─────────────────────────────────┤
│  Thin implementation            │  ← just passing through
└─────────────────────────────────┘
```

When designing an interface, ask:
- Can I reduce the number of methods?
- Can I simplify the parameters?
- Can I hide more complexity?

---

## Refactoring Candidates

After the TDD cycle, look for:

- **Duplication** → extract a function/class
- **Long methods** → split into private helpers (keep tests at the public interface)
- **Shallow modules** → merge or deepen
- **Feature envy** → move the logic to where the data lives
- **Primitive obsession** → introduce value objects
- **Problems in existing code revealed by the new code**

---

## Checklist for every cycle

```
[ ] The test describes behavior, not implementation
[ ] The test uses only the public interface
[ ] The test survives internal refactoring
[ ] The code is minimal for the current test
[ ] No speculative features were added
[ ] Test files are placed in the correct directory
[ ] No Markdown test report document was created
[ ] The output format follows the guidelines (one-line summary + JSON data file)
```

---

## Companion documents

- **Good and bad test examples**: [tests.md](tests.md)
- **Deep module design**: [deep-modules.md](deep-modules.md)
- **Interface testability**: [interface-design.md](interface-design.md)
- **Mock usage principles**: [mocking.md](mocking.md)
- **Refactoring candidate checklist**: [refactoring.md](refactoring.md)

---

**Version**: 1.0.0  
**Source**: Community TDD practice + mattpocock-skills/tdd  
**Core improvements**: vertical slicing + behavior testing + user confirmation loop + deep modules
