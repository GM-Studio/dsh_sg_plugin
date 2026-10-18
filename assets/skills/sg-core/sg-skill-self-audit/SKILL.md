---
name: sg-skill-self-audit
version: 2.0.0
description: "SpecGate DSH Plugin Self-Audit — Cross-validate assets, registrations, documentation counts, command names, and tests to detect template drift and broken references"
---

# SpecGate DSH Plugin Self-Audit Skill

## Purpose

Perform a systematic cross-check of `dsh-plugin-specgate` itself: template drift, broken references, inconsistent counts, DSH-incompatible command names, and historical leftovers.

**Positioning**: A meta-tool for SpecGate plugin developers, not a general-purpose Skill distributed to user projects.
**Relationship with `specgate doctor`**: `specgate doctor` checks user projects; this Skill checks the plugin repository (`E:\ai_workflow\sg_dsh`).

## Trigger Conditions

- The user says "self-audit", "self-check", "audit the plugin", "check the plugin", or "audit"
- After modifying `assets/`, `src/commands.js`, `src/tools.js`, or `index.js`
- Quality check before a release

## Execution Steps

Run the following 6 checks and report immediately after each one. Run the commands from the plugin repository root (PowerShell or Node is fine).

---

### Check 1: Asset and Registration Counts

**Purpose**: The actual counts in `assets/skills` and `assets/agents` match the registration/documentation claims.

```powershell
(Get-ChildItem -Recurse assets\skills -Filter SKILL.md | Measure-Object).Count
(Get-ChildItem assets\agents -Filter *.md | Measure-Object).Count
Get-ChildItem assets\skills -Directory | ForEach-Object {
  "$($_.Name): $((Get-ChildItem -Recurse $_.FullName -Filter SKILL.md | Measure-Object).Count)"
}
```

**Red flag**: The total Skill count is not 30; the sum of categories ≠ the total; the Agent count is not 9.

---

### Check 2: Documentation Counts Match the Lists

**Purpose**: The counts in `README.md`, `assets/AGENTS.full.md`, and `assets/skills/sg-core/sg-using-skills/SKILL.md` match the lists.

```powershell
Select-String -Path README.md,assets\AGENTS.full.md,assets\skills\sg-core\sg-using-skills\SKILL.md -Pattern '30|Skill|Agent' |
  Select-Object Path,LineNumber,Line
```

**Red flag**: Old counts such as 33/31/27 appear; a Skill listed in the list does not exist under `assets/skills`.

---

### Check 3: Skills Referenced by Agents Actually Exist

**Purpose**: Every `sg-skill-*` referenced in an Agent definition can be found in assets.

```powershell
$actual = Get-ChildItem -Recurse assets\skills -Filter SKILL.md |
  ForEach-Object { Split-Path $_.DirectoryName -Leaf } | Sort-Object -Unique
Get-ChildItem assets\agents -Filter *.md | ForEach-Object {
  Select-String -Path $_.FullName -Pattern '`sg-skill-[a-z-]+`' -AllMatches |
    ForEach-Object { $_.Matches.Value.Trim('`') } | Sort-Object -Unique |
    Where-Object { $actual -notcontains $_ } |
    ForEach-Object { "NOT FOUND in $($_.Name): $_" }
}
```

**Red flag**: Any `NOT FOUND`.

---

### Check 4: DSH Command Names and Argument Hints

**Purpose**: Command names must match the DSH syntax `^[a-z0-9][a-z0-9_-]*$`, colon aliases must no longer be registered, and commands that take arguments must have an `input.hint`.

```powershell
node -e "import('./src/commands.js').then(({registerCommands}) => { const defs=[]; registerCommands({commands:{register(d){defs.push(d);return()=>{}}}}, {getCwd:()=>process.cwd()}); for (const d of defs) { console.log(d.name, d.input?.hint ?? '(no hint)'); } })"
```

**Red flag**: A name contains `:`; a command that takes arguments lacks `input.hint`; documentation still says `/specgate:init`.

---

### Check 5: Historical Leftovers and Qoder-Specific Content

**Purpose**: `assets/` must no longer contain Qoder Hooks, `.qoder/` source paths, or `superpowers` leftovers; at runtime, `adaptContent` may only perform fallback replacement.

```powershell
Select-String -Path assets\**\*.md -Pattern 'Qoder|\.qoder/|SessionStart|UserPromptSubmit|superpowers' |
  Where-Object { $_.Line -notmatch 'DSH|迁移|适配|历史' } |
  Select-Object Path,LineNumber,Line
```

**Red flag**: Instructions still require users to configure Qoder Hooks, read `.qoder/settings.json`, or run `templates/qoder/`.

---

### Check 6: Automated Tests and Output Regression

**Purpose**: Command/tool output, notices, and gate confirmation paths all have regression tests.

```powershell
node --test
```

**Red flag**: Any failure; `test/commands-report.test.js` no longer covers "new session notice / no duplicate in active session / no message written while running / failed commands produce output".

---

## Output Format

Report immediately after each check completes:

```
### Check N: {check name}
✅ Passed — {brief description}
```

Or

```
### Check N: {check name}
❌ Found {N} issue(s):
- {issue description} → {fix suggestion}
```

Summarize after all checks are complete:

```
## Self-Audit Summary
- Passed: {N}/6
- Needs fixing: {list}
- Recommended fix order: {sorted by impact priority}
```

## Key Red Lines

- ❌ Do not skip any check
- ❌ Do not judge from memory (you must run commands to verify)
- ❌ Do not fix discovered issues automatically (report first and wait for user confirmation)
- ✅ Keep each check to ≤ 3 commands to limit noise
- ✅ Fix principle: `assets/` is the authoritative source; fix assets first, then run tests
