# SpecGate for Codex

SpecGate 是一个 Codex 原生插件，用受控 MCP 状态、真实 subagents、独立
worktrees 和机器可审计证据完成需求、测试、开发、格式化、代码走查和发布门禁。

[English](README.en.md) · [源码加载 Quickstart](docs/quickstart-codex-source.zh.md)

## 能力

- `sg_init` 生成并建立 Java 21 / Spring Boot / Vue 3 项目基线。
- `sg_change_add` 和 H1 需求门禁冻结需求、契约、模型和测试。
- Test Designer 先于实现提交可执行测试。
- Frontend 与 Backend subagents 在独立 worktree 并行开发。
- Tester 执行冻结用例和真实 Maven、Vitest、HTTP、运行时验证。
- Formatter 在独立 worktree 格式化，Reviewer 对固定提交做只读走查。
- Blocking Review 或质量失败自动进入新的开发 round，并重跑完整闭环。
- H3 通过交互式 elicitation 绑定最终 artifact；失败和未执行检查不会伪装成通过。

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
