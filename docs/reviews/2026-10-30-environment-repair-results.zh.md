# F01—F04 修复及实跑结果

本文件是[原八项全仓评审](2026-10-30-environment-chain-audit.zh.md)的修复后补充。原报告针对初始提交 `54e80c4`，保留原始发现、复现和其他缺陷；不能将其初始结论当作当前四项修复状态，也不能将四项修复等同于全仓最终合格。

## 修复范围及依据

| 缺陷 | 修复                                                                            | 主要依据                                                                                                                                                                                    | 本地提交                                                                                   |
| ---- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| F01  | 默认环境准备、新项目环境选择和安装实现进入发行包                                | `src/codex/environment-tools.js:40`、`workflow-tools.js:1030`、`core/environment-project.js:38`、`package.json:27`；[阶段记录](../verification/environment-repair/F01.md)                   | `a356cde`                                                                                  |
| F02  | 存量真实构建文件导出所需工具，新建选择栈并持久化；按版本复用或批准安装Go/Python | `core/environment-requirements.js:24`、`core/environment-discovery.js:36`、`core/environment-archives.js`、`core/environment.js:250`；[阶段记录](../verification/environment-repair/F02.md) | `cff13b3`                                                                                  |
| F03  | 检查结果接入实际命令、隔离worker和子进程环境，记录绝对执行路径                  | `core/environment-execution.js:42`、`baseline.js:147`、`baseline-worker.mjs:133`、`core/git-runtime.js:8`；[阶段记录](../verification/environment-repair/F03.md)                            | `7db4a4f`                                                                                  |
| F04  | 执行树内准备依赖；Python使用项目venv；基础设施失败阻断；证据保存完成前不得ready | `project-detect.js:131`、`core/suites.js:245`、`core/env/install.js:133`、`baseline.js:22`、`adopted-verification.js:180`、`project-state.js:210`                                           | 双平台已验收；见[F04记录](../verification/environment-repair/F04.md)，本阶段验收后本地提交 |

以上源码位置均相对于 `src/codex/`，测试证据在 `docs/verification/environment-repair/`。风险分级沿用原报告：四项均为P1；只有相应候选真实通过后才允许阶段提交。

## 实际验证口径

每阶段先聚焦，再完整 `npm test`、lint、format:check、pack:check 和 codex:smoke。两端使用同一候选文件清单与SHA-256，Linux直接在用户提供的VMware Ubuntu运行，未模拟系统。提交前逐个核对暂存的产品源码与测试源码字节等于已验候选。

用户真实批准的Node和四项Go/Python隔离安装已实际下载、校验、解压和执行；精确来源、SHA-256、版本、位置及批准口径见[安装方案](../plans/2026-10-30-go-python-isolated-install-plans.json)与F01/F02记录。未改系统/用户全局PATH或JAVA_HOME。协议测试客户端的接受/拒绝响应仅用于协议验证，不冒充真人审批。

Node/npm使用真实命令，Java使用真实javac/java并探测Maven。F04使用已跟踪的本地npm依赖和本地Python wheel，在真实Git工作树重新安装后测试，并使用真实Go SDK构建和测试标准库项目；避免把外部包服务可用性混入这项隔离依赖回归。真实缺模块、缺命令、安装失败、超时、未知原因非零退出以及旧基线同签名放行都必须阻断。Python重复执行还必须复用venv；依赖目录删除后必须重新安装。

最终F04-h两端完整Core回归均1159/1159，聚焦均62/62，无失败/跳过，其余门禁全部退出0；1141文件SHA-256一致。F01/F02/F03亦分别在通过双平台验收后本地提交，详情与失败重试记录见相应阶段文件。

## 可以确认的能力及边界

| 事项                               | 基于现有证据的结论                                                            | 依据/未补齐事项                                                                                                                                                              |
| ---------------------------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 存量项目与新建项目                 | 已有构建文件按事实检测；新建通过可信表单选择栈并准备环境                      | `core/environment-requirements.js`、`core/environment-project.js`、`test/codex-environment-stack-e2e.test.js`；新建入口仅准备目录与环境，不生成任意业务模板                  |
| Node、React、Vue、Python、Go、Java | 六类manifest/选择均进入真实环境检查；Node、Python、Go、Java有最小实际执行证据 | 栈测试与F01—F04阶段记录；React/Vue识别复用Node工具链，未声称实际跑过每个框架的完整业务应用                                                                                   |
| 缺项批准安装                       | 已适配归档先确定来源/校验，再经可信确认安装并复验；拒绝/取消不安装            | `environment-tools.js:66`、`core/environment.js:250`、`core/environment-install.js`；Git、Gradle、pnpm/Yarn、uv/Poetry等未适配自动归档时仍阻断并要求宿主安装，不能宣称全自动 |
| 用户自定义版本                     | 读取并检查项目约束；无匹配归档时明确阻断                                      | `core/env/version-range.js`、`core/environment-archives.js`；固定Node/JDK/Maven归档不覆盖任意版本，不支持的范围语法也不会猜测通过                                            |
| 操作系统独立性                     | 当前只验收Windows/Linux x64，使用对应路径和归档适配                           | `core/environment.js:153`、`core/environment-catalog.js`；macOS、ARM64、其他平台未实现该安装矩阵且未验，不是任意OS通用                                                       |
| 业务包安装审批                     | 本轮SDK安装有独立可信确认；接入基线的业务依赖命令沿用sg_adopt_apply执行路径   | `project-tools.js:211`、`project-detect.js:131`；逐包/生命周期脚本独立审批未实现，如将它列为强制要求仍需补齐                                                                 |
| 验收和人工审批                     | F04基础设施错误不能变成已知业务失败；环境READY与业务质量验收分别报告          | `baseline.js:22`、`adopted-verification.js:180`；无命令partial基线仍显式未验证，既有业务known-failure不等同全部测试通过；原报告第8节及其他审批缺陷未整体关闭                 |
| Codex安装装载                      | 默认MCP、发行包离线安装及不同cwd启动有实际证据                                | 各阶段package/protocol/smoke记录；未替换当前已安装0.3.4插件缓存，目标Codex版本和发布升级策略仍待补充                                                                         |

原有 `.mcp.json` 的空server配置及无关未提交文件保持原样。候选明确使用HEAD中的有效MCP入口，未混入该用户改动；因此这里的候选检查通过不能写成“当前混合工作树直接运行全部检查也通过”。本机临时SDK和候选目录不是产品源码，也没有进入阶段提交。

原报告其他编号未在本轮逐项修复验收，不标记全部关闭。尤其任务并发回收、通用格式化和发布失败恢复仍需后续处理；当前环境准备能力不能证明任意技术栈的业务开发、H3、交付或生产部署全链路已经合格。
