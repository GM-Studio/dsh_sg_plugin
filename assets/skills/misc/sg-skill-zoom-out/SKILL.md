---
name: sg-skill-zoom-out
version: 0.1.0
description: "Zoom out - gain broader context or a higher-level perspective. Use when unfamiliar with a piece of code or when you need to understand how it fits into the bigger picture."
---

# Zoom Out

**I am unfamiliar with this code area. Raise the level of abstraction by one layer. Give me a map of all related modules and callers, using the project's domain vocabulary.**

## When to Use

- When you are unfamiliar with a piece of code
- When you need to understand how code fits into the bigger picture
- When you need to see the relationships between modules
- When you need to identify dependencies

## How It Is Triggered

The user can say:
- "Zoom out and look at this module"
- "Where does this code sit in the overall system?"
- "Give me a context map of this area"
- "I'm not familiar with this code, raise the abstraction level"

Or AI can trigger it proactively:
- When exploring a new code area
- When you need to understand module dependencies
- When preparing a cross-module change

## Output Format

AI must provide:

```markdown
# {Module Name} Context Map

## Module Positioning
{Where this module sits in the system and what it is responsible for}

## Upper-Level Abstraction
{Which larger component/system this module belongs to}

## Related Modules
| Module | Relationship | Description |
|--------|--------------|-------------|
| {Module A} | depends on/depended on by/peer | {how they interact} |
| {Module B} | depends on/depended on by/peer | {how they interact} |

## Callers
- {who calls this module}
- {in what scenario they call it}

## Callees
- {what this module calls}
- {why it calls them}

## Data Flow
{how data flows into and out of this module}

## Key Concepts
{explain the core concepts using the project's domain vocabulary}
```

## Use the Project's Domain Vocabulary

**Must** use the terms defined in `CONTEXT.md`:
- Check whether `CONTEXT.md` exists
- If it exists, use the terms defined there
- If it does not exist, use general terms and suggest creating CONTEXT.md

## Examples

### Example 1: Looking at the Order Module

**User**: "Zoom out and look at the order processing module"

**AI**:
```markdown
# Order Processing Context Map

## Module Positioning
Order Processing handles the order lifecycle, from creation through completion or cancellation.

## Upper-Level Abstraction
Part of the Order Management system, a peer of Inventory Management and Payment Processing.

## Related Modules
| Module | Relationship | Description |
|--------|--------------|-------------|
| Order Model | Depended on by | Order data model |
| Inventory Service | Depends on | Checks stock availability |
| Payment Gateway | Depends on | Processes payment |
| Notification Service | Depended on by | Sends order status notifications |

## Callers
- API Layer - HTTP requests trigger order operations
- Admin Dashboard - administrators manually operate on orders
- Scheduled Jobs - automatically cancel timed-out orders

## Callees
- Inventory API - reserve/release stock
- Payment API - charge/refund
- Email Service - send order confirmations

## Data Flow
Client request → API → Order Processing → Inventory/Payment → update status → notification

## Key Concepts
- Order: a customer's purchase request
- OrderItem: a single item within an order
- OrderStatus: the current state of the order (pending/paid/shipped/cancelled)
```

## Relationship to Other Skills

| Skill | Relationship | Description |
|-------|--------------|-------------|
| **requirements-definition** | Optional call | Understand the existing system during questioning |
| **architecture-design** | Optional call | Understand the existing architecture before designing |
| **improve-architecture** | Optional call | Understand module relationships during architecture review |

---

**This is a lightweight skill that can be used whenever context is needed.** The goal is to quickly understand where code sits in the system, not to dive into implementation details.
