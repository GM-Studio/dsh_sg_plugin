---
name: sg-skill-systematic-debugging
version: 0.3.0
description: "Use when encountering any error, test failure, or unexpected behavior, before proposing a fix"
---

# Systematic Debugging - 6-Phase Systematic Debugging Loop

> **Designed based on the mattpocock diagnose Skill**
> 
> Fully implements the 6-phase debugging loop, including:
> - Phase 1: 10 ways to build a feedback loop
> - Phase 2: Bug reproduction verification
> - Phase 3: 3-5 falsifiable hypotheses
> - Phase 4: Instrumentation (one variable at a time)
> - Phase 5: Fix + regression test
> - Phase 6: Cleanup + post-mortem + architecture improvement handoff

## Core Principles

> **NO FIX WITHOUT UNDERSTANDING ROOT CAUSE**
> 
> Never fix anything before you understand the root cause.

Violating the letter of this process is violating the spirit of debugging.

## When to Use

**Must be used for any technical problem**:
- Test failure
- Runtime error
- Unexpected behavior
- Performance problem
- Build failure
- Integration issue

**Especially when**:
- ⏰ Time pressure (it's easier to guess in an emergency)
- 🔥 "Looks simple" problems (simple problems also have root causes)
- 🔄 You've already tried multiple fixes
- ❌ Previous fixes didn't work
- 🤔 You don't fully understand the problem

## The 6-Phase Debugging Loop

**You must complete each phase in order unless there is a clear reason to skip it.**

When exploring the codebase, use the project's domain glossary (CONTEXT.md) to build a clear mental model of modules, and check the ADRs for the areas you touch.

---

### Phase 1 — Build a Feedback Loop (Core!)

**This is the heart of this Skill.** Everything else is mechanical.

If you have a fast, deterministic, automatically runnable pass/fail signal that detects the Bug, you will definitely find the root cause—bisection, hypothesis testing, and instrumentation all just consume this signal.

**Without a feedback loop, no amount of staring at code will save you.**

#### Spend disproportionate effort here

> **Spend disproportionate effort here.**
> 
> **Be aggressive. Be creative. Refuse to give up.**

#### 10 ways to build one (try in priority order)

1. **Failing test case**: at any layer that can reach the Bug (unit test, integration test, e2e)
2. **curl / HTTP script**: against a running dev server
3. **CLI invocation**: with fixture input, compare stdout against a known-correct snapshot
4. **Headless browser script** (Playwright / Puppeteer): drive the UI, assert DOM/console/network
5. **Replay captured traces**: save real network requests/payloads/event logs to disk; replay them into the code path in an isolated environment
6. **Throwaway harness**: start a minimal subset of the system (one service, mocked dependencies), exercise the Bug code path with a single function call
7. **Property / fuzz loop**: if the Bug is "sometimes outputs the wrong result", run 1000 random inputs to find the failure pattern
8. **Bisection harness**: if the Bug appeared between two known states (commit, dataset, version), automate "start in state X, check, repeat" so you can `git bisect run`
9. **Differential loop**: run the same input through the old version vs the new version (or two configs) and diff the output
10. **HITL bash script** (last resort): if a human must click, drive them with `scripts/hitl-loop.template.sh` so the loop is still structured

**Build the right feedback loop and the Bug is 90% fixed.**

#### Iterate on the feedback loop itself

Treat the feedback loop as a product. Once you have _one_ loop, ask:

- ⚡ **Can it be faster?** (cache setup, skip irrelevant init, narrow the test scope)
- 🎯 **Can it be more precise?** (assert the specific symptom, not "it didn't crash")
- 🔒 **Can it be more deterministic?** (freeze time, seed the RNG, isolate the filesystem, freeze the network)

**A 30-second flaky loop is almost as bad as no loop. A 2-second deterministic loop is a debugging superpower.**

#### Non-deterministic Bugs

The goal is not a clean reproduction but a **higher reproduction rate**.

Trigger the loop 100 times, parallelize, add stress, narrow the time window, inject sleeps.

**A 50% flaky Bug is debuggable; 1% is not**—keep raising the reproduction rate until it is debuggable.

#### Diagnosing multi-component systems (SpecGate enhancement)

**When the system has multiple components (CI → build → signing, API → service → database)**:

Before proposing a fix, **add diagnostic instrumentation**:

```
For EACH component boundary:
  - Log what data enters the component
  - Log what data leaves the component
  - Verify environment/config propagation
  - Check state at each layer

Run once to collect evidence showing WHERE it fails
Then analyze the evidence to identify the failing component
Then investigate that specific component
```

**Example (multi-layer system)**:
```bash
# Layer 1: Workflow
echo "=== Secrets available in workflow: ==="
echo "IDENTITY: ${IDENTITY:+SET}${IDENTITY:-UNSET}"

# Layer 2: Build script
echo "=== Env vars in build script: ==="
env | grep IDENTITY || echo "IDENTITY not in environment"

# Layer 3: Signing script
echo "=== Keychain state: ==="
security list-keychains
security find-identity -v

# Layer 4: Actual signing
codesign --sign "$IDENTITY" --verbose=4 "$APP"
```

**This reveals**: which layer fails (secrets → workflow ✓, workflow → build ✗)

#### When you truly cannot build a loop

**Stop and say so explicitly.**

List what you tried. Ask the user for:
- (a) Access to an environment that reproduces it
- (b) Captured artifacts (HAR file, log dump, core dump, timestamped screen recording)
- (c) Permission to add temporary production instrumentation

**Do not enter the hypothesis phase without a feedback loop.**

**✅ Exit criteria**: You believe in this feedback loop before entering Phase 2

---

### Phase 2 — Reproduce the Bug

Run the loop. Watch the Bug appear.

Confirm:

- [ ] The loop produces the failure mode **the user described**—not some other nearby failure. **Wrong Bug = wrong fix**
- [ ] The failure reproduces across multiple runs (or, for non-deterministic Bugs, at a high enough rate)
- [ ] You captured the exact symptom (error message, wrong output, slow timing) so later phases can verify that the fix actually resolved it

**✅ Exit criteria**: You have reproduced the Bug before entering Phase 3

---

### Phase 3 — Generate Hypotheses

Generate **3-5 ranked hypotheses** before testing any of them.

**Single-hypothesis generation anchors you to the first plausible idea.**

Each hypothesis must be **falsifiable**: state the prediction it makes.

> **Format**: "If <X> is the cause, then <changing Y> will make the Bug disappear / <changing Z> will make it worse"

**If you cannot state a prediction, the hypothesis is just a feeling—discard it or sharpen it.**

#### Example

| # | Hypothesis | Verification method | Falsifiability |
|---|------------|---------------------|----------------|
| 1 | If the problem is **cache expiration**, then clearing the cache should make the Bug disappear | Clear the cache, run the tests | ✅ If the Bug persists, the hypothesis is falsified |
| 2 | If the problem is **insufficient permissions**, then elevating permissions should make the Bug disappear | Change the permission configuration | ✅ If the Bug persists, the hypothesis is falsified |
| 3 | If the problem is a **concurrency race**, then adding a lock should make the Bug disappear | Add a Mutex lock | ✅ If the Bug persists, the hypothesis is falsified |

#### Cheap Checkpoint

**Before testing, show the ranked list to the user.**

They often have domain knowledge that lets them reorder it immediately ("we just deployed the change in #3"), or they know the hypotheses they have already ruled out.

**A cheap checkpoint saves enormous time. Don't block—if the user is AFK, proceed with your ranking.**

**✅ Exit criteria**: 3-5 hypotheses exist (user-confirmed or AFK) before entering Phase 4

---

### Phase 4 — Instrumentation

Every probe must map to a specific prediction from Phase 3.

**Change only one variable at a time.**

#### Tool preferences

1. **Debugger / REPL inspection** (if the environment supports it). **One breakpoint beats ten logs.**
2. **Targeted logging**: at the boundaries that distinguish hypotheses.
3. ❌ **Never** "log everything and grep".

#### Debug logging conventions

**Tag every debug log with a unique prefix**, e.g. `[DEBUG-a4f2]`.

Cleanup then becomes a single grep. **Tagged logs die; untagged logs survive.**

```typescript
console.log('[DEBUG-a4f2] Phase 4: Testing hypothesis 3');
console.log('[DEBUG-a4f2] Token before refresh:', token);
console.log('[DEBUG-a4f2] Token after refresh:', newToken);
```

#### Performance branch

For performance regressions, logging is usually the wrong tool.

**Instead**: establish a baseline measurement (timing harness, `performance.now()`, profiler, query plan), then bisect.

**Measure first, fix later.**

#### Data flow tracing (SpecGate enhancement)

**When the error is deep in the call stack**:

See `root-cause-tracing.md` (this directory) for the complete backward-tracing technique.

**Quick version**:
- Where does the bad value come from?
- What called this with the bad value?
- Keep tracing upward until you find the source
- Fix at the source, not at the symptom

**✅ Exit criteria**: The hypothesis is verified/falsified before entering Phase 5

---

### Phase 5 — Fix + Regression Test

**Write the regression test before the fix**—but only if a **correct test seam** exists.

A **correct test seam** is one where the test exercises the **real Bug pattern** at the call site.

If the only available seam is too shallow (single-caller tests when the Bug requires multiple callers, unit tests that cannot reproduce the chain that triggers the Bug), a regression test there gives false confidence.

#### If no correct test seam exists

**That is itself a finding.**

Record it. **The codebase architecture prevents the Bug from being locked down.**

Flag it for the next phase.

#### If a correct test seam exists

1. Turn the minimized reproduction into a failing test at that seam
2. Watch it fail
3. Apply the fix
4. Watch it pass
5. Re-run the Phase 1 feedback loop against the original (unminimized) scenario

#### Defensive programming (SpecGate enhancement)

After fixing the root cause, consider whether defense is needed at other layers:

- Input validation (zod/runtime validation)
- Null checks
- Boundary checks
- Error handling

See `defense-in-depth.md` (this directory) for the complete guide.

**✅ Exit criteria**: The regression test passes (or the absence of a test seam is recorded) before entering Phase 6

---

### Phase 6 — Cleanup + Post-Mortem

**Must be completed before declaring done**:

- [ ] The original reproduction no longer reproduces (re-run the Phase 1 loop)
- [ ] The regression test passes (or the absence of a test seam is recorded)
- [ ] **All `[DEBUG-...]` instrumentation removed** (`grep` the prefix)
- [ ] Throwaway prototypes removed (or moved to a clearly marked debug location)
- [ ] **The correct hypothesis is stated in the commit / PR message**—so the next debugger can learn from it

**Commit message format**:
```
fix(scope): fix XXX Bug

Root cause: {the correct hypothesis from Phase 3}
Debugging process: {brief summary of the key steps in Phases 1-5}
Preventive measures: {preventive measures from Phase 6}
```

#### Then ask: what would have prevented this Bug?

| Preventive measure | How to implement | When it applies |
|--------------------|------------------|-----------------|
| **Add tests** | Check the regression test into the repo | All Bugs |
| **Add type checking** | zod/runtime validation | Data type issues |
| **Add defensive code** | Null checks, boundary checks | Edge cases |
| **Add monitoring** | Error tracking, alerting | Production issues |
| **Architecture improvement** | Module decoupling, interface abstraction | Problems that are hard to test |

#### Architecture problem identification (SpecGate enhancement)

**If 3+ fix attempts fail, question the architecture**:

**Patterns that indicate an architecture problem**:
- Every fix reveals new shared state/coupling/problems elsewhere
- The fix requires a "massive refactor" to be possible
- Every fix creates new symptoms elsewhere

**Stop and question the foundation**:
- Is this pattern fundamentally sound?
- Are we "sticking with it purely out of inertia"?
- Should we refactor the architecture instead of continuing to fix symptoms?

**Discuss with your human partner before attempting more fixes**

**This is not a failed hypothesis—it is the wrong architecture.**

If the answer involves an architecture change (no good test seam, tangled callers, hidden coupling), hand the specifics to the `/improve-codebase-architecture` Skill.

**Make the suggestion after the fix is complete, not before**—you have more information now than when you started.

**✅ Exit criteria**: All cleanup complete + knowledge captured before declaring done

---

## 🚩 Red Flags - Stop and Follow the Process

If you catch yourself thinking:
- "Quick fix first, investigate later"
- "Let me just try changing X and see if it works"
- "Add several changes, then run the tests"
- "Skip the tests, I'll verify manually"
- "It's probably X, let me fix that"
- "I don't fully understand this but it might work"
- "The pattern says X but I'll adapt it differently"
- "The main problem is: [listing fixes without investigating]"
- Proposing a solution before tracing the data flow
- **"Just try one more fix" (when you've already tried 2+ times)**
- **Every fix reveals a new problem in a different place**

**All of these mean: stop. Go back to Phase 1.**

**If 3+ fixes fail**: question the architecture (see Phase 6)

---

## 👤 Signals Your Partner Is Showing That You're Doing It Wrong

**Watch for these redirects**:
- "Isn't it that?" - you assumed without verifying
- "Will that show us...?" - you should add evidence collection
- "Stop guessing" - you're proposing fixes without understanding
- "Think about this deeply" - question the foundation, not just the symptom
- "Are we stuck?" (frustration) - your approach isn't working

**When you see these**: stop. Go back to Phase 1.

---

## Common Rationalization Excuses

| Excuse | Reality |
|--------|---------|
| "The problem is simple, no need for the process" | Simple problems also have root causes. The process is fast for simple Bugs. |
| "It's urgent, no time to follow the process" | Systematic debugging is **faster** than guess-check iterations. |
| "Let me try this first, then investigate" | The first fix sets the pattern. Do it right from the start. |
| "I'll write tests after confirming the fix works" | Untested fixes don't last. Test first to prove it. |
| "Multiple fixes at once saves time" | You can't isolate what worked. It causes new Bugs. |
| "The reference is too long, I'll adapt the pattern" | Partial understanding guarantees Bugs. Read it fully. |
| "I see the problem, let me fix it" | Seeing the symptom ≠ understanding the root cause. |
| "Just try one more fix" (after 2+ failures) | 3+ failures = architecture problem. Question the pattern, don't fix again. |

---

## Quick Reference

| Phase | Key activity | Success criterion |
|-------|--------------|-------------------|
| **1. Feedback loop** | Build via 10 methods, iterate to improve | A trustworthy feedback loop exists |
| **2. Reproduction** | Run the loop, capture the symptom | Stable reproduction of the failure the user described |
| **3. Hypotheses** | 3-5 falsifiable hypotheses, user confirmation | Hypothesis list approved |
| **4. Instrumentation** | One variable at a time, DEBUG log prefix | Hypotheses verified/falsified |
| **5. Fix** | Write the test first, then fix | Regression test passes |
| **6. Cleanup** | Delete DEBUG logs, capture knowledge | All cleanup complete |

---

## When the Process Reveals "No Root Cause"

If systematic investigation reveals that the problem is genuinely environment-dependent, time-dependent, or external:

1. You completed the process
2. Record what you investigated
3. Implement appropriate handling (retry, timeout, error messages)
4. Add monitoring/logging for future investigation

**But**: 95% of "no root cause" cases are incomplete investigations.

---

## Supporting Techniques

These techniques are part of systematic debugging and are available in this directory:

- **`root-cause-tracing.md`** - Trace a Bug backward through the call stack to find the original trigger point
- **`defense-in-depth.md`** - Add validation at multiple layers after finding the root cause
- **`condition-based-waiting.md`** - Replace arbitrary timeouts with condition polling

**Related Skills**:
- **sg-skill-test-driven-development** - For creating failing test cases (Phase 5)

---

## Real-World Impact

From debugging sessions:
- Systematic approach: 15-30 minute fixes
- Random fix approach: 2-3 hours of back-and-forth
- First-fix success rate: 95% vs 40%
- New Bugs introduced: near zero vs common
