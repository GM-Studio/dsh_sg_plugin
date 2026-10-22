# Codex 多变更工作流需求

- 状态：历史输入，已汇总到
  `docs/requirements/2026-10-22-codex-delivery-mvp-requirements-analysis.zh.md`
- 后续实施口径以需求分析文档为准
- 适用宿主：Codex
- 实现基线：`9ec23444ed230e7499ca444c5e06c5d8e0e8f7bb`
- 计划分支：`codex/multi-change-workflow`
- 目标版本：`4.3.2`

## 1. 背景

当前 Codex 版 SpecGate 的 change 入口以新增功能为主要场景。实际项目交付还包括 Bug 修复、功能修改、功能删除和代码重构，这些工作同样需要经过需求澄清、测试设计、真实实现、静态检查、格式化、Review、审批和归档。

本需求将 `sg_change` 定义为统一入口。需求分析阶段先分析用户描述、受影响范围和变更类型，需求确认后再把任务动态派发到对应工作流。所有类型共享同一套可审计门禁，但按变更语义使用不同的输入、Agent 分工和验证规则。

## 2. 目标

1. 支持 `feature`、`fix`、`modify`、`delete`、`refactor` 五类变更。
2. 所有变更从统一入口 `sg_change` 开始，需求分析前置。
3. 需求确认后，根据变更类型和前后端影响范围动态选择工作流与项目级 Agent。
4. Bug 修复和重构分别拆分为前端、后端两个专属 Agent。
5. 新增、修改和删除功能复用现有前后端开发工作流。
6. 所有类型复用现有测试设计、集成、真实测试、格式化、Review、H3、归档和合并能力。
7. 每个 change 的代码变更和随动文档都来自该 change 已确认的需求，不接受需求之外的范围扩张。

## 3. 非目标

1. 不扩展 DSH v3 工作流。
2. 不修改 DSH 命令、工具或初始化器。
3. 不改变现有审批权威来源，不允许由 MCP 参数、Agent 自述或环境变量伪造用户审批。
4. 不允许主 Agent 直接编辑产品代码来代替要求的子 Agent 实现。
5. 不自动 push、发布 npm 包或修改插件仓库以外且不在当前 change 范围内的项目。
6. 不把生成、格式化或静态检查结果冒充真实测试结果。

## 4. 术语

| 术语         | 定义                                                                           |
| ------------ | ------------------------------------------------------------------------------ |
| `changeType` | 变更语义，固定为 `feature`、`fix`、`modify`、`delete`、`refactor`              |
| `workflow`   | 需求确认后执行的工作流，分别为 `add`、`fixbug`、`modify`、`delete`、`refactor` |
| 前端范围     | Vue/React、页面、组件、前端测试、前端 API 客户端及相关文档                     |
| 后端范围     | Java/Spring Boot、Node 或 Python 服务端代码、接口、持久化、后端测试及相关文档  |
| 回归测试     | 在修复前能够稳定复现 Bug、修复后必须通过的测试                                 |
| 行为不变量   | 重构前后必须保持相同的可观察外部行为、接口契约和数据语义                       |
| 冻结测试     | 经 Test Designer 生成、经服务端确认并冻结，产品 Agent 不得直接修改的测试资产   |

## 5. 变更类型和动态派发

| `changeType` | `workflow` | 说明                                 | 实现 Agent                                                    |
| ------------ | ---------- | ------------------------------------ | ------------------------------------------------------------- |
| `feature`    | `add`      | 新增功能、接口、页面或能力           | `specgate_frontend`、`specgate_backend`                       |
| `fix`        | `fixbug`   | 修复已有行为与期望行为不一致的问题   | `specgate_frontend_fixer`、`specgate_backend_fixer`           |
| `modify`     | `modify`   | 修改现有功能的行为、接口或交互       | `specgate_frontend`、`specgate_backend`                       |
| `delete`     | `delete`   | 删除不再需要的功能、接口、页面或代码 | `specgate_frontend`、`specgate_backend`                       |
| `refactor`   | `refactor` | 在不改变外部行为的前提下调整代码结构 | `specgate_frontend_refactorer`、`specgate_backend_refactorer` |

