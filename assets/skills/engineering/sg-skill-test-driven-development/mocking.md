# Mocking Principles

Mock only at **system boundaries**:

- External APIs (payments, email, etc.)
- Database (sometimes - prefer a test database)
- Time/random numbers
- File system (sometimes)

**❌ Do not mock**:
- Your own classes/modules
- Internal collaborators
- Anything you control

## Mockable Design

At system boundaries, design interfaces that are easy to mock:

**1. Use dependency injection**

Pass in external dependencies instead of creating them internally:

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

**2. Prefer SDK-style interfaces over generic fetchers**

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

SDK methods mean:
- Each mock returns a specific shape
- No conditional logic in test setup
- Easier to see which endpoints the tests use
- Type safety per endpoint
