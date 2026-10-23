# SpecGate 会话绑定、项目初始化与验证链修复记录

- 日期：2026-10-23
- 修复版本：`0.3.3`
- 适用运行时：Codex host plugin / stdio MCP
- 结论：六个现象分别由会话根目录回退、表单双重确认、能力声明误判、模板验收记录陈旧、宿主工具投影以及验证状态缺少可发现入口共同造成；本次在源码层分别修复，没有把“生成成功”伪装成“验证通过”。

## 证据边界

本次修改和测试针对工作区 `E:\ai_workflow\specgate`。诊断时当前 Codex 会话仍加载缓存版本 `C:\Users\Administrator\.codex\plugins\cache\specgate-source\specgate-codex\0.3.2`；源码修改不会热替换已经加载的插件。因此：

- 工作区源码、包清单、测试和离线打包已经修复到 `0.3.3`。
- 当前会话中的旧 `0.3.2` 工具投影不会被声称为已更新；需要安装或重载 `0.3.3` 后用新会话验证宿主侧 UI 和工具投影。
- 未写入插件缓存，未对用户业务项目执行初始化，未伪造任何项目验证证据。

## 1. 新会话仍绑定插件源码目录

### 错误描述

新会话明明选择了业务项目，`sg_project_status`、`sg_env_check`、变更预检等仍把下面的插件缓存目录当成业务项目：

```text
C:\Users\Administrator\.codex\plugins\cache\specgate-source\specgate-codex\0.3.2
```

### 根因

MCP 服务由插件缓存目录启动时，`serveStdio()` 的默认 `projectRoot` 是 `process.cwd()`。旧的 `resolveProjectRoot()` 在宿主没有声明 roots 能力、`roots/list` 失败或没有返回合适根目录时，会无条件退回启动 cwd。注册表随即用该路径创建所有项目服务，因此后续命令虽然能识别“这是源码”，仍已经被错误路径污染。

这不是业务项目接入失败后的普通状态，而是“插件安装目录被当成会话项目根”的边界错误。

### 修复前调用栈

```text
src/codex/server.js main
  -> serveStdio({ projectRoot: process.cwd() })
  -> resolveProjectRoot(peer, cacheCwd)
  -> fallback path.resolve(cacheCwd)
  -> createToolRegistry({ projectRoot: cacheCwd })
  -> sg_status / sg_env_check / sg_change_preflight
  -> PROJECT_SOURCE_FORBIDDEN（此时绑定已经错误）
```

### 修复

- `src/codex/server.js:57-98`：统一检查显式配置、受支持的环境键和 MCP roots；过滤插件源码及其子目录；有业务 root 时优先于启动 cwd；没有安全业务 root 时返回 `null`。
- `src/codex/server.js:126-150`：注册表显式携带 `projectBound`，不再把缓存 cwd 当成隐式绑定。
- `src/codex/workflow-tools.js:811-850`：未绑定状态返回结构化 `PROJECT_NOT_BOUND`，`projectRoot: null`，并给出 `sg_project_bind` / `sg_project_create` 下一步。
- `src/codex/workflow-tools.js:854-927`：未绑定会话只允许健康、状态、绑定、创建和安装项目能力；环境、变更和验证等业务操作在绑定前关闭。
- `src/codex/workflow-tools.js:931-957`：绑定或创建成功后在同一会话中原子切换 root，并重建所有延迟服务。

### 修复后调用栈

```text
serveStdio
  -> resolveProjectRoot
     -> explicit/env roots
     -> roots/list
     -> reject insideSpecGateSource
     -> null（没有业务项目）
  -> createToolRegistry({ projectBound: false })
  -> status = PROJECT_NOT_BOUND, projectRoot = null
  -> sg_project_bind(E:\new_project\test_demo)
  -> bindProject
  -> rebuild bound registry/environment service
  -> 后续命令统一使用 E:\new_project\test_demo
```

### 回归证据

- `test/codex-onboarding.test.js`：插件缓存 cwd 保持未绑定；显式业务路径可绑定；绑定后所有项目工具切换到新 root。
- `test/codex-plugin-protocol.test.js`：MCP roots 优先绑定业务项目，插件缓存不再成为业务项目。
- MCP 冒烟：未提供业务根时返回 `PROJECT_NOT_BOUND`、`projectRoot: null`，不再显示插件源码路径。

## 2. 已提交技术栈表单却被当成取消

### 错误描述

用户已经在原生表单中选择并提交目录、JDK/Spring Boot、前端技术栈等字段，初始化仍返回“尚未确认”或取消创建。