派发规则：

1. 主 Agent 先调用统一的 `sg_change` 入口，不根据表面关键词立即进入实现阶段。
2. 需求分析必须识别用户意图、现有功能、期望变化、前后端影响和数据/API/文档影响。
3. 若变更类型不明确，先向用户澄清；不得静默归类。
4. 需求确认时固定 `changeType`、`workflow`、受影响范围、兼容性结论和验收标准。
5. 只有确认后的 H1 才允许进入计划、测试设计和实现。
6. 仅一个端受影响时只派发对应 Agent；两端均受影响时并行派发。
7. 两端都受影响时，任一端的失败都不能被另一端的成功掩盖。

兼容要求：

1. 新增标准统一入口 `sg_change`。
2. 保留 `sg_change_add`，作为 `changeType=feature` 的兼容别名。
3. 现有 `sg_change_propose`、`sg_change_questions`、`sg_change_critique` 和 `sg_request_h1` 继续作为需求阶段工具。

## 6. 功能需求

### FR-001 统一需求入口

`sg_change` MUST 接受用户变更描述、可选变更类型、可选 change 名称和当前状态版本。若用户未提供类型，系统 MUST 在需求分析阶段给出推荐的 `changeType` 和 `workflow`，并由需求确认环节固定。

### FR-002 需求分析前置

系统 MUST 在任何代码、测试或实现工作开始前完成需求分析和澄清，至少覆盖：

- 业务目标和非目标
- 当前行为与期望行为
- 受影响的前端、后端、接口、数据和文档
- 兼容性要求
- 可观察的验收标准
- 失败、边界、安全和性能风险

未确认的需求 MUST 保持在需求阶段，不得进入计划或实现。

### FR-003 `fix` 输入

`fix` MUST 收集：

- Bug 描述
- 期望行为
- 实际行为

可选信息：

- 复现步骤
- 受影响模块或路径
- 错误日志或堆栈
- 发生环境
- 严重级别和影响范围

敏感日志、令牌、密码和认证信息 MUST 脱敏后进入 change 记录。

### FR-004 `modify` 输入

`modify` MUST 收集：

- 要修改的现有功能
- 目标行为或目标变化
- 兼容性要求
- 明确不变的现有行为

### FR-005 `delete` 输入

`delete` MUST 收集：

- 要删除的功能、接口、页面或代码范围
- 兼容性要求
- 数据处置方式
- 是否保留废弃过渡入口
- 需要同步删除或替换的测试与文档

### FR-006 `refactor` 输入

`refactor` MUST 收集：

- 重构范围
- 重构目标
- 非目标
- 必须保持不变的外部行为和接口契约
- 必须保持或改善的性能、安全、可维护性约束

若无法定义行为不变量，系统 MUST 要求用户补充或转为 `modify`，不得把行为变化伪装成重构。

### FR-007 Bug 回归测试

`fix` MUST 在实现修复前产生一个真实失败的回归测试。该测试必须：

- 对应明确的 Bug 和验收标准
- 在未修复基线上失败
- 在修复后通过
- 不使用伪造结果或跳过标记

如果无法稳定复现，服务端 MUST 保留失败原因并阻止进入修复完成状态。

### FR-008 重构不变量

`refactor` MUST 保持确认过的行为不变量。已有测试默认不得改动；若覆盖不足，只允许在冻结前补充 characterization test。重构完成后 MUST：

- 原有测试全部通过
- 新增 characterization test 通过
- 不产生未审批的 API、数据或行为变更
- Review 明确说明重构职责拆分和风险

### FR-009 修改和删除复用

`modify` 和 `delete` MUST 复用现有功能开发工作流、前后端 Agent、测试设计、质量门禁、格式化、Review 和归档能力。两者通过不同的需求模板、验收规则和兼容性检查体现差异。

### FR-010 Agent 分工

项目安装器 MUST 提供以下专用 Agent：

