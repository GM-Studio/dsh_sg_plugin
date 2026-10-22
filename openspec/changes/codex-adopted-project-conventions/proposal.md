# Adopted Delivery Closure and Project Conventions

## Why

The delivery-assurance MVP can establish an adopted ProjectProfile and
ProjectBaseline, but its downstream quality gate still uses the initialized
template verifier. It therefore cannot execute the same change workflow for an
existing repository, and it cannot distinguish an unchanged baseline failure
from a new regression.

Generated projects also expose the template's original `com.example.tasks`
package. New work must use the project's configured
`com.<company>.<business>` namespace, follow the generated project style, use
Chinese source comments, and provide Chinese-first frontend internationalization.

## Scope

- Add a ProjectProfile-aware command verifier for adopted projects.
- Compare current command outcomes with the accepted ProjectBaseline.
- Preserve unchanged known failures without treating them as passing evidence.
- Block new failures, missing evidence, commit drift and environment drift.
- Record ProjectProfile package and locale conventions.
- Generate Java packages and source paths from company and business names.
- Emit Chinese comments in generated source files.
- Add Vue i18n with `zh-CN` as the default and `en-US` as an alternate locale.
- Make development and test-design challenges carry the project conventions.

## Non-Goals

- Automatic fixes for third-party build, test or toolchain failures.
- Arbitrary Java package migration in an adopted repository.
- Translation of backend error or log text.
- Additional frontend locales beyond `zh-CN` and `en-US`.