### 根因

旧逻辑要求同时满足两个条件：

1. MCP 表单响应 `action === "accept"`；
2. 表单内容中额外的 `confirm === true`。

宿主的“提交/确认”动作本身已经是可信确认。额外布尔框既是重复确认，也存在序列化或 UI 未回传该字段的情况，于是完整提交被误判为取消。相同的重复条件还进入初始化授权提供器，导致前一层即使接收，执行层仍可拒绝。

### 修复前调用栈

```text
sg_project_create
  -> createProjectInteractively
  -> elicitation/create => { action: accept, content: stack fields }
  -> response.content.confirm !== true
  -> INIT_CANCELLED

或：
  -> createNativeInitConsent
  -> confirmed = action accept && content.confirm === true && trusted identity
  -> executeInit approval denied
```

### 修复

- `src/codex/onboarding.js:177-240`：删除渲染层的 `confirm` 字段；文案明确“提交表单即表示确认”。
- `src/codex/onboarding.js:256-293`：以关联响应的 `action === "accept"` 作为提交确认，并继续严格校验目录、包名、技术栈和非空目录策略。
- `src/codex/onboarding.js:268-270`：兼容旧宿主仍回显 `confirm` 的响应，但不再要求它为 `true`。
- `src/codex/init-consent.js:3-27`：授权依据改为可信用户身份、关联的 accept 响应、绑定 root/preset/policy 和不可变预览范围；不再依赖冗余复选框。

安全边界没有降低：模型文本、工具参数或伪造 identity 仍不能生成初始化授权；目录、预览哈希、冲突策略仍需严格匹配。

### 修复后调用栈

```text
elicitation/create
  -> correlated response.action = accept
  -> validate content fields
  -> retain selected root/preset/frontend
  -> createNativeInitConsent(trusted identity + bound scope)
  -> executeInit
```

### 回归证据

- `test/codex-init-publication.test.js`：没有 `confirm` 字段以及旧宿主回显 `confirm: false` 时，可信 accept 提交都能进入范围受限的初始化授权；decline 仍拒绝。
- `test/codex-onboarding.test.js`：React/JDK 选择、身份、自动环境准备与项目绑定在一次表单提交后保持一致。

## 3. 重跑 `sg-codex-project` 没有再次弹出原生表单

### 错误描述

首次交互取消或宿主未声明 elicitation 能力后，再次执行项目准备只返回几句文字，没有优先重开表单，也没有保留用户已选技术栈。

### 根因

旧代码把 `peerCapabilities().elicitationSupported !== true` 直接等价为“宿主不支持表单”。部分 Codex 宿主能处理 `elicitation/create`，但初始化能力协商中未显式广告该标志，插件因此根本没有发出原生表单请求。取消响应也只返回终态文本，没有明确可重试状态。

### 修复前调用栈

```text
sg_project_create
  -> createProjectInteractively
  -> peerCapabilities().elicitationSupported !== true
  -> PROJECT_FORM_UNAVAILABLE 文本
  -> 不调用 elicitation/create
```

### 修复

- `src/codex/onboarding.js:167-176`：仅在缺少可信用户身份或根本没有 peer 请求通道时直接进入结构化降级。
- `src/codex/onboarding.js:215-254`：表单优先；即使能力位未声明，也进行一次最长 30 秒的受控 `elicitation/create` 探测。
- `src/codex/peer.js:29-50`：加入仅供受控调用使用的 `allowUnadvertised`，不改变其他 peer 方法的能力检查。
- `src/codex/onboarding.js:243-261`：只有真实拒绝、超时或错误时才降级为 `WAITING_FOR_USER` + 结构化字段描述；取消后下一次调用会重新发起表单。
- `src/codex/onboarding.js:348-384`：只修正目录时继续保留之前选择的包名、preset 和 frontend，并优先使用原生表单。

### 修复后调用栈

```text
sg_project_create
  -> createProjectInteractively
  -> requestPeer('elicitation/create', ..., allowUnadvertised=true, timeout=30s)
     -> accept: 继续初始化
     -> cancel: WAITING_FOR_USER，下次重新弹表单
     -> unsupported/error/timeout: 结构化文字降级，不创建项目
```

### 回归证据

- `test/codex-peer-transport.test.js`：能力位缺失时允许一次有界表单探测，普通请求仍失败关闭。
- `test/codex-onboarding.test.js`：取消后重试再次调用表单，而不是直接退化成文字；目录修正不丢技术栈草稿。

## 4. “模板的既有验收记录与当前模板哈希不一致”

