# M6 真实 GitHub 金丝雀候选与待批准修复范围

- 日期：2026-10-26；状态：候选，未冻结，未实施业务修复，未执行 H1/H3。
- 用户已授权从 GitHub 获取真实项目，并于本轮原生问答明确授权独立金丝雀仓库必要的本地提交；不授权 SpecGate 源码提交、推送、部署，不代替 H1/H3。
- 来源：https://github.com/ghdefe/skill-hub ，真实应用，非 SpecGate fixture。
- 最新 checkout：E:\ai_workflow\specgate-canary-skill-hub。
- 候选工作树：E:\ai_workflow\specgate-canary-skill-hub-initial，固定真实历史提交 81f84c0（完整 hash 见本轮 canary-inventory.json）。
- 源码确认：JDK 17、Spring Boot 3.5.11、Vue 3.5；复用本机 JDK 17.0.18、Maven 3.9.11、Node 24.14.0。

## 实际筛选证据

| Git 提交             | 后端测试                                | 前端测试             | 前端 build          | 判定                               |
| -------------------- | --------------------------------------- | -------------------- | ------------------- | ---------------------------------- |
| 92b917c 最新         | 测试编译失败，接口/构造器与旧测试不一致 | 47 pass / 5 fail     | 通过                | 不能作为绿色基线                   |
| 9c88380 历史         | 119 pass，0 fail/skip                   | 48 pass / 4 fail     | TypeScript 配置失败 | 不能作为绿色基线                   |
| 81f84c0 初始真实提交 | 118 pass / 1 fail，0 skip               | 49 pass，0 fail/skip | TypeScript 配置失败 | 保留为修复候选，不能宣布金丝雀通过 |

全部命令输出保存在 execution-20261026/canary-*.txt。初始提交的唯一后端失败是 AuthControllerTest.githubLogin_shouldRedirectToOAuth2Authorization；前端 build 将测试 mock 类型和 Vite 测试配置当作生产类型检查，原测试不改弱。构建产生的 tsbuildinfo 是本轮输出，不是用户业务变更；未自动提交或删除。

## 拟进行的金丝雀业务修复

目标：恢复既有登录跳转与前端生产构建，保留全部原有测试，完成同一提交上的真实前后端质量与运行验证。

| REQ / AC                     | 可观察结果                                                                                   | 允许的生产修改                                                                   |
| ---------------------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| CANARY-REQ-01 / CANARY-AC-01 | GitHub 登录跳转不绑定开发机 localhost:18123，既有后端 119 项测试全绿                         | backend/src/main/java/com/agentskills/sharing/controller/AuthController.java     |
| CANARY-REQ-02 / CANARY-AC-02 | 原有前端 49 项测试全部通过，npm run build 完整通过                                           | frontend/vite.config.ts、frontend/tsconfig.app.json、frontend/tsconfig.node.json |
| CANARY-REQ-03 / CANARY-AC-03 | HTTP 启动、JSON 查询、前端页面及静态资源实际通过；lint、format check、覆盖率有真实命令和报告 | 经 H1 精确批准的 pom.xml、前端 manifest/lockfile 和验证配置                      |

非目标：替换原业务、降低断言、跳过失败、真实 GitHub OAuth 登录、访问生产数据库、对 GitHub 推送或部署。H2 本地运行只用于隔离验收，不能声称 PostgreSQL 或生产 OAuth 已验证。

测试设计须在独立角色会话形成真实提交并覆盖每条 AC。实现必须在独立 worktree 内串行提交，禁止修改冻结测试。新增验证依赖的文件及内容 hash 必须先进入 H1 冻结范围；不得临时放开白名单。

## 剩余门禁

1. 独立金丝雀仓库本地提交授权已取得；SpecGate 源码仓库仍不提交、不推送。
2. 在运行本轮 Core 源码的可信 MCP 会话中澄清并请求 H1；本文不代替原生 H1 回执。
3. 执行真实角色、全红基线、实现、完整质量门、格式化后回归和固定提交 Review。
4. H3 由真实用户确认，归档绑定同一受验提交，生成可独立复核 DeliveryRecord。

在上述门禁完成前，CORE2-0603 / AC-MVP-01 / AC-022-02 和整个 M6 不得标记为通过。包内合成生命周期、候选仓库已下载、某个子项目单独测试通过均不能替代它们。