- `specgate_frontend_fixer`
- `specgate_backend_fixer`
- `specgate_frontend_refactorer`
- `specgate_backend_refactorer`

既有 Agent 继续使用：

- `specgate_test_designer`
- `specgate_frontend`
- `specgate_backend`
- `specgate_tester`
- `specgate_formatter`
- `specgate_reviewer`

Agent 边界：

1. fixer/refactorer Agent 只能修改对应端的产品代码和已确认的随动文档，不得直接修改冻结测试。
2. 前端 Agent 不得修改后端实现，后端 Agent 不得修改前端实现。
3. 共享契约、配置或跨端文件若有变更需求，必须在计划和角色策略中明确归属。
4. 主 Agent 只负责需求、编排、派发、等待和验证，不得把主线程编辑报告为子 Agent 结果。

### FR-011 文档随动

每个 change MUST 根据自身需求同步更新受影响文档：

- proposal、spec、design、tasks
- AC、测试用例和 mapping
- API 文档和 OpenAPI
- 数据模型、迁移和兼容说明
- 使用说明、运维说明和示例

若某项文档实际不受影响，change MUST 明确记录“不适用”及原因。不得产生与需求无关的文档改动。

### FR-012 统一质量门禁

所有类型 MUST 复用并按顺序通过：

1. 需求确认 H1
2. 计划和契约冻结
3. 测试设计并冻结
4. 前后端实现
5. 独立集成
6. 真实测试和静态质量检查
7. 格式化
8. Review
9. H3 审批
10. 归档
11. 合并目标分支

任一阶段失败 MUST 保留 worktree、分支、命令日志、报告和失败原因。

## 7. 数据流向

```text
用户描述
  -> 主 Agent
  -> sg_change 统一入口
  -> 需求分析 / 类型建议 / 前后端范围识别
  -> 需求澄清与 Requirements Revision
  -> H1 需求确认
  -> Plan（任务、AC、文件、测试和角色拆分）
  -> Workflow Resolver
       feature -> add
       fix -> fixbug
       modify -> modify
       delete -> delete
       refactor -> refactor
  -> Test Designer
  -> 冻结测试资产
  -> 前端 Agent + 后端 Agent（按影响范围并行）
  -> 独立 worktree commit
  -> 服务端校验路径、祖先关系和角色边界
  -> Integration worktree
  -> Tester / 真实测试 / 静态检查
  -> Formatter worktree
  -> Reviewer
  -> H3 审批
  -> Archive
  -> 本地合并到 sg-codex
```

数据持久化职责：

| 数据                         | 保存位置                                           | 约束                                 |
| ---------------------------- | -------------------------------------------------- | ------------------------------------ |
| 状态和 change 标识           | `.specgate/codex/state.json`                       | 只能由服务端状态存储写入             |
| 审计事件                     | `.specgate/codex/events.jsonl`                     | 追加式、带哈希链                     |
| change 类型和工作流          | change 状态及审计事件                              | H1 后不可静默改变                    |
| 用户请求和需求修订           | `.specgate/codex/changes/<changeId>/requirements/` | 保留每次修订和来源                   |
| 计划和冻结契约               | `.specgate/codex/changes/<changeId>/plan/`         | 带内容哈希                           |
| 测试资产                     | `.specgate/codex/changes/<changeId>/tests/`        | v1 不可覆盖，替换必须版本化          |
| 质量、格式、Review、归档证据 | 对应 change 子目录                                 | 与固定 commit 和哈希绑定             |
| 产品代码和随动文档           | 项目仓库                                           | 只能由获准角色在隔离 worktree 中修改 |

## 8. 工作逻辑

### 8.1 需求分析

1. 主 Agent 读取当前状态和项目约束。
2. `sg_change` 记录原始请求，补齐当前 `expectedVersion`。
3. 系统分析变更类型、受影响端、接口、数据、文档和兼容性。
4. 类型不明确或 `refactor` 行为不变量不完整时，继续提问。
5. Requirements Revision 记录功能需求、非功能需求、假设、风险和开放问题。
6. Critique 必须覆盖歧义、矛盾、不可行项、非功能风险、测试盲点和遗漏问题。
7. H1 必须由可信用户审批；缺失审批时保持 `H1_PENDING`。

