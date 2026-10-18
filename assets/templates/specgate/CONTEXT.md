# {Project Name} Domain Context

> **Maintainer**: Primary Agent (real-time updates)  
> **Strategy**: Create lazily; update immediately once a term is resolved

---

## Language

### Business Terms (English-Chinese Mapping)

**{EnglishTermName} ({ChineseTermName})**:
{Define in English, keeping precision}
_Avoid_: {EnglishAlias1}, {EnglishAlias2}, {ChineseAlias1}

**Usage example**:

```markdown
**Order**:
A customer's purchase request containing one or more OrderItems.
_Avoid_: Cart, transaction, purchase, shopping cart, deal

**Customer**:
A person or organization that places Orders.
_Avoid_: Client, buyer, account, user, purchaser, profile
```

---

## Relationships

- A **{term1}** {verb} zero or more **{term2}**
- A **{term2}** {verb} exactly one **{term3}**

**Usage example**:

```markdown
- A **Customer** can place zero or more **Orders**
- An **Order** contains one or more **OrderItems**
```

---

## Flagged Ambiguities

- "{ambiguous term}" used to mean both **{term1}** and **{term2}** — resolved: these are two distinct concepts

**Usage example**:

```markdown
- "account" used to mean both **Customer** and **User** — resolved: these are two distinct concepts
```
