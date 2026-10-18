---
name: sg-skill-entry-guard
description: "specgate 入口判定 Skill，判定用户请求属于答疑/轻量修改/重量修改"
---

# 入口判定 Skill

## 用途

主Agent每次收到用户输入时，先加载本 Skill 执行入口判定，区分答疑、轻量修改、重量修改。

## 判定规则

```
收到用户输入
    ├─ 纯答疑？（不涉及文件修改）→ 直接回答，结束
    ├─ 轻量修改？（版本号/typo/配置微调/加单测）→ 委托 Developer
    └─ 重量修改？（业务逻辑/新功能/架构调整）→ 加载 change-classification → L1/L2/L3
```

## 速查表

| 用户表述 | 判定 | 处理 |
|---------|------|------|
| "这个框架怎么用？" | 答疑 | 直接回答 |
| "更新版本号到 1.2.0" | 轻量修改 | 委托 Developer |
| "帮我改下登录逻辑" | 重量修改 | 分级 → 标准流程 |
| "review 这个 PR" | 委托 Reviewer | 启动 Reviewer |
| "沉淀经验" | 委托 KE | 启动 Knowledge Engineer |

## 输出格式

```yaml
classification: "答疑" | "轻量修改" | "重量修改"
reason: "判定理由（一句话）"
next_action: "直接回答 / 委托 sg-agent-developer / 加载 change-classification"
```

## 关键红线

- ❌ 绝不可主Agent自己动手修改文件
- ❌ 禁止重量修改绕过 change-classification
- ❌ 禁止以"改动很小"为由跳过判定

## 与 change-classification 的分工

| | entry-guard | change-classification |
|---|---|---|
| 职责 | 判定是不是修改 | 把修改分到 L1/L2/L3 |
| 时机 | 任何输入的第一步 | entry-guard 判定为"重量修改"后 |
| 输出 | 答疑 / 轻量 / 重量 | L1 / L2 / L3 |

两者前后衔接，互不替代。

## 门控状态感知（P1 增强）

判定为重量修改后，在上报 change-classification 之前，必须检查当前门控状态：

1. 检查 `.specgate/gates/` 目录下的门控标记文件：
   - `G1.confirmed` — 需求已确认
   - （后续门控标记文件按需扩展）

2. 门控提示规则：
   - 若 `.specgate/gates/G1.confirmed` 不存在，且用户意图涉及 G2 及之后阶段的操作（如 proposal、design、编码）→ 提示用户
   - 提示用户：「当前 G1 需求确认尚未完成，请先完成需求盘问和 critical-review」
   - 若 `.specgate/gates/G1.confirmed` 存在 → 正常上报 change-classification
   - 注意：Skill 层面仅做提示，真正的写前阻断由 DSH 插件 `write/edit` 守卫执行

3. 门控状态检查通过文件存在性判断，不依赖对话历史。标记文件由对应 Skill（如 requirements-definition）在用户显式确认后创建。
