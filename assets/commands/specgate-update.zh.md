---
name: "SpecGate: 更新"
description: "更新 specgate CLI 工具到最新版本，并同步升级项目内所有配置（Agent、Skill、Rule、模板等）。当用户说"更新specgate"、"升级specgate"、"specgate更新"、"specgate升级"时使用此命令。"
category: Maintenance
tags: [specgate, update, upgrade, maintenance]
---

当用户请求更新/升级 specgate 时，执行以下步骤完成 CLI 工具更新和项目配置同步。

## 执行步骤

### 1. 运行 specgate update --yes --upgrade

在终端中执行一体化更新命令：

```bash
specgate update --yes --upgrade
```

此命令会:
- 检查并下载最新版本的 specgate CLI 工具
- 自动编译、打包、全局安装
- 安装完成后自动执行 `specgate upgrade --yes` 同步项目配置

### 2. 如果上述命令失败

若 `specgate` 尚未全局安装或 `--upgrade` 标志不可用，回退为分步执行:

```bash
# 第一步: 更新 CLI 工具
specgate update --yes

# 第二步: 升级项目配置
specgate upgrade --yes
```

### 3. 向用户报告结果

根据执行结果向用户反馈:
- ✅ 成功: 报告 CLI 版本和项目配置升级结果
- ⚠️ 部分成功: CLI 已更新但配置升级失败，提示手动执行 `specgate upgrade --yes`
- ❌ 失败: 报告错误原因和建议处理方式

## 注意事项

- 需要在项目根目录下执行（包含 `.specgate/config.yaml` 的目录）
- `--yes` 标志会跳过所有交互式确认，适合自动化场景
- 升级前会自动备份当前配置
- 如有自定义文件冲突，会生成 `.new` 文件供手动合并
