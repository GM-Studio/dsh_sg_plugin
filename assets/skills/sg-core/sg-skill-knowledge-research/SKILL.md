---
name: sg-skill-knowledge-research
description: "SpecGate knowledge research Skill - Systematically conduct technical research and evaluate information"
---

# Knowledge Research Skill

## Purpose

Load this Skill when making technology choices, designing architecture, or validating assumptions, to conduct systematic research and produce a structured report that supports decisions.

## Research Methodology

```
Define the question → Search strategy → Evidence evaluation → Synthesize conclusions
```

### 1. Define the Question

- Turn a vague need into 1-3 specific, answerable questions
- Example: ❌ "Learn about microservices" → ✅ "Performance differences between gRPC and REST for internal communication"

### 2. Search Strategy

- Prefer English keywords when searching technical content
- Restrict to high-quality sources: site:github.com / site:arxiv.org
- Prefer content from the last 2 years; flag outdated content with a timeliness risk

### 3. Evidence Evaluation

| Source Tier | Credibility | Applicable Scenarios |
|-----------|--------|---------|
| Official documentation | Highest | Technology selection, API usage |
| Academic papers | High | Algorithm and architecture theory validation |
| Well-known technical blogs | Medium | Practical experience, solution comparison |
| Community discussions | Low (supporting evidence) | Edge cases, pitfall records |

- Key conclusions require cross-validation from at least 2 independent sources
- Mark single-source findings as "for reference only"

### 4. Synthesize Conclusions

- Distinguish "facts" from "opinions"
- Give clear action recommendations (not "it depends")
- Note the limitations of the research

## Output Format

```yaml
research_report:
  question: "Research question"
  findings:
    - claim: "Key finding 1"
      evidence: ["Source A URL", "Source B URL"]
      confidence: "high"
    - claim: "Key finding 2"
      evidence: ["Source C URL"]
      confidence: "medium"
  recommendation: "Clear action recommendation"
  limitations: ["insufficient information on xxx", "timeliness risk xxx"]
```

## Relationship with Knowledge Engineer

- This Skill provides the **research methodology and process**
- Knowledge Engineer (KE) **invokes this Skill** to execute concrete research tasks
- KE converts research reports into ADRs or experience entries

## Red Lines

- ❌ Accepting a single source without cross-validation
- ❌ Piling up information without synthesizing conclusions
- ❌ Confusing facts with personal opinions
