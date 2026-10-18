
# CLI Module Rules

> **Scope**: all files under `src/cli/`
> **Priority**: Hard rule - must be followed

---

## Command Structure

### File Organization
- Each command must be a standalone TypeScript file
- Command names use kebab-case (e.g., `init-project`, `validate-spec`)
- The command file must export a default handler function

### Command Format
```typescript
export default async function handler(args: CommandArgs): Promise<void> {
  // Command implementation
}
```

---

## Argument Conventions

### Argument Format
- Required arguments use `<angle-brackets>`: `<project-name>`
- Optional arguments use `[square-brackets]`: `[output-dir]`
- Boolean flags use the `--flag` form: `--verbose`, `--dry-run`

### Help Output
- Every command **must** include `--help` output
- The help output must include:
  - Command description
  - Argument descriptions
  - Usage examples

### Example
```bash
specgate init <project-name> [options]
specgate validate --spec <spec-file> --verbose
```

---

## Error Handling

### Error Categories

- User error: friendly message + usage suggestion, exit code `process.exit(1)`
- System error: throw an exception + stack trace, exit code automatic
- Validation failure: list all errors (do not stop at the first one), exit code `process.exit(1)`

### Error Message Format
```
[Error] Missing required argument <project-name>

[Usage] specgate init <project-name> [options]

[Details]:
   - <project-name>: project name (required)
   - [output-dir]: output directory (optional, defaults to the current directory)

[Docs]: https://docs.specgate.dev/cli/init
```

---

## Output Conventions

### Success Output
- Mark status with text: success, warning, info
- Provide suggestions for the next step

### Progress Output
- Show a progress bar or step hints for long-running operations
- Use the `--verbose` flag to control verbosity

### Example
```bash
[Success] Project initialization complete

[Files] Created files:
  - AGENTS.md
  - .specgate/config.yaml
  - templates/

[Hint] Next steps:
  1. Edit .specgate/config.yaml to configure the project
  2. Run specgate validate to validate the configuration
  3. Start creating your first Spec
```

---

## Configuration Loading

### Configuration File Precedence
1. Command-line arguments (highest precedence)
2. Project configuration `.specgate/config.yaml`
3. Global configuration `~/.specgate/config.yaml`
4. Defaults (lowest precedence)

### Configuration Validation
- Validate the format after loading the configuration
- List all invalid items when validation fails
- Provide fix suggestions

---

## Testing Requirements

### Unit Tests
- Every command must have a corresponding test file
- Test file path: `tests/cli/commands/<command-name>.test.ts`
- Test coverage ≥ 80%

### Integration Tests
- Key commands must have integration tests
- Simulate real user interaction
- Verify end-to-end flows

---

> **Important**: The CLI is the primary interface between users and SpecGate, and it must stay consistent and friendly.
