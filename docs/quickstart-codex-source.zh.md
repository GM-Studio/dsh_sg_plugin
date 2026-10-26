# SpecGate Core 源码 Quickstart

默认发行只接入已有 Git 项目。两个可信人工门为 H1、H3；委派角色为 Test Designer、Implementer、Reviewer。质量门和 Formatter 使用确定性项目命令，格式化后完整重验固定提交。

## 检查源码

在插件源码目录执行：

```powershell
npm ci
npm test
npm run lint
npm run format:check
npm run pack:check
npm run codex:smoke
```

Node 满足 package.json 的 engines，Git 和业务项目工具链必须预先可用。MCP 便携入口为 plugin.json / mcp.json，服务端为 src/codex/server.js。Core 不自动下载工具链，不启动数据库、控制面、Web 或通知服务。

Windows 的系统 TEMP 如果已有遗留 .git 或路径过深，应为测试指定独立、短且没有 Git 祖先的临时目录；不要删除用户文件或放宽路径保护。最终证据必须记录实际 TEMP。npm test 的 bootstrap 会隔离和清理自己拥有的测试 run。

## 加载和绑定

按 [安装配置](install-config-codex.zh.md) 加载插件，在业务项目会话使用 $sg-codex。先 sg_project_bind 绑定已有项目，再 sg_env_check、sg_project_status、sg_adopt_preview、sg_adopt_apply 建立真实基线。状态查询只读；生成文件、工具版本、配置完成均不等于基线验证通过。

源码维护者可以运行：

```powershell
node scripts/codex-source-setup.mjs --project <业务项目绝对路径> --check
node scripts/codex-source-setup.mjs --project <业务项目绝对路径>
```

setup 默认只配置三个核心角色和项目 MCP 绑定，保留已有自定义文件；不建立项目基线。已跟踪 AGENTS.md 的变化不会被隐藏。业务变更前必须按项目规则处理脏工作区，不能自动提交用户文件。

## 需求到交付

1. 原生澄清、REQ/AC、反向复述和批判分析后请求 H1。
2. 冻结计划、每任务文件白名单和测试；真实全红基线后开始隔离实现。
3. 完整质量门通过后确定性格式化，再完整重验格式化后的提交。
4. Reviewer 只读审查同一提交，H3 由真实用户确认。
5. 归档只快进到已受验提交；目标分支分叉即阻断。DeliveryRecord 和客户摘要保留已知失败、风险、未验证区域及回滚说明。推送需要显式 push=true。

缺少可信原生审批或独立角色执行能力时保持阻塞，不能用聊天同意、测试 provider 或手写报告代替。

## 验证边界

仓库回归及离线包内合成生命周期用于机械验证，fixture 审批、覆盖率和角色报告不是真实业务验收。JDK 17 + Spring Boot 3.5 + Vue 3 的真实金丝雀及人工审批以 [有效计划](plans/2026-10-25-specgate-core-reliable-delivery-mvp-plan-v2.zh.md) M6 记录为准。

历史初始化、异步控制与六角色配置说明保存在 [可选能力历史文档](optional/quickstart-codex-source.zh.md)，非 MVP、非默认、未被当前 Core 发行验证。
