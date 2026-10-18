---
name: sg-skill-domain-modeling
description: "SpecGate Domain Modeling Skill, covering Bounded Context partitioning, Aggregate design, and Domain Event identification methodology and Checklist"
---

# Domain Modeling Skill

## Purpose

Load this Skill to guide the Domain Modeling process when performing Domain Analysis, designing a Domain Model, or reviewing architecture.

## Bounded Context Partitioning

### Identification Principles

| Principle | Description | Example |
|------|------|------|
| **Single Responsibility** | Each Context focuses on one Business Capability | Order Management, Inventory, Payment |
| **Team Autonomy** | A single Context can be developed and deployed independently by one team | Microservice boundaries |
| **Ubiquitous Language** | Terms mean the same thing within a Context and may differ across Contexts | "Product" means something different in Catalog vs. Order |
| **High Cohesion, Low Coupling** | Highly cohesive within a Context, with minimal dependencies between Contexts | Interact through Domain Events or an ACL |

### Context Map Relationships

| Relationship Pattern | Description | Applicable Scenario |
|---------|------|---------|
| **Upstream-Downstream** | The upstream provides capabilities, the downstream consumes them | Foundation services → Business services |
| **Customer-Supplier** | The downstream drives the upstream's requirements | Business requirements → Platform capabilities |
| **Conformist** | The downstream simply conforms to the upstream Model | Strong dependency with no adaptation needed |
| **Anti-Corruption Layer (ACL)** | Isolate different Models through an adaptation layer | External system integration |
| **Shared Kernel** | Multiple Contexts share part of the Model | Tight team collaboration |
| **Open Host Service** | Expose services through a Protocol | Exposing platform capabilities |
| **Published Language** | Interact through a standardized Schema | Event Schema, API Contract |

## Aggregate Design

### Design Principles

| Principle | Description | Checkpoint |
|------|------|-----------|
| **Consistency Boundary** | An Aggregate is a transactional consistency boundary | ✅ Strong consistency within a single Aggregate |
| **Small Aggregate** | Prefer designing small Aggregates | ✅ Avoid Large Aggregates that cause lock contention |
| **Aggregate Root** | Access objects inside an Aggregate through the Root | ✅ External code does not reference internal Entities directly |
| **Reference by ID** | Reference between Aggregates by ID | ✅ Do not hold references to other Aggregates directly |
| **Invariant Enforcement** | The Root is responsible for maintaining Invariants | ✅ All business rules are validated in the Root |

### Aggregate Design Checklist

- [ ] The Aggregate Root is clearly defined
- [ ] The Root maintains all Invariants
- [ ] The lifecycle of objects inside the Aggregate is managed by the Root
- [ ] Aggregates reference each other by ID, not by object reference
- [ ] A single Aggregate can be completed within one transaction
- [ ] The Large Aggregate anti-pattern has been identified and avoided

## Entity and Value Object

### Entity Characteristics

| Characteristic | Description |
|------|------|
| **Identity** | Has a unique identifier that does not change over its lifecycle |
| **Mutability** | State is mutable and changed through methods |
| **Equality** | Compared by Identity, not by attribute values |
| **Lifecycle** | Has a lifecycle of creation, change, and destruction |

### Value Object Characteristics

| Characteristic | Description |
|------|------|
| **No Identity** | No unique identifier; defined by its attribute values |
| **Immutability** | Cannot be modified once created |
| **Equality** | Compared by attribute values (Structural Equality) |
| **Replaceable** | Replaced as a whole rather than by modifying attributes |

### Design Decision Tree

```
Does the object need an independent Identity?
├─ Yes → Entity
│   └─ Does it need to be referenced across Aggregates?
│       ├─ Yes → Ensure it has a stable ID
│       └─ No → Visible only within the Aggregate
└─ No → Value Object
    └─ Does it need validation rules?
        ├─ Yes → Validate Invariants in the constructor
        └─ No → Encapsulate attributes directly
```

## Domain Event Design

### Event Identification

| Trigger Point | Example Event |
|--------|-----------|
| **State change** | `OrderPlaced`, `PaymentCompleted` |
| **Business action** | `UserRegistered`, `ProductPublished` |
| **Threshold trigger** | `InventoryLow`, `RetryLimitExceeded` |
| **Time trigger** | `SubscriptionExpired`, `ReminderDue` |

### Event Design Conventions

| Convention | Description | Example |
|------|------|------|
| **Past Tense** | Event names use the past tense | `OrderCreated` ✅ / `CreateOrder` ❌ |
| **Self-Describing** | The Event contains the full context | Includes OrderId, UserId, Timestamp |
| **Immutable** | An Event cannot be modified once published | Encapsulate using Value Objects |
| **Idempotent** | Consumers can safely process it repeatedly | De-duplicate by Event ID |

### Event Schema

```typescript
interface DomainEvent {
  eventId: string;        // Unique identifier
  aggregateId: string;    // Source Aggregate
  eventType: string;      // Event type
  occurredAt: Date;       // Time of occurrence
  payload: Record<string, any>;  // Business data
  metadata?: {            // Optional metadata
    correlationId: string;
    causationId: string;
  };
}
```

## How to Use

1. **Domain Analysis phase**:
   - Identify Contexts using the Bounded Context partitioning principles
   - Draw a Context Map to clarify relationships between Contexts
   - Establish a Ubiquitous Language Glossary

2. **Aggregate design phase**:
   - Validate each item using the Aggregate design Checklist
   - Ensure the Small Aggregate principle
   - Distinguish Entity / Value Object using the design decision tree

3. **Event Storming phase**:
   - Identify all Domain Events
   - Name Events and define Schemas according to the Event conventions
   - Build an Event Flow diagram

## Output Format

```yaml
domain_model:
  bounded_contexts:
    - name: "Order Management"
      responsibility: "Handles the order lifecycle"
      upstream: ["Product Catalog"]
      downstream: ["Payment", "Fulfillment"]
      ubiquitous_language:
        - term: "Order"
          definition: "A purchase request submitted by a customer"
          related_terms: ["OrderItem", "OrderStatus"]
  
  aggregates:
    - name: "Order"
      root: "Order"
      entities: ["OrderItem"]
      value_objects: ["Money", "Address"]
      invariants:
        - "An Order must have at least one OrderItem"
        - "A paid Order cannot be modified"
  
  domain_events:
    - name: "OrderPlaced"
      trigger: "Customer submits an order"
      publisher: "Order Aggregate"
      consumers: ["Payment", "Inventory"]
```

## Red Lines

- ❌ Skipping Bounded Context partitioning and designing the Database Schema directly
- ❌ Large Aggregates causing concurrency performance problems
- ❌ Aggregates referencing each other by object rather than by ID
- ❌ Naming Events in the present tense (e.g., `CreateOrder`)
- ❌ Failing to establish a Ubiquitous Language, causing terminology confusion
