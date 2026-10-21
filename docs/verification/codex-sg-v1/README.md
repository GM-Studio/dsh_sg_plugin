# Codex SG v1 验证记录

当前执行分支为 `sg-codex`。P0–P9 核心与本地回归已实施；原生 Test/Frontend/Backend Agent 的 P6→P7 生成产品 E2E 已通过。完整 v1 仍受真实 Review/H3 可信宿主链路和真实 remote push 验收阻塞。

## 最新增量：P5/P9

| 检查 | 实际结果 | 证据 |
|---|---|---|
| P7/P8/P9/协议组合回归 | 26 通过，0 失败 | [P8/P9 验证汇总](p8-p9/README.md) |
| `npm test` | 553 总计；552 通过，0 失败，1 跳过 | [P8/P9 验证汇总](p8-p9/README.md) |
| `npm run lint` | exit 0 | [P8/P9 验证汇总](p8-p9/README.md) |
| `npm run format:check` | exit 0 | [P8/P9 验证汇总](p8-p9/README.md) |
| `npm pack --dry-run`（临时缓存） | exit 0，1196 files | [P8/P9 验证汇总](p8-p9/README.md) |
| 原生 Agent P6→P7 | 2/2 冻结 cases、14/14 后端、12/12 前端、9/9 阶段通过 | [E2E 验收](p6-p7-native-agent-e2e/README.md) |

P6–P9 已分别用真实临时 Git worktree、子进程和 bare remote 验证开发、质量、Review、H3 绑定、无 remote、push failure 与 push。真实 Review Agent、可信 H3 和远端 push 仍未执行。各阶段设计与边界见[阶段进度](../../plans/codex-sg-change-add-v1-progress.md)、[P5/P6 设计](../../design/codex-p5-p6-development.zh.md)、[P7 设计](../../design/codex-p7-quality.zh.md)和[P8/P9 设计](../../design/codex-p8-p9-review-release.zh.md)。

## P0 历史基线

以下结果保留 P0 当时的交付证据，不代表后续阶段状态。

| 检查 | 实际结果 | 证据 |
|---|---|---|
| P0 协议与打包专项 | 10 通过，0 失败，0 跳过 | [命令与统计](p0/final-focused-command.json)、[原始输出](p0/final-focused.stdout.txt) |
| `npm test` | 425 总计；424 通过，0 失败，1 跳过 | [命令与统计](p0/final-npm-test-command.json)、[stdout](p0/final-npm-test.stdout.txt)、[stderr](p0/final-npm-test.stderr.txt) |
| `npm run lint` | exit 0 | [命令](p0/final-lint-command.json)、[输出](p0/final-lint.stdout.txt) |
| `npm run format:check` | exit 0 | [命令](p0/final-format-check-command.json)、[输出](p0/final-format-check.stdout.txt) |
| `npm pack --dry-run`（隔离缓存） | exit 0，包含 Codex manifest/MCP/Skills/入口 | [命令](p0/final-pack-command.json)、[完整清单](p0/final-pack.stdout.txt) |
| stdio 握手、三工具、ping、EOF | exit 0，stderr 为空 | [命令](p0/final-stdio-command.json)、[完整请求/响应](p0/final-stdio-smoke.json) |
| Skill 格式校验 | `quick_validate.py skills/sg-codex` → `Skill is valid!` | 结构校验，不等于宿主 Skill 调用验收 |

全量回归的 1 个跳过来自现有 Python venv 测试：本机没有 `py -3.12`。未将该测试标记为通过。

第一次打包预检因默认 npm 缓存不在可写沙箱内失败；[失败命令](p0/pack-dry-run-command.json)与[错误输出](p0/pack-dry-run.stderr.txt)保留。改用临时缓存后通过，没有修改用户缓存权限或提升执行权限。

P0 专项测试真实执行了离线 tarball 安装和安装后入口启动；同时验证了非空项目零写、旧状态保留、中文/空格目录、版本协商、握手顺序、错误 JSON、非法信封、batch 拒绝、未知工具/方法、伪造批准参数拒绝、超限/截断输入和尾部 stdout 污染不能伪装成 smoke 通过。

## 扫描与完整性

- [汇总结论](p0/verification-summary.json)：分支、兼容基线、检查命令、已知跳过与未验证项。
- [源文件清单](p0/repository-scan.json)：886 个原跟踪文件；196 个源/脚本/测试文件的清单、行数、导出符号和 SHA-256。清单包括本次新增源码。
- `index.js`、`src/v3/`、`src/v4/` 没有 diff；`sg-java` 与本次基线 commit 一致，没有提交或推送。
- 两份预先存在的未跟踪需求/计划文档内容 hash 已核对并保留。
- [设计和宿主边界](../../design/codex-plugin-p0.zh.md)、[阶段进度](../../plans/codex-sg-change-add-v1-progress.md)。

## 尚未验证

- Codex Desktop 原生审批的可信用户来源；
- 产品 MCP 对原生 subagent 的自动宿主桥、取消和生命周期接入；本次 E2E 使用验收编排调用原生 Agent；
- 真实 Review Agent、可信 H3 和真实 remote push；
- Linux 四档真实验收和完整项目覆盖率门。

P3 的 Windows 四档结果已保存于 [windows-run-3](p3/windows-run-3/matrix.json)，Linux 明确保持 `not-run`。[P0 AC 映射](p0/acceptance-map.json)继续作为历史记录，不能被 P6 的合成角色测试替代。