### 8.2 计划与派发

1. H1 后固定 `changeType`、`workflow`、AC 和影响范围。
2. Plan 为每项 AC 建立前后端任务、测试任务、文档任务和依赖关系。
3. 根据实际文件影响确定是否需要前端 Agent、后端 Agent 或两者。
4. `fix` 和 `refactor` 使用对应 fixer/refactorer Agent。
5. `feature`、`modify` 和 `delete` 使用现有前后端 Agent。
6. 两端任务独立时并行执行；存在明确依赖时按计划顺序执行。

### 8.3 测试和实现

1. Test Designer 生成测试并完成冻结。
2. `fix` 先运行回归测试，确认失败。
3. 产品 Agent 在独立 worktree 中实现，生成固定 commit。
4. 服务端验证 commit 基于冻结点、路径符合角色边界且没有修改冻结测试。
5. 服务端完成集成；集成冲突进入冲突处理流程。
6. Tester 使用冻结测试和真实命令验证集成 commit。

### 8.4 Review、归档和合并

1. 测试和格式化通过后才允许 Review。
2. Review MUST 检查需求覆盖、兼容性、文档随动、测试真实性和变更边界。
3. Review 有阻断项时回到对应前后端 Agent 的新轮次，不得由 Reviewer 自行修改。
4. H3 通过后归档该 change 的需求、计划、测试、质量、格式、Review 和 commit 证据。
5. 归档完成后才允许合并 `codex/multi-change-workflow` 到 `sg-codex`。
6. 合并后重新确认目标分支工作树干净且完整回归通过。

## 9. 冲突处理

### 9.1 可自动处理

以下冲突可在对应 Agent worktree 中自动解决：

- 明确的文本合并冲突
- 不改变业务语义的 import、格式或相邻代码合并
- 同一角色范围内的简单重命名或代码移动

解决后 MUST 重新执行该角色边界检查、集成、测试、格式化和 Review。

### 9.2 必须人工确认

以下冲突 MUST 停止并请求用户确认：

- 冻结测试、需求或验收标准冲突
- API 契约、HTTP 方法、响应结构或鉴权语义冲突
- 数据库字段、迁移策略或历史数据语义冲突
- 前后端角色归属冲突
- 无法证明行为等价的冲突
- 安全、权限、并发或事务语义冲突

## 10. 兼容性和破坏性变更

破坏性 API 变更包括：

- 删除或重命名已有接口、资源、字段或枚举值
- 增加无默认值的必填请求字段
- 改变请求体、响应体、错误结构或成功状态码
- 改变鉴权、权限或关键业务语义
- 删除或改变数据库字段含义、类型或可用数据
- 删除功能后不提供兼容入口或迁移说明

若 change 包含破坏性变更，MUST：

1. 在需求和设计中显式标记 `breaking-change`。
2. 记录受影响调用方、数据和迁移方式。
3. 在 H1 和 H3 中展示该风险。
4. 更新 API 文档、OpenAPI、迁移说明和 CHANGELOG。
5. 未获得审批时阻止冻结、归档和合并。

## 11. 非功能需求

### NFR-001 安全性

- 用户输入、Bug 日志和需求文档中的密钥、令牌、密码和个人敏感信息必须脱敏。
- 所有路径必须经过项目边界检查。
- 不允许通过工具参数注入审批、角色、用户身份或冻结哈希。

### NFR-002 可审计性

- 类型判定、需求修订、H1、任务拆分、Agent 结果、命令日志和合并都必须有审计记录。
- 报告必须绑定固定 commit 和内容哈希。
- 未执行、跳过和失败项必须明确记录，不能计为通过。

### NFR-003 隔离性

- 前后端 Agent 使用独立 worktree 和分支。
- frozen test、review 和 format 路径遵守现有不可变边界。
- 失败产物不得被自动清理，便于恢复和审计。

