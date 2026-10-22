# 存量交付闭环与项目代码规范实施计划

- 状态：实施中
- 日期：2026-10-22
- 基线提交：`5df74a548824344a9179ef1d74dab2f8d5a9c912`
- 需求来源：
  `openspec/changes/codex-adopted-project-conventions/`
- 执行方式：计划驱动、测试先行、真实项目复验

## 目标

1. 存量项目按 ProjectProfile 命令完成质量验证，并按 Baseline Delta 区分已知
   失败与新失败。
2. 新项目包名使用 `com.<company>.<business>`，源码目录不再生成
   `com/example`。
3. 生成代码使用中文注释，并继续参考 `.specgate/examples/` 中的冻结风格。
4. 前端接入 Vue I18n，默认 `zh-CN`，支持 `en-US`。
5. 计划和开发角色显式获得包名、locale 和模板风格约束。

## P1：存量验证与 Baseline Delta

- [x] 为 adopted verifier 编写失败测试。
- [x] 实现固定 commit 的 ProjectProfile 命令执行。
- [x] 实现环境指纹、已知失败签名和新失败比较。
- [x] 在 quality gate 中按项目模式选择 verifier。
- [x] 增加 adopted known-failures 端到端质量门测试。

## P2：项目命名空间与模板

- [x] 为 company/business 校验和路径投影增加失败测试。
- [x] 增加 ProjectProfile 约定字段和 adopted package 探测。
- [x] 将包名、groupId、artifact 和前端包名参数化。
- [x] 标准化模板 hash，避免公司名变化导致 Golden 失配。
- [x] 给所有生成源码添加中文用途注释。

## P3：前端国际化

- [x] 增加 `zh-CN`、`en-US` 词典和 Vue I18n 初始化。
- [x] 将 App 可见文本改为 i18n key。
- [x] 默认中文并提供运行时语言切换。
- [x] 更新前端测试，覆盖默认中文和英文切换。

## P4：角色上下文与文档

- [x] 将 `backendPackage` 和 locale 约定加入 Test/Development challenge。
- [x] 更新 AGENTS、Skill、Quickstart、README 和 ChangeLog。
- [x] 保持旧 Profile 只读兼容。

## P5：验证

- [x] focused tests：73 项中 71 项通过；2 项被并行新增的
      `sg_work_item_*` 工具快照阻塞。
- [x] 本项目变更快照的 `npm test`：237/237 通过。
- [x] `npm run lint`。
- [ ] `npm run format:check`：被并行 `src/codex/control/` 变更阻塞。
- [x] `npm run pack:check`。
- [x] `node scripts/codex-plugin-smoke.mjs`。
- [x] 真实 adopted 项目 fail-closed 复验和四个预设新建项目矩阵复验。
- [x] `git diff --check`。
