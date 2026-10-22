# SpecGate for Codex

SpecGate 是一个 Codex 原生插件，用受控 MCP 状态、真实 subagents、独立
worktrees 和机器可审计证据完成项目接入、变更交付、独立验证、验收记录和增量再交付。

[English](README.en.md) · [源码加载 Quickstart](docs/quickstart-codex-source.zh.md)

## 能力

- 新建 Java/Vue 项目可生成并建立可靠 Baseline。
- 存量 Java/Vue 项目通过只读预览接入；脏工作区按显式批准文件提交。
- `sg_change` 统一支持 feature、modify 和 fix；`sg_change_add` 保留兼容。
- H1 冻结需求、ChangeContract 和验收标准。
- Test Designer 先于实现提交可执行测试。
- Frontend 与 Backend implementation 在独立 worktree 中串行执行。
- Tester 执行冻结用例和真实 Maven、Vitest、HTTP、运行时验证。
- Formatter 在独立 worktree 格式化，Reviewer 对固定提交做只读走查。
- 证据记录 commit、AC、环境指纹、Flaky 状态和未执行项。
- H3 后生成不可变 DeliveryRecord、本地 tag、内部证据包和客户交付包。
- 客户反馈引用上一 Delivery 进行影响分析和增量再交付。
- 远程推送必须显式 `push=true`，且不支持 force push。
- 默认不部署生产环境，不自动执行生产数据库回滚。

## 从源码加载

```powershell
cd E:\ai_workflow\specgate
npm ci
codex plugin marketplace add E:\ai_workflow\specgate
codex plugin add specgate-codex@specgate-source
node E:\ai_workflow\specgate\scripts\codex-source-setup.mjs --project <项目绝对路径>
codex -C <项目绝对路径>
```

然后在 Codex 中要求按 `AGENTS.md` 和 `sg-codex` Skill 执行。详细步骤见
[Quickstart](docs/quickstart-codex-source.zh.md)。

## 结构

```text
plugin.json / mcp.json                 portable plugin entry
.codex-plugin/ / .mcp.json             compatibility manifests
skills/                                sg-codex and setup Skills
assets/codex/                          six project Agent templates
assets/java-vue/template/              generated Java/Vue baseline
src/codex/                             MCP server and workflow services
src/codex/core/                        shared state, verification and Java tooling
scripts/codex-source-setup.mjs         project Agent installer
scripts/codex-plugin-smoke.mjs         packaged MCP smoke check
scripts/verify-codex-matrix.mjs        real Java/Vue preset matrix
test/codex-*.test.js                   focused Codex regressions
```

本分支只包含 Codex 插件运行时，不保留旧宿主入口或兼容目录。

## 验证

```powershell
npm test
npm run lint
npm run format:check
npm run pack:check
npm run codex:smoke
```

测试、lint、格式化、打包和真实 MCP smoke 都通过后，才可作为可交付源码。

## 许可证

MIT
