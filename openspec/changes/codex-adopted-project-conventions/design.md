# Design

## Adopted Verification

`src/codex/adopted-verification.js` executes the bounded
`ProjectProfile.commands` array in the integration/test worktree. It records
one result per command and computes the same failure signature used by the
baseline service.

The result is valid when:

- Profile and Baseline belong to the same project.
- The current environment fingerprint matches the Baseline.
- Every command result is terminal.
- Every changed failure matches a Baseline known-failure signature.

Known failures remain explicit and never become passing Evidence. Frozen
acceptance tests still must pass independently.

## Project Profile Extensions

ProjectProfile gains optional, backward-compatible conventions:

- `backendPackage`
- `frontendDefaultLocale`
- `frontendLocales`

New profiles always write them. Adopted profiles infer `backendPackage` from
the existing Java source tree when possible.

## Template Namespace

`javaFullstackFiles({ preset, company, business })` performs a deterministic
namespace projection:

- Java package: `com.<company>.<business>`
- Java source path: `com/<company>/<business>`
- Maven group: `com.<company>`
- Backend artifact and frontend package name use `<business>`.

The canonical template source hash excludes namespace substitutions so one
Golden record covers all valid company/business values.

Generation prepends a Chinese file-purpose comment to Java and frontend source
files. Frontend i18n resources use typed locale dictionaries and Vue I18n.

## Agent Context

Plan and development challenges include:

- `backendPackage`
- `frontendDefaultLocale`
- `frontendLocales`
- the frozen template-style reference path

Agents that add backend files MUST place them under the configured package and
source directory. Frontend copy MUST use i18n keys instead of hardcoded display
text.
