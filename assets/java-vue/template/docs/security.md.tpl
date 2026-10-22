# Starter security scope

Supplied controls: Spring Security authorization, Session Cookie login/logout, explicit session rotation, CSRF, BCrypt hashes of environment-supplied passwords, two fixed roles, bounded login failures, loopback binding, safe generic JSON errors, trace ids and bounded CSV import/export processing.

This remains a local reference application. It does not provide registration, password recovery, SSO, tenant/owner isolation, antivirus scanning, shared/distributed sessions or production database migrations. Protect the database with operating-system permissions.

## Legacy stack

Java 8 / Spring Boot 2.7 is out of ordinary open-source support. It is a compatibility preset, not a production recommendation. A maintained vendor JDK and separate dependency/advisory review are required. Pinning versions demonstrates compatibility, not absence of vulnerabilities.

## Exact frontend versions

Vue 3.5.30, Element Plus 2.11.8, Vite 7.3.1, TypeScript 5.9.3, vue-tsc 3.2.5, Vitest/@vitest/coverage-v8 4.0.18, ESLint 9.39.2 and Prettier 3.8.1. The committed npm lockfile fixes transitive resolution. Re-check advisories and compatibility before upgrading; do not replace pins with latest.

Java formatting uses Spotless and Google Java Format AOSP. Checkstyle enforces the documented subset of Alibaba style; no tool result is represented as full handbook compliance. JaCoCo and Vitest enforce both sides' coverage independently, with no business-source exclusion.