### NFR-004 一致性

- `changeType`、`workflow`、Plan、Agent 角色、测试和 Review 必须引用同一个 `changeId`。
- 状态写入必须使用现有 CAS/版本控制。
- 不允许并发创建多个活动 change。

### NFR-005 向后兼容

- 现有 Codex 工具和插件项目安装方式不能被破坏。
- `sg_change_add` 继续支持现有新增功能调用。
- 现有测试、格式化、Review、归档和恢复能力不能被绕过。

### NFR-006 可测试性

- 每种 changeType 必须有成功路径、输入校验失败、角色越界和审批失败测试。
- 必须覆盖单端、双端、无代码影响和破坏性 API 场景。
- 必须验证旧 `sg_change_add` 兼容别名。

## 12. 文档和发布

1. 本次实现完成后更新 `README.md`、`README.en.md` 和 `skills/sg-codex/SKILL.md`。
2. 在 `openspec/changes/` 下保存本功能的 proposal、spec、design 和 tasks。
3. 同步更新中英文 `CHANGELOG`。
4. `package.json` 版本升级为 `4.3.2`。
5. Codex 插件清单版本按仓库既定规则校验，避免与 npm 包版本和宿主兼容性声明不一致。
6. 不 push、不发布 npm 包。

## 13. 验收场景

### AC-001 新增功能动态派发

- GIVEN 用户请求新增一个功能
- WHEN `sg_change` 完成需求分析和 H1
- THEN change 固定为 `feature`，派发到 `add`，使用现有前后端 Agent

### AC-002 Bug 单端修复

- GIVEN Bug 只影响前端
- WHEN 需求确认并冻结回归测试
- THEN 只派发 `specgate_frontend_fixer`，后端 Agent 不参与，真实测试通过

### AC-003 Bug 双端修复

- GIVEN Bug 同时影响前后端
- WHEN H1 和测试冻结完成
- THEN 两个 fixer Agent 在独立 worktree 并行执行，服务端完成集成和真实验证

### AC-004 功能修改

- GIVEN 用户需要改变现有功能行为
- WHEN `sg_change` 识别为 `modify`
- THEN 复用现有前后端 Agent，更新受影响测试和文档，并明确兼容性

### AC-005 功能删除

- GIVEN 用户要求删除一个功能或接口
- WHEN 存在破坏性 API 或数据影响
- THEN 需求显式标记 breaking change，完成迁移和文档更新，并在 H1/H3 中审批

### AC-006 重构

- GIVEN 用户要求重构前后端模块且外部行为不变
- WHEN 需求和行为不变量确认
- THEN 前后端 refactorer Agent 并行执行，原测试不改且全部通过

### AC-007 类型不明确

- GIVEN 用户描述可以解释为修改或新增
- WHEN 需求分析无法唯一判定
- THEN 系统向用户提问，不创建实现任务

### AC-008 冲突处理

- GIVEN 前后端修改产生简单文本冲突
- WHEN 对应 Agent 解决冲突
- THEN 重新执行路径校验、测试、格式化和 Review

### AC-009 语义冲突

- GIVEN 冲突涉及测试、API、数据库或安全语义
- WHEN 服务端识别为不可自动安全合并
- THEN 停止并请求人工确认

### AC-010 归档和合并

- GIVEN 所有质量门禁和 H3 已通过
- WHEN change 完成归档
- THEN 本地合并到 `sg-codex`，不 push，工作树干净且完整回归通过

### AC-011 旧接口兼容

- GIVEN 现有调用方仍调用 `sg_change_add`
- WHEN 新版本部署
- THEN 调用等价于 `sg_change` 的 `feature` 工作流，不破坏已有参数

## 14. 交付约束

1. 需求文稿确认后，以 `9ec23444ed230e7499ca444c5e06c5d8e0e8f7bb` 为基线创建 `codex/multi-change-workflow`。
2. 在该分支完成实现、测试、Review 和归档。
3. 形成一次完整提交。
4. 本地合并回 `sg-codex`。
5. 不 push、不发布、不修改无关项目。
