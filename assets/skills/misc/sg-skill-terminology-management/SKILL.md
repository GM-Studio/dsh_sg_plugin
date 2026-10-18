---
name: sg-skill-terminology-management
description: "SpecGate Terminology Management Skill: unify the domain language through CONTEXT.md and correct terminology conflicts in real time"
---

# Terminology Management Skill

## Purpose

Maintain CONTEXT.md, unify the Ubiquitous Language, and correct terminology conflicts in real time.

**Core mechanisms**:
- Based on CONTEXT.md (a single document)
- Created lazily (the first time a term is identified)
- Updated in real time (written immediately once a term is resolved)
- AI corrects proactively (calls out conflicts the moment they appear)

---

## How to Use

### 1. Lazy Creation

**Trigger condition**: AI identifies a business term for the first time

**Flow**:
1. The user mentions a business term (such as "Order")
2. AI checks whether CONTEXT.md exists
3. Does not exist → create it and add the definition
4. Already exists → check whether the term is already defined

### 2. Real-Time Terminology Correction

**When AI detects term usage**:
1. Check the definition in CONTEXT.md
2. Inconsistent → point it out immediately: "You said 'account' — do you mean Customer or User?"
3. The user clarifies → update CONTEXT.md immediately

### 3. Continuous Maintenance

- Add new terms to CONTEXT.md as soon as they are identified
- Record terminology conflicts in Flagged Ambiguities as soon as they are found
- Keep definitions concise (one sentence maximum)
- Include only project-specific terms (not general programming concepts)

---

## Terminology Handling Rules

### 1. Business Terms (Chinese-English Pairs)

**Applies to**: Project-specific business concepts such as Order, Customer, Product, and Invoice.

**Format**:
```markdown
**Order（订单）**: Definition in Chinese
_Avoid_: Cart, transaction, purchase
```

**Rules**:
- ✅ Term name: English + Chinese in parentheses (Order（订单）)
- ✅ Definition: in Chinese; keep the English term name for mapping to code variable names
- ✅ Avoid: list all Chinese aliases (购物车, 交易, 购买)
- ✅ Use English in code (order, customer)
- ✅ Use English + Chinese in documents/conversation (Order/订单)

**Examples**:
```
✅ "创建 Order（订单）"
✅ "Order（订单）包含多个 OrderItem（订单项）"
❌ "创建订单" (pure Chinese, inconsistent with code)
❌ "创建 Order" (missing Chinese, unfriendly to the team)
```

---

### 2. DDD Terms (Keep in English)

**Applies to**: Standard DDD terms such as Aggregate, Entity, Value Object, Domain Event, Bounded Context, and Repository.

**Format**:
```markdown
**Aggregate**: Definition in English
_Avoid_: 聚合 (do not translate)
```

**Rules**:
- ✅ Term name: English only (Aggregate)
- ✅ Definition: in English
- ✅ Avoid: explicitly mark "do not translate"
- ✅ Use English in code (OrderAggregate)
- ✅ Use English in documents/conversation (Order Aggregate)
- ❌ Do not translate into Chinese (聚合, 实体, 值对象)

**Why keep English**:
- DDD terms are an industry standard; translation loses precision
- "聚合" cannot convey the full meaning of Aggregate
- Teams learning DDD need to use the original English materials
- Code must use English (OrderAggregate vs 订单聚合)

**Examples**:
```
✅ "Order Aggregate maintains the consistency boundary"
✅ "User is an Entity"
✅ "Money is a Value Object"
❌ "订单聚合维护一致性边界" (imprecise after translation)
❌ "用户是一个实体" ("实体" has an ambiguous meaning)
```

---

### 3. Technical Terms (Keep in English)

**Applies to**: General technical concepts such as API, HTTP, REST, GraphQL, JWT, OAuth, and Database Schema.

**Rules**:
- ✅ Keep in English (API, HTTP, JWT)
- ✅ No need to add to CONTEXT.md (AI already knows them)
- ❌ Do not translate (应用程序接口, 超文本传输协议)

**Examples**:
```
✅ "Call the Order API"
✅ "Authenticate with JWT"
❌ "调用订单应用程序接口"
❌ "使用 JSON Web 令牌"
```

---

### 4. General Programming Concepts (Do Not Add)

**Applies to**: General concepts such as timeout, error handler, callback, loop, and function.

**Rules**:
- ❌ Do not add to CONTEXT.md
- ❌ Not project-specific terms
- ✅ Keep in English in code and documents

---

### Quick Decision Matrix

| Term Type | Example | Format | Add to CONTEXT.md | Translate |
|-----------|---------|--------|-------------------|-----------|
| **Business terms** | Order, Customer | Order（订单） | ✅ Required | ✅ Chinese-English pair |
| **DDD terms** | Aggregate, Entity | Aggregate | ✅ Recommended | ❌ Keep in English |
| **Technical terms** | API, JWT | API | ❌ Not needed | ❌ Keep in English |
| **General concepts** | timeout, callback | timeout | ❌ Do not add | ❌ Keep in English |

---

## Output Format

Refer to the `CONTEXT.md` template.

## Red Lines

- ❌ Using an undefined term directly in code or documents
- ❌ The same Term having multiple meanings within the same Context
- ❌ Finding a terminology conflict without recording and resolving it
- ❌ CONTEXT.md being inconsistent with the actual code/documents
- ❌ Using a Hook to trigger terminology updates automatically (AI must judge intelligently)
- ❌ Pre-generating an empty CONTEXT.md (it must be created lazily)
- ❌ Including general programming concepts (keep only project-specific terms)
- ❌ Translating DDD terms (they must stay in English)
