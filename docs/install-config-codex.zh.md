# SpecGate Core 安装与配置

本文描述当前 Core 默认产品面。历史自动安装、模板、控制面及远程审批说明保存在 [历史配置指南](optional/install-config-codex.zh.md)，非 MVP、非默认、未被当前 Core 发行验证。

## 插件入口

源码或安装包包含 plugin.json、mcp.json、.codex-plugin/plugin.json、.mcp.json。MCP 启动命令为 node，参数为插件根目录下的 src/codex/server.js。保留业务会话 cwd；插件目录、缓存目录或多个有歧义的 roots 不能自动成为业务项目。

在支持插件管理的 Codex 中，从源码 marketplace 加载：

```text
codex plugin marketplace add <SpecGate 源码绝对路径>
codex plugin add specgate-codex@specgate-source
codex plugin list
codex mcp list
```

实际可用性以当前宿主能力和真实工具调用为准；上述配置命令本身不能证明运行、认证或交付通过。安装或更新后使用新会话，确认默认 43 个 Core 工具；sg_project_status 必须返回选定的业务项目。需要显式绑定时调用 sg_project_bind。

## 源码维护配置

```text
node scripts/codex-source-setup.mjs --project <业务项目绝对路径> --check
node scripts/codex-source-setup.mjs --project <业务项目绝对路径>
```

默认安装 specgate_test_designer、specgate_implementer、specgate_reviewer 三个项目角色与 .codex/config.toml 受管绑定。保留冲突文件并明确报错，不覆盖用户自定义内容。setup 不运行工具链安装、项目基线或业务测试。

Core 包不包含 mysql2、可选控制面、Web、通知与历史模板。源码保留这些模块；显式 SPECGATE_OPTIONAL_MODULES=1 仅供历史能力维护，依赖与数据库需单独配置，不计入 Core 验收。npm test:mysql 是独立历史集成命令，缺驱动或配置时失败，不能静默跳过。

## 项目基线与人工门

已有 Git 项目通过 sg_adopt_preview / sg_adopt_apply 接入并保存真实命令证据。工具链、干净工作区和 ProjectProfile / ProjectBaseline 是创建 Change 的前提。MCP 会话只绑定一个项目，同一项目只允许一个活动 Change。

H1、H3 必须来自可信原生用户输入。宿主能力缺失时保留待审批状态；不得把普通聊天、工具参数或 fixture 自动批准当作真实回执。角色必须产生真实 Git 提交，Reviewer 绑定固定提交并只读执行。

## 故障与验证范围

- MCP 无法启动：检查 Node 版本和 manifest 中的绝对服务端路径。
- 项目未绑定：用用户已经给出的绝对路径调用 sg_project_bind。
- 缺少工具链：只读报告缺项，按 [环境检查](environment-codex.zh.md) 处理后复测。
- 工作区脏或文件冲突：保留文件，先处理明确冲突，再重试。
- 状态链或外部锚点损坏：保持阻塞，保留证据，不重写历史制造信任。
- 归档目标已分叉：保留分支，重新集成与验证，再请求新 H3。

发布检查见 [Quickstart](quickstart-codex-source.zh.md)。离线包 handshake、状态和合成生命周期不能代替宿主安装、真实角色或业务金丝雀验收。
