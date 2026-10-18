# Project Domain Context

> **Maintainer**: Primary Agent (progressive filling)
> **Strategy**: Start from a blank template; update immediately once a term or relationship is resolved, and avoid filling all placeholders at once
> **Creation rule**: Fill it in only when there are genuinely business terms to lock down; otherwise keep it blank

---

## 📘 Language (English-Chinese business term mapping)

> **Format**:
>
> ```
> **<EnglishName> (<ChineseName>)**:
> <English definition; keep the English term name for mapping to code variable names>
> _Avoid_: <alias1>, <alias2>, <alias3>
> ```
>
> **Example**:
>
> ```
> **Order**:
> A purchase request submitted by a customer, containing one or more OrderItems.
> _Avoid_: Cart, transaction, purchase, shopping cart, deal
>
> **Customer**:
> A person or organization that places an Order.
> _Avoid_: Client, buyer, account, user, purchaser, profile
> ```

<!-- Append terms here as needed -->

---

## 🔗 Relationships (domain relationships)

> **Format**: `- A <termA> <verb> zero/one/many <termB>`
>
> **Example**:
>
> ```
> - A Customer can place zero or more Orders
> - An Order contains one or more OrderItems
> ```

<!-- Append relationships here as needed -->

---

## ⚠️ Flagged Ambiguities

> **Format**: `- "<ambiguous term>" used to mean both <A> and <B> — resolved: <decision>`
>
> **Example**:
>
> ```
> - "account" used to mean both Customer and User — resolved: these are two distinct concepts
> ```

<!-- Append ambiguities here as needed -->

---

## 🧭 Maintenance Guidelines

- Record only "project-level business terms", never "generic programming terms"
- The English-Chinese mapping exists so the AI does not invent variable names when generating code
- Update this document immediately whenever a new core concept or ambiguity appears
- After updating, sync any corresponding ADR in `.specgate/experiences/`