### 错误描述

初始化阶段出现模板验收哈希不一致警告，容易让用户误以为当前模板已损坏，或误认为历史验收仍适用于当前模板。

### 根因

这里包含两个独立问题：

1. 历史 Golden 验收完成后，提交 `b4c0595` 和 `e1b6337` 又修改了模板中的测试、脚本、i18n、文档和安全相关文件，`GOLDEN_MANIFEST` 的旧哈希自然不再等于当前内容。
2. `startJavaInit()` 调用 `goldenStatus(preset, hash)` 时漏传 `frontend`，React 初始化会默认读取 Vue 的历史验收记录，造成错误比较。

### 修复前调用栈

```text
startJavaInit
  -> render selected frontend template
  -> templateHash(files)
  -> goldenStatus(preset, hash)   // frontend 丢失，默认 vue
  -> historical record.templateHash !== current hash
  -> “模板已变化，需要重新验收”
```

### 修复

- `src/codex/core/java/java-init.js:319-320`：把真实选择的 `frontend` 传入 `goldenStatus()`。
- `src/codex/core/java/java-versions.js:6049-6091`：登记当前三组 JDK preset × Vue/React 的六个真实模板哈希，并显式标记 `verification: not-run`。
- `src/codex/core/java/java-versions.js:6093-6134`：当前哈希命中时返回 `awaiting-verification`、`blocking: false`；允许生成，但明确不能声称已验证。
- 当前记录的 `platforms` 全部是 `not-run`；历史记录只作为有限的 `historicalRecord` 展示，不把旧平台 passed 证据复制给新模板。
- 真正未知的哈希仍走 `src/codex/core/java/java-versions.js:6147-6152` 的 mismatch 分支并失败关闭。

### 修复后调用栈

```text
startJavaInit
  -> templateHash(files)
  -> goldenStatus(preset, hash, frontend)
  -> current revision hash matched
  -> awaiting-verification / not-run
  -> 可生成，但必须运行 sg_project_verify / sg_verify 才能建立基线
```

### 回归证据

- `test/codex-golden-matrix.test.js`：六个当前模板哈希全部与登记值一致；当前修订返回 pending 而非 mismatch；新记录中不存在历史 passed 证据。
- 完整生成矩阵测试覆盖四种脚手架组合并保持模板输出一致。

## 5. 当前暴露接口找不到 `sg_verify`

### 错误描述

Codex 当前工具投影中没有可调用的 `sg_verify`，从而给出“验证接口被取消或找不到”的结论。

### 根因

诊断区分了两层：

- 直接向已安装的 `0.3.2` MCP 服务发送原始 `tools/list`，列表中实际存在 `sg_verify`、`sg_state` 和 `sg_work_item_status`。
- 当前 Codex 会话的延迟工具投影没有暴露这几个名称。

所以 `sg_verify` 没有从服务端源码删除；直接原因是已加载旧缓存版本的宿主工具投影/发现结果不完整。插件源码无法在运行中改写宿主已经建立的工具投影。

同时，原有项目状态只用自然语言要求执行 `sg_verify`，没有在项目域提供同名入口或结构化 `nextTool`，导致投影缺失时没有可靠替代路径。

### 修复

- `src/codex/workflow-tools.js:189-253`：保留原 `sg_verify`，新增项目域别名 `sg_project_verify`，参数、注解和实现保持等价。
- `src/codex/workflow-tools.js:773-789`：两个名称进入同一个 `verifyProject()` 实现，并返回 `evidenceWritten`、固定相对报告路径和下一步。
- `src/codex/workflow-tools.js:959-975`：别名纳入环境就绪门禁，不能绕过工具链检查。
- `src/codex/project-tools.js:145-161`：项目状态结构化暴露 `nextTool: sg_project_verify` 以及两个兼容名称。
- `package.json`、`plugin.json`、`.codex-plugin/plugin.json` 与 lockfile 升级到 `0.3.3`，强制新安装使用新的缓存身份，而不是继续复用有问题的 `0.3.2`。

### 修复后调用栈

```text
sg_project_status
  -> verificationSnapshot
  -> nextTool = sg_project_verify

sg_project_verify (或 sg_verify)
  -> createBoundToolRegistry.call
  -> verifyProject
  -> real dependency/build/test/lint/format/coverage/http checks
  -> .specgate/codex-verify-report.json
```

### 回归证据

