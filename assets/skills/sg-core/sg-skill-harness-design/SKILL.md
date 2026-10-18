---
name: sg-skill-harness-design
description: "SpecGate seven-layer architecture methodology Skill, guiding system layering design and inter-layer dependency analysis"
---

# Seven-Layer Architecture Methodology Skill

## Purpose

When designing system architecture or reviewing an architecture proposal, load this Skill to analyze system layering with the seven-layer model, ensuring clear responsibilities and correct dependencies.

## Seven-Layer Definition

| Layer | Name | Responsibility | Typical Contents |
|------|------|------|---------|
| 7 | Presentation layer | User interaction and interface rendering | UI components, API Gateway, CLI |
| 6 | Application layer | Use case orchestration and process coordination | Service, Controller, UseCase |
| 5 | Domain layer | Core business logic and rules | Entity, Domain Service, Value Object |
| 4 | Infrastructure layer | Abstraction and encapsulation of technical capabilities | Repository Interface, Cache, MQ |
| 3 | Data layer | Data persistence and access | DB, ORM, Migration, Query |
| 2 | Integration layer | External system integration and adaptation | SDK, Client, Adapter, Webhook |
| 1 | Operations layer | Deployment, monitoring, observability | CI/CD, Logging, Metrics, Alerting |

## Inter-Layer Dependency Rules

```
Upper layer ──depends on──→ lower layer

Presentation → Application → Domain → Infrastructure → Data
                          ↓
                     Integration
                          ↓
                     Operations (independent, depended on by all layers)
```

- **Only upper layers may depend on lower layers**; reverse dependencies are forbidden
- **The domain layer is the purest** and depends on no framework or infrastructure details
- **Cross-layer calls must go through the intermediate layers**; skipping is forbidden

## Layering Analysis Guide

When analyzing an existing system or designing a new one, follow these steps:

1. **Identify the components of each layer**: map existing code/modules onto the seven layers
2. **Check the dependency direction**: confirm there are no reverse dependencies and no cross-layer skips
3. **Assess layer cohesion**: whether components within each layer share consistent responsibilities
4. **Mark blurred boundaries**: a component that is hard to classify = a signal to split it

## Output Format

```yaml
architecture_review:
  layer_mapping:
    presentation: ["api-gateway", "cli-parser"]
    application: ["change-service", "review-orchestrator"]
    domain: ["change-entity", "classification-rule"]
    infrastructure: ["repository-interface", "cache-manager"]
    data: ["postgres-adapter", "migration-scripts"]
    integration: ["git-client", "webhook-handler"]
    ops: ["docker-compose", "prometheus-config"]
  issues:
    - severity: "critical"
      description: "the domain layer calls the postgres driver directly"
      fix: "abstract data access behind repository-interface"
  score: "7/10"
```

## Red Lines

- ❌ A framework import in the domain layer = layering failure
- ❌ The data layer calling the application layer = circular dependency
- ❌ Skipping inter-layer abstraction on the grounds of "convenience"
