# SNA-0003 AC/NFR/OI 三向追溯表（M0）

日期：2026-10-26
状态约定：`NOT_IMPLEMENTED`（未实施）、`NOT_RUN`（已实施未执行验证）、`PASS`（有真实执行证据）。
**本表此刻全部为 `NOT_IMPLEMENTED`；M0–M2 结束后只更新实际完成项，未完成项保持原状。**

## 1. AC 追溯（AC-01 – AC-36）

| AC    | 摘要                                     | 来源  | 里程碑 | 主责任务           | 验证方式   | 当前状态          |
| ----- | ---------------------------------------- | ----- | ------ | ------------------ | ---------- | ----------------- |
| AC-01 | 无 Maven/Vue/React 仓库不被直接拒绝      | FR-01 | M2     | SNA-0201           | 自动化测试 | `NOT_IMPLEMENTED` |
| AC-02 | 纯后端/纯前端/CLI/库/多模块均能表达      | FR-01 | M2     | SNA-0202           | 自动化测试 | `NOT_IMPLEMENTED` |
| AC-03 | 缺工具链仍可只读分析并列出缺口           | FR-01 | M2     | SNA-0203           | 自动化测试 | `NOT_IMPLEMENTED` |
| AC-04 | 候选需求可查看来源与证据类别             | FR-02 | M2     | SNA-0204           | 自动化测试 | `NOT_IMPLEMENTED` |
| AC-05 | 静态读取测试不标为运行验证通过           | FR-02 | M2     | SNA-0204           | 自动化测试 | `NOT_IMPLEMENTED` |
| AC-06 | 用户可确认/纠正/拒绝，修订保留历史       | FR-02 | M2     | SNA-0205           | 自动化测试 | `NOT_IMPLEMENTED` |
| AC-07 | 需求基线与执行基线分别表达               | FR-02 | M2     | SNA-0206           | 自动化测试 | `NOT_IMPLEMENTED` |
| AC-08 | 复用已存在兼容工具的真实路径与版本       | FR-03 | M3     | SNA-0301           | 自动化测试 | `NOT_IMPLEMENTED` |
| AC-09 | 不兼容工具列为不兼容                     | FR-03 | M3     | SNA-0302           | 自动化测试 | `NOT_IMPLEMENTED` |
| AC-10 | 只读检查不下载/不安装/不改配置           | FR-03 | M3     | SNA-0303           | 自动化测试 | `NOT_IMPLEMENTED` |
| AC-11 | 只准备当前任务需要的能力                 | FR-03 | M3     | SNA-0301           | 自动化测试 | `NOT_IMPLEMENTED` |
| AC-12 | 未授权前不发生下载安装或配置写入         | FR-04 | M3     | SNA-0304           | 自动化测试 | `NOT_IMPLEMENTED` |
| AC-13 | 版本/来源/位置/权限不一致不沿用旧授权    | FR-04 | M3     | SNA-0304           | 自动化测试 | `NOT_IMPLEMENTED` |
| AC-14 | 安装成功但复验失败时环境不通过           | FR-04 | M3     | SNA-0305           | 自动化测试 | `NOT_IMPLEMENTED` |
| AC-15 | 环境通过与构建/测试/Review 分别报告      | FR-04 | M3     | SNA-0305           | 自动化测试 | `NOT_IMPLEMENTED` |
| AC-16 | 双平台各有真实发现/复用/缺项/复验记录    | FR-05 | M4     | SNA-0402           | 双平台证据 | `NOT_IMPLEMENTED` |
| AC-17 | macOS/ARM64 未验收前明确标为预留         | FR-05 | M4     | SNA-0403           | 自动化测试 | `NOT_IMPLEMENTED` |
| AC-18 | 启动失败/权限不足/认证缺失原因可区分     | FR-05 | M4     | SNA-0404           | 自动化测试 | `NOT_IMPLEMENTED` |
| AC-19 | 重构可合法进入工作流，不必伪装           | FR-06 | M1/M5  | SNA-0103、SNA-0501 | 自动化测试 | `NOT_IMPLEMENTED` |
| AC-20 | 目标用例失败+回归通过不被拒绝            | FR-06 | M1/M5  | SNA-0101、SNA-0502 | 自动化测试 | `NOT_IMPLEMENTED` |
| AC-21 | 超时/缺依赖/进程异常不能冒充业务缺陷     | FR-06 | M5     | SNA-0503           | 自动化测试 | `NOT_IMPLEMENTED` |
| AC-22 | 纯模块变更不强制附加无关前后端任务       | FR-06 | M5     | SNA-0504           | 自动化测试 | `NOT_IMPLEMENTED` |
| AC-23 | 独立模块可并行，依赖任务等待             | FR-07 | M6     | SNA-0601           | 自动化测试 | `NOT_IMPLEMENTED` |
| AC-24 | 无效/循环依赖或输入缺失不派发            | FR-07 | M1/M6  | SNA-0102、SNA-0601 | 自动化测试 | `NOT_IMPLEMENTED` |
| AC-25 | 任务可追溯，自动调整限于批准范围         | FR-07 | M6     | SNA-0602           | 自动化测试 | `NOT_IMPLEMENTED` |
| AC-26 | 宿主能力不足时按实际可用调度             | FR-08 | M6     | SNA-0603           | 自动化测试 | `NOT_IMPLEMENTED` |
| AC-27 | 文件冲突/资源互斥/接口未稳定时串行       | FR-08 | M6     | SNA-0604           | 自动化测试 | `NOT_IMPLEMENTED` |
| AC-28 | 达时限或预算边界保存进度并停新任务       | FR-08 | M6     | SNA-0605           | 自动化测试 | `NOT_IMPLEMENTED` |
| AC-29 | 集成结果绑定任务/输入版本/会话/提交      | FR-08 | M6     | SNA-0606           | 自动化测试 | `NOT_IMPLEMENTED` |
| AC-30 | 常规变更展示验证选择及依据               | FR-09 | M7     | SNA-0701           | 自动化测试 | `NOT_IMPLEMENTED` |
| AC-31 | 关键版本缺真实闭环证据不得宣称通过       | FR-09 | M7     | SNA-0702           | 自动化测试 | `NOT_IMPLEMENTED` |
| AC-32 | 已成立约束不被要求先变业务失败           | FR-09 | M7     | SNA-0703           | 自动化测试 | `NOT_IMPLEMENTED` |
| AC-33 | 技术验证/人工验收/归档/推送/部署分别报告 | FR-09 | M7     | SNA-0704           | 自动化测试 | `NOT_IMPLEMENTED` |
| AC-34 | 仅有脚本或生成文档不产生通过结论         | FR-10 | M7     | SNA-0705           | 自动化测试 | `NOT_IMPLEMENTED` |
| AC-35 | 修改后提交不复用修改前 PASS              | FR-10 | M7     | SNA-0706           | 自动化测试 | `NOT_IMPLEMENTED` |
| AC-36 | 五类审批分别表达，不相互代替             | FR-10 | M7     | SNA-0707           | 自动化测试 | `NOT_IMPLEMENTED` |

