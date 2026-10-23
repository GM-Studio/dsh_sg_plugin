# 初始化与交互修复记录

目标：MCP 明确绑定业务项目，用户通过中文表单选择技术栈并审核需求，初始化自动准备项目 Agent 和 Skill，开发启动不依赖隐藏的手工配置。

验收范围：

1. 显式项目路径优先于 MCP roots；提供可发现的绑定与安装工具，初始化成功后更新当前会话绑定。
2. 新建表单必须填写路径、包名与技术栈；沿用用户 Git 身份，缺失时先采集，禁止 SpecGate 默认作者。
3. 自动安装项目 Agent 和可显式调用的 Skill；中文操作说明；基线后等待用户输入业务需求。
4. 澄清和 H1/H3 使用 MCP 表单；宿主不支持时明确报告待办，不把模型输出当人工审批。
5. 前端独立启动；联合启动显式使用 dev:all；本地密码由配置命令随机生成并存入 Git 忽略文件，保留后端强密码校验。
6. 保留用户现有修改，排查实际 lvguan 项目；记录无法复现的 IDE 错误。

验证：先执行相关 Node 回归，再运行 npm test、lint、format:check 和 pack:check；使用现有 JDK/Node 对实际启动执行检查，未执行项如实记录。

## 逐项排查结果

| 原问题                | 根因与修复                                                                                                                                                                                                                                                      |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. MCP 总指向源码     | 宿主将插件缓存作为 cwd；原生 roots 并非总提供目标目录。增加 sg_project_bind；显式 --project-root 优先，生成或安装项目后重建全部项目服务绑定。状态显示 projectRoot。                                                                                             |
| 2. Skill 无法发现调用 | 包内已有 Skill，但缺少中文展示元数据和项目级发现入口。补充 agents/openai.yaml，自动安装 .agents/skills，支持 $sg-codex / $sg-codex-setup；增加可发现的新建、安装和绑定工具。                                                                                    |
| 3. 英文文档           | 主 Skill、环境准备 Skill、生成 README、API、运维和安全说明改为中文；H1 与澄清表单使用中文说明。                                                                                                                                                                 |
| 4. 手工安装 Agent     | 删除普通流程中要求用户运行脚本的指令。初始化自动安装六个 Agent、Skill、MCP 项目配置，并有界发现已安装 JDK。现有项目可由 sg_project_setup 自动补齐。                                                                                                             |
| 5. 没有配置表单       | 新增 sg_project_create，通过 MCP elicitation 请求配置与预览确认；宿主不支持时明确返回待输入，不能冒充已显示表单。当前宿主检测到 elicitationSupported=true。                                                                                                     |
| 6. 技术栈被代选       | MCP 新建预览与执行必须显式提供 preset/frontend，表单无默认技术栈；选择绑定预览哈希并写入项目事实。                                                                                                                                                              |
| 7. 基线后自动开发     | 就绪结果返回 WAIT_FOR_USER_REQUIREMENTS；Skill 明确等待用户需求，必须澄清、反述、批判分析再人工审批。初始化 REQ 标明仅为脚手架能力说明，不代表业务需求或 H1 批准。                                                                                              |
| 8. H1 没有审批界面    | 明确要求调用 sg_request_h1 发起可信审批表单；需求载荷改为分节文档，保留原始需求、AC、假设风险、用户回答、批判分析和范围契约。未批准不能冻结或开发。                                                                                                             |
| 9. Git 作者固定       | 初始化、项目元数据、接入基线和交付 tag 不再使用 SpecGate 默认身份，复用用户环境/配置，缺失时在生成前采集。已有提交历史保持原样。                                                                                                                                |
| 10. 后端密码错误      | lvguan 的应用配置使用了不满足长度要求的密码。改为每项目独立随机 .env，Spring 与启动脚本读取，保留强密码校验；使用现有 JDK17 启动及健康检查通过。                                                                                                                |
| 11. isNull / robj     | 实际 WebStorm idea.log 定位到 RemoteMessageRouterImpl → JCEFConsoleHtmlPanel。属于 IDE 调试控制台崩溃。核验本机实现后设置 js.debugger.webconsole=false，改用文本调试控制台，关闭自动浏览器调试；需重启 WebStorm，未在重启后做 UI 复测。业务前端启动与构建通过。 |
| 12. 前端要求 Java     | 根 dev 原来同时启动 Maven 和 Vite。现在 npm run dev 仅启动前端，backend 独立启动，dev:all 联合启动；故意设置无效 JAVA_HOME 时，lvguan 前端 HTTP 检查仍通过。                                                                                                    |

## 实际项目与加载方式

已同步修复到 E:\new_project\lvguan，并将项目 MCP 配置改为加载 E:\ai_workflow\specgate 的源码。原有 application.properties、frontend/package-lock.json、.idea 和其他业务改动保留；被修复文件的备份位于该项目 .specgate/backups/onboarding-repair-20261022。

已在本机安装 0.3.1 修复版本，使用独立新缓存避开当前 0.3.0 进程占用。当前聊天的 MCP 工具清单不会热替换；在业务项目新建 Codex 会话后加载新版本。整个过程没有提交或推送源码仓库与业务仓库。

业务项目命令：npm run dev（前端）、npm run backend（后端）、npm run dev:all（联合启动）。账号 admin / viewer，密码仅在项目 .env 中查看，不在聊天输出。

IDE 问题对应 JetBrains 已知缺陷：[IJPL-211720](https://youtrack.jetbrains.com/issue/IJPL-211720)。未修改 IDE 安装包；没有把规避配置描述成上游缺陷已修复。

## 最终验证结果

- 聚焦回归：56 项通过，0 失败。
- 最终 npm test：436 项，435 通过，1 跳过，0 失败。跳过的是模板不存在时的反例分支，因为 React 模板已经存在；实际 React 生成回归已执行通过。
- npm run lint、npm run format:check、npm run pack:check 全部通过；打包包含两个前端模板、中文 Skill 元数据和 managed-file-history。本地 .commandcode/ 目录已加入 .gitignore 与 .prettierignore。
- 已安装 0.3.1 的真实 stdio MCP smoke 通过：projectRoot 为业务目录，三个新增工具可发现；关键运行源码与安装缓存的 SHA-256 一致。真实人工审批和宿主表单渲染未在本次 smoke 执行，未假装获得审批。
- 0.3.2 生成模板的真实运行证据保存在 docs/verification/codex-sg-v1/onboarding-v032-runtime.json：后端 verify 退出码 0，admin 与 viewer 登录均返回 200 及正确角色。
- lvguan：前端在无效 JAVA_HOME 下启动并返回 HTTP 200；后端复用现有 JDK17，通过 /actuator/health；前端 vue-tsc 与 vite build 通过。测试后已停止临时服务，后端检查使用内存数据库。
- 未重跑修改后模板的 Windows/Linux 全部技术栈矩阵。历史 Golden 记录保留原哈希，新模板哈希不匹配时明确显示未验证，不沿用历史通过结论。
- WebStorm 文本调试控制台规避配置已写入并备份，重启后的 IDE UI 复测尚未执行。