- `test/codex-plugin-protocol.test.js`：精确工具清单为 54 项，包含两个验证名称。
- `test/codex-tools-workflow.test.js`：两个名称都是公开、受验证 schema 约束的工具。
- `test/codex-onboarding.test.js`：两个入口调用同一实现并返回等价结果。
- `node scripts/codex-plugin-smoke.mjs`：`serverInfo.version = 0.3.3`，原始 `tools/list` 同时返回 `sg_verify` 与 `sg_project_verify`。

## 6. “未提供 `sg_verify` 证据写入接口，不能建立项目基线”

### 错误描述

项目生成后状态持续显示“未就绪”，提示没有验证证据写入接口，因此无法建立或声称已建立 SpecGate 项目基线。

### 根因

基线的失败关闭原则本身是正确的：生成不是验证，`sg_project_finalize_new` 必须读取服务端产生且当前有效的 `.specgate/codex-verify-report.json`。问题在于：

- 宿主投影中看不到原 `sg_verify`；
- `sg_project_status` 没有读取并展示验证报告/锁状态；
- finalization 失败仅返回笼统错误，没有可调用的 `nextTool`；
- 验证进程异常退出后可能遗留锁，后续既不能使用旧证据，也没有安全恢复路径。

这几项组合成了一个无法前进的闭环，而不是应该通过放宽证据校验来解决。

### 修复前调用栈

```text
sg_project_finalize_new
  -> newProjectVerifier / validateVerificationEvidence
  -> VERIFY_EVIDENCE_MISSING 或 VERIFY_LOCKED
  -> generic error
  -> 状态没有 nextTool
  -> 宿主投影又没有 sg_verify
  -> 无法建立基线
```

### 修复

- `src/codex/verify.js:54-80`：只回收所属进程已退出或超过安全期限的遗留锁；活跃验证锁保持不动。
- `src/codex/verify.js:84-139`：新增只读 `verificationSnapshot()`，区分 `not-run`、`running`、`stale-lock`、`passed`，不在状态查询中修改文件。
- `src/codex/verify.js:694-719`：证据验证对活跃锁和遗留锁给出不同下一步，仍禁止使用旧报告。
- `src/codex/verify.js:860-900`：真实验证开始前安全恢复遗留锁，并在新锁中记录 pid 和开始时间。
- `src/codex/project-tools.js:116-161`：项目状态附带当前验证快照及可调用的项目验证入口。
- `src/codex/project-tools.js:222-243`：finalization 缺证据或证据无效时返回 `RUN_SG_VERIFY` + `sg_project_verify`；只有 `validateVerificationEvidence()` 真正通过后才调用 `recordNewProjectBaseline()`。

### 修复后调用栈

```text
sg_project_status
  -> verificationSnapshot (read-only)
  -> not-run/running/stale-lock/passed + nextTool

sg_project_verify
  -> recoverVerificationLock (dead owner only)
  -> verifyProject (real commands)
  -> write codex-verify-report.json

sg_project_finalize_new
  -> validateVerificationEvidence
  -> complete/current evidence only
  -> recordNewProjectBaseline
```

### 回归证据

- `test/codex-onboarding.test.js`：生成后状态指向 `sg_project_verify`；别名与原接口等价。
- `test/codex-plugin-protocol.test.js` 与 `test/codex-tools-workflow.test.js`：验证入口在协议和公共工具层均可发现。
- 完整验证测试仍证明：未初始化、证据不全、取消、失败、源码哈希漂移、软链接/硬链接和锁异常都不能建立绿色基线。

## 最终质量门禁

| 检查                                  | 结果                                                                               |
| ------------------------------------- | ---------------------------------------------------------------------------------- |
| 聚焦回归                              | 绑定、表单、验证别名、Golden 修订、peer transport 均通过                           |
| `npm test`                            | 479 项；478 passed、0 failed、1 skipped                                            |
| `npm run lint`                        | 通过                                                                               |
| `npm run format:check`                | 通过                                                                               |
| `npm run pack:check`                  | 通过；首次在沙箱内因用户级 npm cache `EPERM` 失败，获准使用正常 npm 缓存后重跑通过 |
| `node scripts/codex-plugin-smoke.mjs` | 通过；版本 `0.3.3`，54 个工具，包含两个验证入口                                    |

## 尚未执行且不得冒充已完成的事项

- 未把 `0.3.3` 安装到 Codex 插件缓存，也未重启/重载当前宿主。
- 未在 `E:\new_project\test_demo` 执行生成、环境安装或真实项目验证。
- 未执行跨 Windows/Linux 的当前模板 Golden 复验；当前模板状态因此是 `awaiting-verification`，而不是 `passed`。
- 未提交或推送 Git 变更。