## 2. NFR 追溯（NFR-01 – NFR-09）

| NFR    | 要求             | 里程碑     | 验收口径                                                         | 当前状态          |
| ------ | ---------------- | ---------- | ---------------------------------------------------------------- | ----------------- |
| NFR-01 | 扫描有界         | M2         | 文件数/单文件大小/时间三项预算，超限报告未扫描范围；数值待 OI-01 | `NOT_IMPLEMENTED` |
| NFR-02 | 数据边界         | M2         | 扫描不出宿主、不额外上传；日志不含源码正文                       | `NOT_IMPLEMENTED` |
| NFR-03 | 敏感内容保护     | M2         | 疑似密钥默认跳过，且不出现在 scanned 清单                        | `NOT_IMPLEMENTED` |
| NFR-04 | 可复现与可追溯   | M0、M2、M7 | 快照标识、计划版本、证据类别、命令与退出码                       | `NOT_IMPLEMENTED` |
| NFR-05 | 状态真实         | M7         | not-run/skipped/cancelled/timeout 不得显示为通过                 | `NOT_IMPLEMENTED` |
| NFR-06 | 资源受控         | M6         | ≤4 并发（不含主控）、单次 ≤30 分钟；无法取价时标 unknown         | `NOT_IMPLEMENTED` |
| NFR-07 | 用户改动保护     | M0、M8     | 不覆盖既有工作树改动；不默认提交或推送                           | `NOT_IMPLEMENTED` |
| NFR-08 | 平台与技术栈解耦 | M4         | 只读分析不因平台或语言工具不可用而整体阻断                       | `NOT_IMPLEMENTED` |
| NFR-09 | 效率可解释       | M6、M8     | 记录扫描/准备/排队/执行/集成/返工六段耗时                        | `NOT_IMPLEMENTED` |

## 3. OI 追溯（OI-01 – OI-08）

| OI    | 待确认项               | 首个需要答案的里程碑 | 未确认时的保守默认                                      | 状态              |
| ----- | ---------------------- | -------------------- | ------------------------------------------------------- | ----------------- |
| OI-01 | 扫描与性能预算         | M2                   | 文件数 20000 / 单文件 1 MiB / 总时间 60 s（标注待确认） | `NOT_IMPLEMENTED` |
| OI-02 | 平台验收样例           | M4                   | Windows 11 + Ubuntu 22.04 LTS；非原生结果不得顶替       | `NOT_IMPLEMENTED` |
| OI-03 | 缺失/已知失败基线准入  | M2                   | 存在已知失败时禁止实施，除非用户显式接受缺口            | `NOT_IMPLEMENTED` |
| OI-04 | 工具与启动引导         | M3、M4               | 只做发现+复用+缺项报告；安装执行留 NOT_RUN              | `NOT_IMPLEMENTED` |
| OI-05 | 并发预算作用域与恢复   | M6                   | 预算单会话内有效并显式标注                              | `NOT_IMPLEMENTED` |
| OI-06 | 金丝雀触发判定         | M7、M8               | 全部内核模块变更均视为触发                              | `NOT_IMPLEMENTED` |
| OI-07 | 候选基线确认与冲突规则 | M2                   | 逐条确认；冲突必须并列展示不得静默合并                  | `NOT_IMPLEMENTED` |
| OI-08 | 历史模型与约束迁移     | M1                   | v2 只读兼容 + 纯函数迁移器，不自动改写已冻结资产        | `NOT_IMPLEMENTED` |

## 4. 覆盖自检

| 项                           | 期望 | 本表实际      |
| ---------------------------- | ---- | ------------- |
| AC 条数                      | 36   | 36            |
| NFR 条数                     | 9    | 9             |
| OI 条数                      | 8    | 8             |
| 重复编号                     | 0    | 0（逐条唯一） |
| 每条至少一个里程碑与验收来源 | 是   | 是            |

## 5. 说明

- 本表只做追溯，不构成任何 AC 已通过的声明。
- M1 只交付 AC-19/AC-20/AC-24 的**前置结构**（版本化档案、上界校验、词表统一），功能实现分别在 M5/M6；因此这三条 AC 在 M1 结束时仍为 `NOT_IMPLEMENTED`。
