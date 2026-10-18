# Skills 目录索引

> specgate DSH 插件完整能力体系，按使用场景分类组织。

---

## 📂 目录结构

```
skills/
├── sg-core/            # specgate 核心 Skills（12 个）
├── engineering/          # 日常代码工作（11 个 Skills）
├── productivity/         # 非代码工作流（4 个 Skills）
├── misc/                 # 偶尔使用（3 个 Skills）
└── README.md             # 本文件
```

> 30 个 Skill 全部由插件在 DSH 会话启动时注册；`/sg-init` 另外物化到项目 `.dsh/skills/specgate/`。

---

## 🎯 快速查找

| 场景 | 推荐 Skill | 位置 |
|------|-----------|------|
| **开始新功能** | `sg-skill-requirements-definition` → `sg-skill-architecture-design` | [engineering/](engineering/README.md) |
| **编写代码前** | `sg-skill-test-driven-development` | [engineering/](engineering/README.md) |
| **遇到错误** | `sg-skill-systematic-debugging` | [engineering/](engineering/README.md) |
| **合并前** | `sg-skill-code-review` | [engineering/](engineering/README.md) |
| **文档存档前** | `sg-skill-critical-review` | [engineering/](engineering/README.md) |
| **规划复杂任务** | `sg-skill-writing-plans` → `sg-skill-executing-plans` | [productivity/](productivity/README.md) |
| **Git 分支管理** | `sg-skill-using-git-worktrees` → `sg-skill-finishing-a-development-branch` | [productivity/](productivity/README.md) |
| **验证方案** | `sg-skill-prototype` | [misc/](misc/README.md) |
| **知识沉淀** | `sg-skill-experience-summarization` | [sg-core/](sg-core/) |
| **入口判定** | `sg-skill-entry-guard` | [sg-core/](sg-core/) |
| **规范驱动开发** | `/sg-propose` 命令 → OpenSpec 流程 | DSH 命令 |

---

## 📊 分类统计

| 分类 | Skills 数量 | 说明 |
|------|------------|------|
| [sg-core/](sg-core/) | 12 | 入口判定、变更分类、反模式、架构设计、知识调研、经验总结等 |
| [engineering/](engineering/README.md) | 11 | 需求分析、架构设计、TDD、调试、代码审查等 |
| [productivity/](productivity/README.md) | 4 | Git 工作流、计划管理等 |
| [misc/](misc/README.md) | 3 | 原型设计、术语管理、全局视角等 |
| **总计** | **30** | - |

---

## 📚 使用说明

### 完整指南

- [sg-using-skills](sg-core/sg-using-skills/SKILL.md) - 如何查找和使用 Skills

### 宪法级保障

specgate 采用**双重保障机制**：

1. **第一道防线**：设计者自查（`sg-skill-requirements-definition` / `sg-skill-architecture-design`）
2. **第二道防线**：独立审查者（`sg-skill-critical-review`）
3. **两道防线都通过** → 文档才能存档

### 必须使用的 Skills

根据 `AGENTS.md`，以下场景**必须**使用对应 Skill：

- ✅ 创造性工作前 → `sg-skill-requirements-definition`
- ✅ 需求批准后 → `sg-skill-architecture-design`
- ✅ 文档存档前 → `sg-skill-critical-review`
- ✅ 编写代码前 → `sg-skill-test-driven-development`
- ✅ 遇到错误时 → `sg-skill-systematic-debugging`
- ✅ 合并前 → `sg-skill-code-review`

---

## 🔗 相关资源

- `AGENTS.md` - AI 行为指令和 Skill 使用规范
- `CONTEXT.md` - 领域上下文和术语表
- `.specgate/experiences/index.md` - 已沉淀的知识资产
- `.specgate/agents/` - 可用的 Agent 角色文本
