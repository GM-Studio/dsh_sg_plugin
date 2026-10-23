# 需求澄清控件与 H1 文档审阅修复

## 需求与验收

- 选择题以原生选择控件采集，文字填空以文本框采集；保留旧版纯文本问题。
- 单选和多选必须定义有效选项；服务端拒绝不存在的选项、重复选项和不匹配的回答类型。
- 提案与批判分析完成后立即写入可读 Markdown，返回审阅链接；文档生成本身不代表批准。
- 用户可查看文档、提出修改或编辑文档；修改通过重新提案和批判分析形成新修订，再请求 H1。
- 当前会话未暴露 `sg_request_h1` 时，已有 `sg_change` 入口也能请求同一可信审批。
- 批准进入 REQ_FROZEN；要求修改返回 REQ_CLARIFYING；取消进入 CANCELLED。保持版本 CAS、文档指纹和原生审批校验。

## 定位与设计

当前会话暴露的工具子集中没有 `sg_request_h1`，而源码工具目录包含它；因此仅提示调用该工具不能完成审批。增加 `sg_change` 的 `action=request_h1` 分支，以同一服务方法请求审批，不接受决定、身份或回执参数，不创建重复 Change。

工作区已有控件类型、回答验证和审阅文档的部分实现，予以保留。将 Markdown 生成前移到 critique 完成时；为历史 H1_PENDING 且没有文档的变更保留首次生成、再次审批的路径。渲染前规范化对象字段顺序，保证保存和重载前后的文档指纹一致。审批前、审批响应后及门禁消费时继续校验文档和候选指纹。

## 实施与验证

- 添加并复现文档未提前生成的回归测试。
- 补齐控件 Schema、回答验证、文档生成、修改失效和统一审批入口。
- 更新任务 Skill 与 README，说明审阅、修改、审批和状态推进顺序。
- 验证命令：`node --import ./test/setup-temp.mjs --test test/codex-host-input.test.js test/codex-change-add-flow.test.js test/codex-change-tools.test.js test/codex-peer-server.test.js test/codex-plugin-protocol.test.js`，随后 `npm test`、`npm run lint`、`npm run format:check`、`npm run pack:check`。
- 自动化测试使用模拟原生用户响应，不代表已在桌面宿主上人工验证按钮、文本框或审批弹窗。宿主拒绝 elicitation 时仍保持待用户状态。

## 验证结果（2026-10-23）

- 定向回归：58 项通过。
- `npm test`：532 项，531 通过，1 项因 React 模板已存在而按既有条件跳过，0 失败。
- `npm run lint`、`npm run format:check`、`git diff --check` 通过。
- `npm run pack:check`：默认 npm 缓存目录遭 EPERM；仅为该命令设置仓库内 `.npm-cache` 后通过，不修改全局 npm 配置。
- 未执行桌面宿主人工交互验收，也未替换已加载的插件缓存；使用修复需重新加载指向此源码的插件/MCP 连接，使新工具 Schema 生效。
