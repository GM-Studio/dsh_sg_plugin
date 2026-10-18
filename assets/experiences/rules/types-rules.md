
# Type Definition Rules

> **Scope**: all files under `src/types/`
> **Priority**: Strong recommendation - strongly advised to follow

---

## TypeScript Strict Mode

### Compiler Options
```json
{
  "compilerOptions": {
    "strict": true,
    "strictNullChecks": true,
    "strictFunctionTypes": true,
    "noImplicitAny": true,
    "noImplicitReturns": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true
  }
}
```

### `any` Is Prohibited
```typescript
// Prohibited
function process(data: any) {
  return data.value;
}

// Recommended
function process(data: unknown) {
  if (typeof data === 'object' && data !== null && 'value' in data) {
    return (data as { value: string }).value;
  }
  throw new Error('Invalid data');
}
```

---

## Where Type Definitions Live

### Shared types → `src/types/`
- Types used across modules
- Common data structures
- API interface definitions

### Module-private types → inside the module
- Types used only within a single module
- Internal implementation details

### Rules
- Prohibited: defining the same type in multiple files
- Prohibited: defining shared types in business code
- Must: shared types live in `src/types/`

---

## Type Naming Conventions

### Interface Naming
```typescript
// Good naming
interface ProjectProfile {
  structure: StructureInfo;
  techStack: TechStackInfo;
}

interface ScannerOptions {
  rootDir: string;
  includeHidden: boolean;
}

// Bad naming
interface Data { }  // Too generic
interface Obj { }   // Meaningless
```

### Naming Rules
- Use PascalCase: `ProjectProfile`, `ScannerOptions`
- Interface names should be nouns or noun phrases
- Avoid the `I` prefix (do not use `IProjectProfile`)

---

## Union Types and Type Guards

### Union Types
```typescript
type ChangeStatus = 'proposing' | 'specing' | 'implementing' | 'completed';

type UnitType = 'agent' | 'skill' | 'rule';
```

### Type Guards
```typescript
// Use a type guard
function isAgent(unit: Unit): unit is AgentUnit {
  return unit.type === 'agent';
}

function processUnit(unit: Unit) {
  if (isAgent(unit)) {
    // TypeScript knows this is an AgentUnit
    console.log(unit.role);
  }
}
```

---

## Generics

### When to Use Generics
- Data structures (arrays, maps)
- Utility functions (filtering, transformation)
- API response wrappers

### Example
```typescript
// Good use of generics
interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

function validate<T>(data: unknown, schema: Schema<T>): T {
  // Validation logic
  return data as T;
}

// Overuse of generics
function process<T, U, V, W>(a: T, b: U, c: V): W {
  // Too complex; should be split
}
```

---

## Type Exports

###  Barrel Exports
```typescript
// src/types/index.ts
export * from './project';
export * from './config';
export * from './units';
export * from './plan';
```

### Usage
```typescript
// Good import
import { ProjectProfile, Config } from '../types';

// Bad import (path too deep)
import { ProjectProfile } from '../types/project';
```

---

## Documentation Comments

### JSDoc Comments
```typescript
/**
 * Project configuration interface
 * 
 * @example
 * ```typescript
 * const config: ProjectConfig = {
 *   platform: 'qoder',
 *   agents: ['architect', 'developer'],
 *   skills: ['tdd', 'debugging']
 * };
 * ```
 */
export interface ProjectConfig {
  /** AI platform (qoder, claude-code, cursor) */
  platform: PlatformType;
  
  /** Enabled Agent list */
  agents: AgentId[];
  
  /** Enabled Skill list */
  skills: SkillId[];
}
```

### Comment Requirements
- All exported types must have comments
- Provide `@example` for complex fields
- Document value ranges and constraints

---

## Type Evolution

### Backward Compatibility
```typescript
// Correct: adding an optional field (backward compatible)
interface ProjectConfig {
  platform: PlatformType;
  agents: AgentId[];
  /** @since 0.6.0 Optional experimental feature */
  experimental?: ExperimentalOptions;
}

// Wrong: removing a required field (breaking change)
interface ProjectConfig {
  // platform: PlatformType;  // Removed!
  agents: AgentId[];
}
```

### Version Markers
```typescript
/**
 * @since 0.5.0
 * @deprecated Use NewConfig instead
 */
export interface OldConfig {
  // ...
}
```

---

> **Important**: The type system is TypeScript's core strength; strict type definitions can catch 80% of runtime errors.
