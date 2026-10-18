---
name: sg-skill-self-audit
version: 2.0.0
description: "SpecGate DSH 插件自检 — 交叉校验 assets、注册项、文档计数、命令名与测试，发现模板漂移和引用断裂"
---

# SpecGate DSH 插件自检 Skill

## 用途

对 `dsh-plugin-specgate` 自身做系统化交叉校验：模板漂移、引用断裂、计数不一致、DSH 不兼容的命令名、历史残留。

**定位**: SpecGate 插件开发者元工具，不是下发到用户项目的通用 Skill。
**与 `specgate doctor` 的关系**: `specgate doctor` 检查用户项目；本 Skill 检查插件仓库（`E:\ai_workflow\sg_dsh`）。

## 触发条件

- 用户说“自检”“自查”“审计插件”“检查插件”“audit”
- 修改 `assets/`、`src/commands.js`、`src/tools.js`、`index.js` 后
- 发版前质量检查

## 执行步骤

按以下 6 项检查，每项完成后立即报告。命令在插件仓库根目录执行（PowerShell 或 Node 均可）。

---

### 检查 1: 资产与注册数量

**目的**: `assets/skills`、`assets/agents` 的实际数量与注册/文档声明一致。

```powershell
(Get-ChildItem -Recurse assets\skills -Filter SKILL.md | Measure-Object).Count
(Get-ChildItem assets\agents -Filter *.md | Measure-Object).Count
Get-ChildItem assets\skills -Directory | ForEach-Object {
  "$($_.Name): $((Get-ChildItem -Recurse $_.FullName -Filter SKILL.md | Measure-Object).Count)"
}
```

**红灯**: Skill 总数不是 30；分类之和 ≠ 总数；Agent 不是 9。

---

### 检查 2: 文档计数与清单一致

**目的**: `README.md`、`assets/AGENTS.full.md`、`assets/skills/sg-core/sg-using-skills/SKILL.md` 中的数量与清单一致。

```powershell
Select-String -Path README.md,assets\AGENTS.full.md,assets\skills\sg-core\sg-using-skills\SKILL.md -Pattern '30|Skill|Agent' |
  Select-Object Path,LineNumber,Line
```

**红灯**: 出现 33/31/27 等旧计数；清单里列出的 Skill 在 `assets/skills` 中不存在。

---

### 检查 3: Agent 引用的 Skill 真实存在

**目的**: 每个 Agent 定义引用的 `sg-skill-*` 都能在 assets 中找到。

```powershell
$actual = Get-ChildItem -Recurse assets\skills -Filter SKILL.md |
  ForEach-Object { Split-Path $_.DirectoryName -Leaf } | Sort-Object -Unique
Get-ChildItem assets\agents -Filter *.md | ForEach-Object {
  Select-String -Path $_.FullName -Pattern '`sg-skill-[a-z-]+`' -AllMatches |
    ForEach-Object { $_.Matches.Value.Trim('`') } | Sort-Object -Unique |
    Where-Object { $actual -notcontains $_ } |
    ForEach-Object { "NOT FOUND in $($_.Name): $_" }
}
```

**红灯**: 任何 `NOT FOUND`。

---

### 检查 4: DSH 命令名与参数提示

**目的**: 命令名必须匹配 DSH 语法 `^[a-z0-9][a-z0-9_-]*$`，不再注册冒号别名；带参数的命令必须有 `input.hint`。

```powershell
node -e "import('./src/commands.js').then(({registerCommands}) => { const defs=[]; registerCommands({commands:{register(d){defs.push(d);return()=>{}}}}, {getCwd:()=>process.cwd()}); for (const d of defs) { console.log(d.name, d.input?.hint ?? '(no hint)'); } })"
```

**红灯**: 名称含 `:`；带参数命令缺少 `input.hint`；文档仍写 `/specgate:init`。

---

### 检查 5: 历史残留与 Qoder 专用内容

**目的**: `assets/` 中不应再出现 Qoder Hook、`.qoder/` 源路径、`superpowers` 残留；运行时 `adaptContent` 只能做兜底替换。

```powershell
Select-String -Path assets\**\*.md -Pattern 'Qoder|\.qoder/|SessionStart|UserPromptSubmit|superpowers' |
  Where-Object { $_.Line -notmatch 'DSH|迁移|适配|历史' } |
  Select-Object Path,LineNumber,Line
```

**红灯**: 仍有要求用户配置 Qoder Hook、读取 `.qoder/settings.json`、执行 `templates/qoder/` 的指令。

---

### 检查 6: 自动化测试与输出回归

**目的**: 命令/工具输出、notice、门控确认路径都有回归测试。

```powershell
node --test
```

**红灯**: 任何失败；`test/commands-report.test.js` 不再覆盖“新会话 notice / 活跃会话不重复 / running 不写消息 / 失败命令有输出”。

---

## 输出格式

每项检查完成后立即报告：

```
### 检查 N: {检查名称}
✅ 通过 — {简述}
```

或

```
### 检查 N: {检查名称}
❌ 发现 {N} 个问题:
- {问题描述} → {修复建议}
```

全部完成后汇总：

```
## 自检总结
- 通过: {N}/6
- 需修复: {列表}
- 推荐修复顺序: {按影响优先级排序}
```

## 关键红线

- ❌ 不得跳过任何检查项
- ❌ 不得凭记忆判断（必须执行命令验证）
- ❌ 发现问题不得自动修复（先报告，等用户确认）
- ✅ 每项检查 ≤ 3 条命令，控制噪音
- ✅ 修复原则：`assets/` 是权威源，先修 assets，再运行测试
