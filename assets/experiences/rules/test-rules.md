
# Test Module Rules

> **Scope**: all files under `tests/`
> **Priority**: Hard rule - must be followed

---

## Test Coverage Requirements

### Coverage Targets
- Unit test coverage ≥ 80%
- Core modules (scanner, generator, validator) ≥ 90%
- New features must include tests

### Test Types

- Unit tests: located in `tests/unit/`, coverage requirement ≥ 80%
- Integration tests: located in `tests/integration/`, coverage requirement: critical paths
- End-to-end tests: located in `tests/e2e/`, coverage requirement: core workflows

---

## Test Authoring Standards

### Naming Conventions
- Test files: `<file-under-test>.test.ts`
- Test cases: `describe('<feature module>', () => { it('should ...', () => {}) })`
- Use Chinese to describe test intent

### Example
```typescript
describe('ProjectScanner', () => {
  it('should correctly detect a TypeScript project', () => {
    // Test implementation
  });

  it('should throw an error when package.json is missing', () => {
    // Edge case test
  });
});
```

---

## Test Structure (AAA Pattern)

Every test case must follow the **Arrange-Act-Assert** pattern:

```typescript
it('should correctly compute the recommendation score', () => {
  // Arrange
  const profile = makeProfile({
    hasTests: true,
    collaboration: { recommendedMode: 'collaboration' },
  });

  // Act
  const result = executeRules(profile, []);

  // Assert
  expect(result.suggestedUnits).toContain('skill-test-driven-development');
  expect(result.reasoning).toContain('R3');
});
```

**Do not mix the three phases**:
- Prohibited: preparing data during the Act phase
- Prohibited: modifying state during the Assert phase
- Must: each phase has a clear responsibility

---

## Mocking Strategy

### When to Use Mocks
- External API calls (filesystem, network requests)
- Time-consuming operations (> 100ms)
- Unreliable third-party services

### When Not to Use Mocks
- Pure function computation
- Simple data structure transformations
- Business logic verification

### Mocking Conventions
```typescript
// Good mock: explicit boundary
vi.mock('fs', () => ({
  readFileSync: vi.fn().mockReturnValue('{"name": "test"}'),
  existsSync: vi.fn().mockReturnValue(true),
}));

// Bad mock: over-mocking
vi.mock('fs');  // Mocks the entire module; not explicit
```

**Mocking principles**:
- Mock only external dependencies, never the business logic under test
- Mock return values must be explicit; do not use `vi.fn()` without arguments
- Mock independently per test case to avoid cross-test interference

---

## Edge Case Testing

The following edge cases must be covered:

### Input Boundaries
- Empty input: `[]`, `{}`, `""`
- Very large input: arrays with 1000+ elements
- Special characters: `<script>`, `null`, `undefined`

### Failure Boundaries
- File does not exist
- Insufficient permissions
- Network timeout
- Invalid configuration

### Example
```typescript
describe('edge case tests', () => {
  it('should handle an empty directory', () => {
    const result = scanProject('/empty/dir');
    expect(result).toEqual(makeDefaultProfile());
  });

  it('should handle an invalid JSON file', () => {
    expect(() => parseConfig('{invalid json}')).toThrow(ConfigError);
  });

  it('should handle a project with 1000+ files', () => {
    const files = Array.from({ length: 1000 }, (_, i) => `file${i}.ts`);
    const result = scanFiles(files);
    expect(result.duration).toBeLessThan(2000); // < 2 seconds
  });
});
```

---

## Test Data Management

### Fixture Files
- Test data lives in the `tests/fixtures/` directory
- Use descriptive file names: `valid-config.yaml`, `invalid-project/`

### Factory Functions
- Use factory functions to create test data
- Provide sensible defaults

```typescript
// tests/utils/factories.ts
export function makeProfile(overrides: Partial<ProjectProfile> = {}): ProjectProfile {
  return {
    structure: { hasTests: false, hasGit: true, ...overrides.structure },
    techStack: { language: 'typescript', framework: 'none', ...overrides.techStack },
    ...overrides,
  };
}
```

---

## Test Performance Requirements

### Execution Time
- A single test case < 100ms
- A test file < 5 seconds
- The full test suite < 30 seconds

### Optimization Strategies
- Run independent tests in parallel
- Use an in-memory filesystem (memfs) instead of the real filesystem
- Avoid unnecessary I/O operations

---

## Test Maintenance

### Refactoring Tests
- Update tests together when refactoring production code
- Keep tests consistent with the implementation
- Do not delete tests covering existing functionality

### Deleting Tests
- Delete tests only when the corresponding feature is deleted
- Keep historical tests as documentation references

---

> **Important**: Tests safeguard code quality; they are not a burden. Test-writing time should be 30-50% of development time.
