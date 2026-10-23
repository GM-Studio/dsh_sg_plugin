# 代码与环境基线报告

- 日期：2026-10-23
- 分支：`feat_web`
- 基线提交：`8d333cf5254c330439cf54c81e6e61c0abcd81a0`
- 状态：**部分通过；存在已知基线缺陷**
- 说明：本报告只记录本次实际执行的命令与结果。未执行项保持未验证，不能推导为通过。

## 1. 环境事实

| 项目              | 观测值                               | 状态             |
| ----------------- | ------------------------------------ | ---------------- |
| Node.js           | `v24.14.0`                           | 已观测           |
| npm               | `11.9.0`                             | 已观测           |
| Git               | `2.45.1.windows.1`                   | 已观测           |
| MySQL 客户端/服务 | 未发现 `mysql`、`mysqld`、`mariadbd` | 未安装或不可发现 |
| 容器运行时        | 未发现 `docker`、`podman`            | 未安装或不可发现 |
| `mysql2` 依赖     | 不存在                               | 未安装           |

## 2. 工作区状态

`git status --short` 在本次基线时只显示以下未跟踪文档：

```text
?? docs/plans/2026-10-23-codex-ai-delivery-control-plane-product-plan.zh.md
?? docs/requirements/2026-10-23-codex-ai-delivery-control-plane-product.zh.md
?? docs/requirements/2026-10-23-codex-control-plane-observer.zh.md
```

本次未提交、未推送。用户已有的未跟踪文档被保留。

## 3. 命令与真实结果

### 3.1 `npm test`

结果：

```text
tests 483
pass 482
fail 0
skipped 1
duration_ms 114348.4197
```

判定：**PASS（按现有测试套件口径）**。其中 1 个跳过用例未被执行，不能视为通过。

跳过项来自测试输出：

```text
requesting the react frontend without its template tree fails closed
# react template tree is already on disk
```

### 3.2 `npm run lint`

结果：**FAIL**。

```text
src/codex/change-add.js
  4:10  error  'createHash' is defined but never used
  53:7  error  'validQuestion' is assigned a value but never used
  66:7  error  'validAnswer' is assigned a value but never used
3 problems (3 errors, 0 warnings)
```

这是本次实施前的既有缺陷。本次没有修改该文件，也没有把 lint 失败隐藏为通过。

### 3.3 `npm run format:check`

结果：**FAIL**。

```text
[warn] src/codex/change-add.js
Code style issues found in the above file.
```

这是本次实施前的既有格式缺陷。未执行自动格式化，以免未经授权改动该文件。

### 3.4 `npm run pack:check`

默认命令结果：**FAIL（环境权限）**。

```text
npm error code EPERM
npm error path C:\Users\Administrator\AppData\Local\npm-cache\_cacache\tmp\46017f26
```

使用项目内缓存重试：

```powershell
npm pack --dry-run --cache .npm-cache
```

结果：**PASS**。

```text
specgate-codex-0.3.3.tgz
package size: 615.2 kB
unpacked size: 2.6 MB
total files: 304
shasum: 0fbf24c525c97ad8a30b5330c2a6dd3b6a7a2192
```

判定：打包内容检查通过；默认 npm 缓存路径存在环境权限问题。临时 `.npm-cache` 目录应在后续清理，且不得提交。

## 4. 已知实施前缺陷

| ID      | 缺陷                                   | 影响                          | 处理状态                         |
| ------- | -------------------------------------- | ----------------------------- | -------------------------------- |
| BASE-01 | `src/codex/change-add.js` lint 失败    | 仓库整体 lint 门禁无法通过    | 待修复；需独立、可审计变更       |
| BASE-02 | `src/codex/change-add.js` 格式检查失败 | 仓库整体格式门禁无法通过      | 待修复；不得用格式化掩盖逻辑问题 |
| BASE-03 | 默认 npm 缓存写入 EPERM                | `npm run pack:check` 默认失败 | 已用项目内缓存绕过并记录         |
| BASE-04 | 本机无 MySQL/容器                      | 无法执行真实 MySQL 集成测试   | 保持未验证                       |

## 5. 基线结论

- 测试套件：**PASS（含 1 个跳过）**；
- lint：**FAIL**；
- 格式检查：**FAIL**；
- 打包检查：**PASS（使用项目内缓存）**；
- 真实 MySQL：**NOT_RUN**；
- 真实云部署：**NOT_RUN**；
- 真实飞书/钉钉投递：**NOT_RUN**；
- 真实 TOTP/设备流程：**NOT_RUN**。

因此，当前不能宣告“仓库全绿基线”。可以开始受控实施，但任何新增改动必须分别证明自身测试通过，并且最终交付必须明确列出上述既有失败与环境限制。
