# Good Tests and Bad Tests

## Good tests

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

## Bad tests

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

```typescript
// ❌ Bad test: bypasses the interface to verify
test("createUser saves to the database", async () => {
  await createUser({ name: "Alice" });
  const row = await db.query("SELECT * FROM users WHERE name = ?", ["Alice"]);
  expect(row).toBeDefined();
});

// ✅ Good test: verifies through the interface
test("createUser makes the user retrievable", async () => {
  const user = await createUser({ name: "Alice" });
  const retrieved = await getUser(user.id);
  expect(retrieved.name).toBe("Alice");
});
