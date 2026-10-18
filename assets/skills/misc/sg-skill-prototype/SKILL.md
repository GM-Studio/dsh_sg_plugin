---
name: sg-skill-prototype
version: 0.1.0
description: "Build a throwaway prototype to validate design decisions - eliminate design problems before committing. Route to one of two branches based on the question type: logic prototype (state machine/business logic) or UI prototype (multiple interface variants)."
---

# One-Off Prototype

A prototype is **disposable code built to answer a question**. The question determines the shape of the prototype.

## Choosing a Branch

Identify the question to answer — from the user's prompt, the surrounding code, or by asking the user:

- **"Does this logic/state model feel right?"** → [Logic prototype](#logic-prototype). Build a small interactive terminal app that pushes the state machine into the cases that are hard to reason about on paper.
- **"What should this look like?"** → [UI prototype](#ui-prototype). Generate several distinctly different UI variants on a single route, switched via a URL parameter and a floating bottom bar.

The two branches produce very different artifacts — choosing wrong wastes the entire prototype. If the question is genuinely ambiguous and the user is unreachable, default to the branch that better matches the surrounding code (backend module → logic; page or component → UI) and state the assumption at the top of the prototype.

## Rules That Apply to Both Branches

1. **Disposable from day one, and clearly marked as such.** Put the prototype code near where it would actually be used (right next to the module or page being prototyped) so the context is clear — but name it so that a casual reader can tell it is a prototype, not production code. For throwaway UI routes, follow the project's existing routing conventions; do not invent a new top-level structure.

2. **Run with one command.** Use whatever the project's existing task runner supports — `pnpm <name>`, `python <path>`, `bun <path>`, etc. The user must be able to start it without thinking.

3. **No persistence by default.** State lives in memory. Persistence is something the prototype *checks*, not something it should depend on. If the question explicitly involves a database, use a temporary database or local file and name it clearly as "PROTOTYPE — delete me".

4. **Skip polish.** No tests, no error handling beyond what makes the prototype *runnable*, no abstractions. The point is to learn something quickly and then delete it.

5. **Show the state.** After every operation (logic) or every variant switch (UI), print or render the full relevant state so the user can see what changed.

6. **Delete or absorb it when done.** Once the prototype has answered the question, either delete it or fold the validated decision into the real code — don't let it rot in the repository.

## After You're Done

The only thing worth keeping from a prototype is the *answer*. Capture it in a durable place (commit message, ADR, issue, or a `NOTES.md` next to the prototype), together with the question it was meant to answer. If the user is present, that capture is a quick conversation; if not, leave placeholders so they (or you in a later round) can fill in the conclusion before deleting the prototype.

---

## Logic Prototype

A small interactive terminal app that lets the user manually drive the state model. Use it when the question is about **business logic, state transitions, or data structures** — the kind of thing that looks reasonable on paper but feels wrong once pushed into real cases.

### When This Is the Right Shape

- "I'm not sure this state machine handles the X-then-Y edge case."
- "Does this data model actually let me represent the case where...?"
- "I want to get a feel for what the API should look like before writing it."
- Any case where the user wants to **press buttons and watch the state change**.

If the question is "what should this look like" — you chose the wrong branch. Use the [UI prototype](#ui-prototype).

### Flow

#### 1. State the question

Before writing code, write down the state model you are prototyping and the question it answers. One paragraph, in the prototype's README or at the top of the file as a comment. A logic prototype that answers the wrong question is pure waste — make the question explicit so it can be checked later, whether the user is watching now or comes back AFK.

#### 2. Choose the language

Use whatever language the host project uses. If the project has no obvious runtime (a docs repository, for example), ask.

Match the project's existing tooling conventions — do not add a new package manager or runtime just for the prototype.

#### 3. Isolate the logic into a portable module

Put the actual logic — the part that answers the question — behind a small, pure interface that could later be extracted and dropped into the real codebase. The TUI around it is disposable; the logic module should not be.

The right shape depends on the question:

- **Pure reducer** — `(state, action) => state`. Fits when actions are discrete events and state is a single value.
- **State machine** — explicit states and transitions. Fits when "which actions are even legal right now" is part of the question.
- **A set of pure functions** operating on plain data types. Fits when there is no implicit current state — only transitions.
- **A class or module with a clear method surface** when the logic genuinely owns persistent internal state.

Choose the shape that best fits the question being asked, *not* the shape that is easiest to wire to the TUI. Keep it pure: no I/O, no terminal code, no `console.log` for control flow. The TUI imports it and calls it; nothing flows back the other way.

That is what makes the prototype useful beyond its own lifetime. Once the question is answered, the validated reducer/machine/function set can be promoted into the real module — and the TUI shell deleted.

#### 4. Build the smallest TUI that exposes the state

Build it as a **lightweight TUI** — on every tick, clear the screen (`console.clear()` / `print("\033[2J\033[H")` / equivalent) and re-render the entire frame. The user should always see a stable view, not an ever-growing scrollback.

Each frame has two parts, in this order:

1. **Current state**, pretty-printed and diff-friendly (one field per line, or formatted JSON). Use **bold** for field names or section titles and **dim** for unimportant context (timestamps, IDs, derived values). Native ANSI escape codes are fine — `\x1b[1m` bold, `\x1b[2m` dim, `\x1b[0m` reset. No need to pull in a styling library unless the project already has one.

2. **Keyboard shortcuts**, listed at the bottom: `[a] add user  [d] delete user  [t] tick clock  [q] quit`. Bold keys with dim descriptions, or the reverse — whatever reads clearly.

Behavior:

1. **Initialize the state** — a single in-memory object/struct. Render the first frame on startup.
2. **Read one keypress (or one line) at a time** and dispatch to the handler that mutates state.
3. **Re-render** the full frame after every operation — replace, do not append.
4. **Loop until quit.**

The whole frame should fit on one screen.

#### 5. Make it runnable with one command

Add a script to the project's existing task runner (`package.json` scripts, `Makefile`, `justfile`, `pyproject.toml`). The user should run `pnpm run <prototype-name>` or the equivalent — never have to remember a path.

If the host project has no task runner, just put the command at the top of the prototype README.

#### 6. Hand it over

Give the user the run command. They will drive it themselves; the interesting moment is when they say "wait, that shouldn't be possible" or "hmm, I assumed X would be different" — those are bugs in the *idea*, and that is exactly the point. If they want new actions, add them. The prototype evolves.

#### 7. Capture the answer

Once the prototype has done its job, the answer to the question is the only thing worth keeping. If the user is around, ask what it taught them. If not, leave a `NOTES.md` next to the prototype so the answer can be filled in (or fill it in yourself if you watched the session), then delete the prototype.

### Anti-patterns

- **Do not add tests.** A prototype that needs tests is no longer a prototype.
- **Do not connect to a real database.** Use in-memory storage unless the question is explicitly about persistence.
- **Do not generalize.** No "what if we wanted to support X later". A prototype answers one question.
- **Do not mix logic and TUI.** If the reducer/state machine references `console.log`, prompts, or terminal escape codes, it is no longer portable. Keep the TUI as a thin shell over the pure module.
- **Do not ship the TUI shell to production.** The shell is optimized for driving by hand from a terminal. The logic module behind it is the part worth keeping.

---

## UI Prototype

Generate **several distinctly different UI variants** on a single route, switched from a floating bottom bar. The user flips through the variants in the browser, picks one (or steals a bit from each), and throws away the rest.

If the question is about logic/state rather than what something should look like — you chose the wrong branch. Use the [logic prototype](#logic-prototype).

### When This Is the Right Shape

- "What should this page look like?"
- "I want to see a few options for this dashboard before committing."
- "Try different layouts for the settings screen."
- Any case where the user would otherwise spend a day picking between three vague models in their head.

### Two Sub-Shapes — Strongly Prefer Sub-Shape A

A UI prototype is much easier to judge when it is **adjacent to the rest of the app** — real header, real sidebar, real data, real density. A standalone throwaway route is a vacuum: every variant looks fine in isolation. Default to sub-shape A whenever there is a reasonable existing page to host the variants. Use sub-shape B only when the prototype genuinely has no nearby home page.

#### Sub-Shape A — Adapt an Existing Page (Preferred)

The route already exists. Variants render on the **same route**, gated by a `?variant=` URL search parameter. Existing data fetching, params, and auth all stay — only the rendering swaps. This is the default; choose it unless there is a specific reason not to.

If the prototype is for something that does not have a page yet but *would naturally live inside one of them* (a new section of the dashboard, a new card on the settings screen, a new step in an existing flow) — that is still sub-shape A. Mount the variants inside the host page.

#### Sub-Shape B — New Page (Last Resort)

Use this only when the thing being prototyped genuinely has no existing page it can fit into — for example a brand-new top-level surface, or a flow that cannot be embedded anywhere reasonable.

Create a **throwaway route** that follows the project's existing routing conventions — do not invent a new top-level structure. Name it so it is obviously a prototype (for example, include the word `prototype` in the path or file name). Same `?variant=` pattern.

Before committing to sub-shape B, sanity-check: is there really no existing page to embed in? An empty route hides design problems that a populated route would expose.

In both sub-shapes, the floating bottom bar is identical.

### Flow

#### 1. State the question and choose N

Default to **3 variants**. More than 5 stops being distinctly different and starts being noise — cap it there.

Write the plan in one line, at the prototype's location or as a comment at the top of the file:

> "Three variants of the settings page, switched via `?variant=`, on the existing `/settings` route."

This works whether or not the user pushes back here.

#### 2. Generate distinctly different variants

Draft each variant. Keep each one true to:

- The purpose of the page and the data it can access.
- The project's component library/style system (TailwindCSS, shadcn, MUI, plain CSS, whatever it is).
- A clear exported component name, e.g. `VariantA`, `VariantB`, `VariantC`.

Variants must be **structurally different** — different layout, different information hierarchy, different primary affordance, not just different colors. Three slightly tweaked card grids are not a UI prototype, they are wallpaper. If two drafts come out too similar, redo one with an explicit "do not use a card grid" instruction.

#### 3. Wire them together

Create a single switcher component on the route:

```tsx
// pseudocode — adapt to the project's framework
const variant = searchParams.get('variant') ?? 'A';
return (
  <>
    {variant === 'A' && <VariantA {...data} />}
    {variant === 'B' && <VariantB {...data} />}
    {variant === 'C' && <VariantC {...data} />}
    <PrototypeSwitcher variants={['A','B','C']} current={variant} />
  </>
);
```

For sub-shape A (existing page): keep all the existing data fetching above the switcher; only each variant's rendered subtree changes.

For sub-shape B (new page): a throwaway route under `/prototype/<name>` mounts the same switcher.

#### 4. Build the floating switcher

A small fixed-position bar at the bottom center of the screen, with three parts:

- **Left arrow** — cycle to the previous variant (wrapping).
- **Variant label** — show the current variant key, and the variant's exported name if it has one. For example `B — sidebar layout`.
- **Right arrow** — cycle forward (wrapping).

Behavior:

- Clicking an arrow updates the URL search parameter (using the framework's router — `router.replace` on Next, `navigate` on React Router, etc.) so variants are shareable and stable across reloads.
- Keyboard: the `←` and `→` arrow keys also cycle. Do not intercept arrow keys while an `<input>`, `<textarea>`, or `[contenteditable]` has focus.
- Visually distinct from the page (e.g. a high-contrast pill, subtle shadow) so it is obviously not part of the design being evaluated.
- Hidden in production builds — gate it on `process.env.NODE_ENV !== 'production'` or an equivalent check so merging the prototype does not ship the bar to users.

Put the switcher in a single shared component so both sub-shapes can reuse it. Position it wherever shared UI lives in the project.

#### 5. Hand it over

Show the URL (and the `?variant=` keys). The user will flip through as they arrive. The interesting feedback is usually **"I want B's header with C's sidebar"** — that is the design they actually want.

#### 6. Capture the answer and clean up

Once a variant wins, write down which one and why (commit message, ADR, issue, or a `NOTES.md` next to the prototype if it was run AFK and the user has not responded yet). Then:

- **Sub-shape A** — delete the losing variants and the switcher; fold the winner into the existing page.
- **Sub-shape B** — promote the winning variant into a real route, delete the throwaway route and the switcher.

Do not leave the variant components or the switcher behind. They rot quickly and confuse the next reader.

### Anti-patterns

- **Variants that differ only in color or copy.** That is a tweak, not a prototype. Real variants disagree structurally.
- **Sharing too much code between variants.** Sharing a `<Header>` is fine; sharing a `<Layout>` defeats the point. Each variant should be free to throw the layout away.
- **Wiring variants to real mutations.** A read-only prototype is fine. If a variant needs mutations, point it at a stub — the question is "what should this look like", not "does the backend work".
- **Promoting the prototype straight to production.** Variant code was written under prototype constraints (no tests, minimal error handling). Rewrite it properly when folding it in.

---

## Relationship to Other Skills

| Skill | Relationship | Description |
|-------|--------------|-------------|
| **/sg-propose** | Prerequisite (optional) | A prototype validates design decisions after an OpenSpec proposal |
| **requirements-definition** | Prerequisite (optional) | A prototype explores feasibility after requirements clarification |
| **architecture-design** | Follow-up (optional) | Architecture design follows prototype validation |
| **critical-review** | Optional | A complex prototype can invoke a critical review |

---

## Relationship to OpenSpec

### Core Positioning

A prototype is an **optional technical validation tool** for an OpenSpec change, used after `openspec propose` and before `openspec apply-change`.

**Key principles**:
- ✅ A prototype is **optional**, not a mandatory step
- ✅ A prototype validates whether OpenSpec's design decisions are correct
- ✅ Prototype conclusions feed back into the OpenSpec documents, improving quality
- ✅ Prototype code never enters production or the OpenSpec archive

### When to Use a Prototype (Validating OpenSpec)

**Scenarios where a prototype is recommended**:
- ✅ Complex state machines/business logic (the architecture design in design.md)
- ✅ Choosing among multiple UI options (the interface design in design.md)
- ✅ Exploring a new business domain (requirements feasibility in specs/)
- ✅ A review that surfaced technical risk (validation after critical-review)

**Scenarios where you can skip the prototype**:
- ❌ Simple CRUD operations
- ❌ Well-established design patterns
- ❌ Requirements are clear and risk is low
- ❌ Small configuration changes

### Integration Flow

```
openspec propose "change name"
  ↓
  Generate the OpenSpec documents:
  ├── proposal.md    ← why we are doing this
  ├── design.md      ← how we will do it (architecture design)
  ├── specs/         ← requirement specifications
  └── tasks.md       ← implementation tasks
  ↓
⭐ Prototype validation (optional, 30 minutes - 2 hours)
  ├─ Validate the architecture design in design.md
  ├─ Validate the requirements feasibility in specs/
  └─ Validate the task breakdown in tasks.md
  ↓
  Output: NOTES.md (validation conclusions)
  ↓
Update OpenSpec based on the prototype conclusions
  ├─ Modify design.md (adjust the architecture)
  ├─ Modify specs/ (adjust the requirements)
  └─ Modify tasks.md (adjust the tasks)
  ↓
openspec apply-change "change name"
  ↓
  Implement according to the validated design
```

### What the Prototype Validates in OpenSpec

#### 1. Validate `design.md`

- Is the state machine design correct?
- Are the architecture decisions feasible?
- Is the technology choice appropriate?
- Is the concurrency strategy sufficient?

**Example**:
```markdown
<!-- design in design.md -->
Order state machine:
- pending → paid → shipped → complete
- paid → cancelled

<!-- after prototype validation -->
Problem: paid → cancelled is missing the refund flow
Decision: update to paid → refunded → cancelled
```

#### 2. Validate `specs/*.md`

- Are the requirements implementable?
- Are the edge cases covered?
- Are the performance requirements reasonable?
- Are the concurrency requirements feasible?

**Example**:
```markdown
<!-- requirement in specs/order/spec.md -->
The system must support concurrent operations on the same order

<!-- after prototype validation -->
Finding: a distributed lock is required
Decision: add the implementation requirement to spec.md
```

#### 3. Validate `tasks.md`

- Is the task breakdown reasonable?
- Are the task estimates accurate?
- Are the dependencies correct?
- Are any subtasks missing?

**Example**:
```markdown
<!-- task in tasks.md -->
- [ ] Task 1: Implement the order state machine

<!-- after prototype validation -->
Finding: the state machine is more complex than expected and needs splitting
Decision: split into 3 subtasks
```

### Impact of Prototypes on OpenSpec

| OpenSpec File | What the Prototype Validates | Prototype Impact |
|---------------|-----------------------------|------------------|
| **proposal.md** | Is the scope reasonable | Adjust the scope (if needed) |
| **design.md** | Is the architecture correct | Change design decisions |
| **specs/*.md** | Are the requirements feasible | Adjust requirements or add constraints |
| **tasks.md** | Is the task breakdown reasonable | Refine or merge tasks |

### Key Principles

1. **A prototype does not change the structure of OpenSpec, it only improves quality**
   - The OpenSpec document structure stays the same
   - Prototype conclusions update the document content

2. **Prototype conclusions must feed back into the OpenSpec documents**
   - Record them in NOTES.md
   - Update design.md/specs/tasks.md
   - Ensure implementation is based on the validated design

3. **Prototype code never enters the OpenSpec archive**
   - Delete the prototype code at `openspec archive-change`
   - Keep the important NOTES.md in the experience documents

4. **Prototypes are optional, but strongly recommended for complex changes**
   - Simple changes: skip the prototype and save time
   - Complex changes: use a prototype to avoid rework

### Value Comparison

| Dimension | OpenSpec Only | OpenSpec + Prototype | Improvement |
|-----------|---------------|----------------------|-------------|
| **Design quality** | Theory-based | Validation-based | ↑ 50% |
| **Task accuracy** | Estimates | Actual measurements | ↑ 40% |
| **Implementation risk** | Medium | Low | ↓ 60% |
| **Rework rate** | 30% | 10% | ↓ 67% |

---

## Red Lines

- ❌ Shipping prototype code directly to production
- ❌ Adding tests to a prototype
- ❌ Connecting a prototype to a real database (unless the question is about persistence)
- ❌ Generalizing a prototype to support "possible future requirements"
- ❌ Mixing logic with the TUI/UI
- ❌ Not deleting or absorbing the prototype when done
- ❌ Leaving variant components or the switcher in the repository

---

**The end state is capturing the answer and deleting/absorbing the prototype.** The only thing worth keeping from a prototype is the question it answered and the answer it produced.
