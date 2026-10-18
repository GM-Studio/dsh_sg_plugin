# Engineering Skills

日常代码工作相关的 Skills，涵盖需求分析、架构设计、开发流程、代码质量等核心工程能力。

---

## 📋 Skills 列表

### specgate 核心 Skills

> **注意**: specgate 核心 Skills 已移至 `../sg-core/` 目录，此处仅保留索引引用。

| Skill | 描述 | 触发场景 |
|-------|------|---------|
| [sg-skill-requirements-definition](sg-skill-requirements-definition/SKILL.md) | 需求定义 - 创造性工作前进行深度需求盘问 | 创建新功能、构建组件、添加功能、修改行为 |
| [sg-skill-architecture-design](sg-skill-architecture-design/SKILL.md) | 架构设计 - 需求批准后进行技术方案设计 | 需求文档完成，准备进入实施阶段 |
| [sg-skill-critical-review](sg-skill-critical-review/SKILL.md) | 批判性审核 - 独立审查文档质量 | 文档完成，等待存档前 |
| [sg-skill-code-review](sg-skill-code-review/SKILL.md) | 代码审查 - 合并前验证代码质量 | 完成任务、实施主要功能、合并前 |
| [sg-skill-domain-modeling](sg-skill-domain-modeling/SKILL.md) | 领域建模 - 建立领域语言和模型 | 复杂业务逻辑设计 |
| [sg-skill-improve-architecture](sg-skill-improve-architecture/SKILL.md) | 架构改进 - 发现架构深化机会 | 定期运行、调试发现架构问题 |
| [sg-skill-triage-brief](sg-skill-triage-brief/SKILL.md) | 任务分类 - 生成结构化 Agent Brief | 任务分配、Issue 创建 |
| [sg-skill-vertical-slicing](sg-skill-vertical-slicing/SKILL.md) | 垂直切片 - 任务分解为可交付切片 | 实施计划分解 |

**已移至 sg-core/**:
- `sg-skill-anti-patterns` → [../sg-core/sg-skill-anti-patterns.md](../sg-core/sg-skill-anti-patterns.md)
- `sg-skill-change-classification` → [../sg-core/sg-skill-change-classification.md](../sg-core/sg-skill-change-classification.md)
- `sg-skill-harness-design` → [../sg-core/sg-skill-harness-design.md](../sg-core/sg-skill-harness-design.md)

### 工程实践 Skills

| Skill | 描述 | 触发场景 |
|-------|------|---------|
| [sg-skill-test-driven-development](sg-skill-test-driven-development/SKILL.md) | TDD - 测试驱动开发 | 实施任何功能或错误修复之前 |
| [sg-skill-systematic-debugging](sg-skill-systematic-debugging/SKILL.md) | 系统调试 - 根因追踪和修复 | 遇到任何错误、测试失败 |
| [sg-skill-writing-skills](sg-skill-writing-skills/SKILL.md) | 编写技能 - 创建/编辑 Skill 文档 | 创建新 Skill、编辑现有 Skill |

---

## 🎯 使用指南

### 典型工作流

```
需求定义 (requirements-definition)
  ↓ 产出需求文档
  ↓
批判性审核 (critical-review)
  ↓ 审核通过
  ↓
架构设计 (architecture-design)
  ↓ 产出架构文档
  ↓
批判性审核 (critical-review)
  ↓ 审核通过
  ↓
垂直切片分解 (vertical-slicing)
  ↓ 产出实施计划
  ↓
TDD 开发循环 (test-driven-development)
  ↓ RED → GREEN → REFACTOR
  ↓
代码审查 (code-review)
  ↓ 修复问题
  ↓
完成前验证 (verification-before-completion)
  ↓ 测试通过
  ↓
合并 ✅
```

### 宪法级保障机制

specgate 采用**双重保障机制**确保文档质量：

1. **第一道防线**：设计者自查（requirements-definition / architecture-design）
2. **第二道防线**：独立审查者（critical-review）
3. **两道防线都通过** → 文档才能存档

---

## 📚 参考资料

- [AGENTS.md](../../../../AGENTS.md) - AI 行为指令和 Skill 使用规范
- [CONTEXT.md](../../../../CONTEXT.md) - 领域上下文和术语表
