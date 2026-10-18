
# Core Architecture Rules

> **Scope**: all files under `src/core/`
> **Priority**: Hard rule - must be followed

---

## Module Layering

### Seven-Layer Architecture (top to bottom)

```
orchestrator/    ← Orchestration layer (flow control)
    ↓
recommender/     ← Recommendation layer (intelligent recommendations)
    ↓
scanner/         ← Scanning layer (project analysis)
    ↓
generator/       ← Generation layer (template rendering)
    ↓
validator/       ← Validation layer (quality checks)
    ↓
config-manager/  ← Configuration layer (configuration management)
    ↓
flows/           ← Flow layer (workflow definitions)
```

### Dependency Direction
- **Dependencies may only point downward**: orchestrator → recommender → scanner
- Upward dependencies prohibited: scanner must not depend on orchestrator
- Lateral dependencies prohibited: scanner must not depend on generator (coordinate through orchestrator)

---

## Module Responsibilities

### orchestrator (Orchestration layer)
- **Responsibility**: coordinate the entire SpecGate flow and invoke other modules
- **Input**: user commands, project configuration
- **Output**: execution results, progress reports
- **Prohibited**: manipulating the filesystem directly, rendering templates

### recommender (Recommendation layer)
- **Responsibility**: recommend Agents/Skills based on project characteristics
- **Input**: project profile
- **Output**: list of recommended units + reasoning
- **Prohibited**: generating files, modifying configuration

### scanner (Scanning layer)
- **Responsibility**: analyze project structure, tech stack, and maturity
- **Input**: project root directory
- **Output**: project profile
- **Prohibited**: recommending Agents, generating files

### generator (Generation layer)
- **Responsibility**: render templates and generate files
- **Input**: templates, context data
- **Output**: generated files
- **Prohibited**: scanning the project, recommending Agents

### validator (Validation layer)
- **Responsibility**: validate configuration and rule compliance
- **Input**: configuration, rules
- **Output**: validation report
- **Prohibited**: modifying files, generating code

---

## Interface Design

### Function Signature Conventions
```typescript
// Good interface: explicit input and output
export function scanProject(rootDir: string): ProjectProfile {
  // Implementation
}

// Bad interface: uses any or implicit types
export function scanProject(rootDir: any): any {
  // Implementation
}
```

### Error Handling
- Use custom error types: `ScannerError`, `GeneratorError`
- Error messages must include context: `Failed to scan directory: ${path}`
- Do not swallow exceptions; either handle them or throw

---

## Code Organization

### File Naming
- Use kebab-case: `project-scanner.ts`, `template-renderer.ts`
- Test files: `project-scanner.test.ts`

### Export Conventions
- One primary export per file (function or class)
- Use named exports for helper functions
- Avoid default-exporting multiple functions

### Import Order
```typescript
// 1. Standard library
import * as path from 'path';
import * as fs from 'fs';

// 2. Third-party libraries
import * as yaml from 'js-yaml';

// 3. Internal modules (top to bottom by layer)
import { ProjectProfile } from '../types/project';
import { ScannerError } from './errors';
```

---

## Type Safety

### TypeScript Strict Mode
- The `any` type is prohibited (use `unknown` instead)
- Enable `strictNullChecks`
- Enable `strictFunctionTypes`

### Where Types Live
- Shared types live in the `src/types/` directory
- Module-private types live inside the module
- Do not define the same type twice

---

## Performance Requirements

### Scanning Performance
- Scan 1000 files in < 2 seconds
- Use streaming for large files
- Avoid reading the same file repeatedly

### Generation Performance
- Render 100 templates in < 5 seconds
- Use caching to avoid recomputation
- Generate independent files in parallel

---

> **Important**: The core modules are SpecGate's engine; they must keep clean layering and high performance.
