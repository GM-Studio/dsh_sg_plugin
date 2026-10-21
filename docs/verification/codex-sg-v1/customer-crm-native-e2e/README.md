# 客户 CRM 隔离 P6 → P9 验收

日期：2026-10-21（Asia/Shanghai）。

本次在独立的 `jdk8-boot2.7` Java/Vue 产品上，从冻结需求、冻结测试和 red baseline 开始，完整执行了：

```text
P5 测试冻结
  → P6 五个 worktree、Frontend/Backend 提交与 integration 合并
  → P7 冻结测试、真实构建/测试/覆盖率/runtime 验证
  → P8 strict Review
  → H3 复合证据审批
  → P9 合并 master、本地归档、push 到隔离 bare remote
```

## 产品范围

- Customer CRUD，字段为 `name/email/company/status/notes`。
- 查询使用 GET；创建、更新和删除使用 POST JSON，更新/删除 id 位于请求体。
- email 规范化为小写并做 ignore-case 唯一性检查；数据库列同时有唯一约束。
- status 只接受 `ACTIVE` 或 `INACTIVE`。
- 支持关键字搜索、status 筛选、分页和 `/api/customers/summary`。
- Vue `CustomerPanel` 支持汇总展示、筛选、创建、编辑和删除。

代码规模实测：`backend/src` 与 `frontend/src` 共 54 个文件、3,698 行；加入 `frontend/test` 和后端测试目录后共 56 个文件、4,099 行，低于 10,000 行限制。本次客户功能 delta 为 13 个文件、739 added lines。

## 结果

| 检查 | 实际结果 |
|---|---|
| red baseline | 4/4 cases 在实现前真实失败 |
| Frontend source commit | `40aa779deae60ff187683bd9dcacbab6527c1a3b` |
| Backend source commit | `45a8b82ef8bac35ffee9e2e04272513c51954ba3` |
| Integration commit | `1adb065b736c7acba31343e0a72c2572164f87df` |
| 最终冻结测试 | v8，`sha256:3d995657a33e1e49382c86b1c4495c95f7fc38830a38407b51993934dfc4e984` |
| P7 冻结 cases | 4 executed，4 passed，0 failed，0 skipped |
| 后端测试 | 15/15 passed，0 skipped |
| 前端测试 | 12/12 passed，0 skipped |
| 真实验证阶段 | 9/9 passed，0 failed，0 not-run |
| 后端覆盖率 | lines 95.81%，branches 80.33% |
| 前端覆盖率 | lines 93.86%，branches 94.57% |
| Changed-line coverage | 349/382 = 91.36%，`unavailable=0` |
| P7 quality hash | `sha256:a78b1ee25bfc0de519353e1d7a1709793c620a74dab6a59929491cc597b3e4ef` |
| P8 Review | strict mode，pass，P0–P3 findings 均为 0 |
| Review hash | `sha256:39e3c5b363308c5abddedb48a87c28cf8339aa1aadb80ad3ee10ef5c3ef16496` |
| H3 composite hash | `sha256:2504867572715d1e23a16edf6b374a3f801cee0309cdf761af229a926e2817c3` |
| P9 merge commit | `d19e7a455c0efc914ed50b2775f1e4b398c0b768` |
| P9 push | exit 0，隔离 bare remote `master` 与本地 HEAD hash 一致 |
| 最终状态 | `ARCHIVED` |

## 实际 Agent 执行矩阵

| 角色 | 实际执行 | 说明 |
|---|---|---|
| Test | `not-run` | 原生 Test Agent 未消费任务；冻结 runner 由主线程注入并真实执行，不冒充 Agent 回报 |
| Frontend | `not-run` | 原生 Frontend Agent 未消费任务；实现与提交由主线程完成，`frontend-result.json` 明确记录 |
| Backend | `not-run` | 原生 Backend Agent 未消费任务；实现与提交由主线程完成，`backend-result.json` 明确记录 |
| Review | `not-run` | challenge 已两次交给现存原生 Agent，均未产生结果；主线程完成只读 fallback Review，并在 review 报告中记录 |
| 构建/测试/验证 | `passed` | 所有结果为真实子进程和 runtime 证据，不依赖 Agent 自报 |

因此本次能够验收 P6 服务门、P7 构建/测试/覆盖率、P8 严格门和 P9 Git 归档 push，但不能声称“本轮所有原生 Agent 都已执行”。此前 Task priority E2E 的[原生 Agent P6→P7 验收](../p6-p7-native-agent-e2e/README.md)仍然有效，两者不能互相替代。

## 边界

- H1 与 H3 均为隔离 fixture 的 synthetic approval，不是 Codex Desktop 可信宿主用户审批。
- P9 push 目标是本地 bare remote，不是生产或第三方远端仓库。
- Review 是严格只读 validator 下的主线程 fallback；原生 Review Agent 生命周期桥仍为 `not-run`。
- 产品位于系统临时目录；关键结构化证据已复制到本目录。
- 插件仓库只做本地提交、标签和归档，不 push 或发布。

## 过程中修复的质量门缺陷

P7 首次完成了 91.36% changed-line coverage，但把 Spring Data 的纯声明 `CustomerRepository.java` 误算为“无覆盖证据”。修复规则为：只有缺少 JaCoCo sourcefile、且源码确认为无方法体/嵌套块的 declaration-only Java interface 时才视为无可执行行；普通 class、有方法体接口、不可读文件仍计为 `unavailable`。回归新增了纯接口通过和普通 class 失败两侧断言。

仓库 pre-commit 还发现 E2E Java fixture 尚无 checker。新增规则不再把测试文件当 data 跳过，而是在 JDK8 生成模板中物化 Customer 后端源码和测试，真实执行 `CustomerApiTest` 与 Checkstyle；本次 3/3 测试通过、0 Checkstyle 违规。

## 证据

- [结构化总览](summary.json)
- [P6 result](p6-result.json)
- [P7 result](p7-result.json)
- [P7 quality report](quality-report.json)
- [9-stage verification report](verification-report.json)
- [red evidence](red-evidence.json)
- [green frozen case report](green-case-report.json)
- [green backend log](green-backend.log)
- [green frontend log](green-frontend.log)
- [P8 result](p8-result.json)
- [strict review report](review-report.json)
- [H3 result](h3-result.json)
- [P9/archive result](p9-result.json)
- [archive report with push receipt](archive-report.json)
- [Frontend primary result](frontend-result.json)
- [Backend primary result](backend-result.json)
