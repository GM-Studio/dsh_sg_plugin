# 测试计划

- 需求版本：java-core@v1
- Change：java-core

## 用例

| 用例 | AC | 层次 | 描述 |
|---|---|---|---|
| TC-001 | AC-001 | integration | 默认组合生成可运行项目 |
| TC-002 | AC-002 | integration | 默认组合生成首个 change |
| TC-003 | AC-003 | integration | 重复初始化幂等 |
| TC-004 | AC-004 | integration | 展示合法选项 |
| TC-005 | AC-005 | integration | 拒绝非法组合 |
| TC-006 | AC-006 | integration | JDK 缺失可诊断 |
| TC-007 | AC-007 | integration | JDK11 + Boot2.7 |
| TC-008 | AC-008 | integration | JDK17 + Boot3 |
| TC-009 | AC-009 | integration | 模块与 JPA 选择 |
| TC-010 | AC-010 | integration | 已有 pom.xml 与 src |
| TC-011 | AC-011 | integration | 单模块测试与 XML |
| TC-012 | AC-012 | integration | AC 标签映射 |
| TC-013 | AC-013 | integration | 报告缺失 |
| TC-014 | AC-014 | integration | 根聚合 |
| TC-015 | AC-015 | integration | 指定模块 |
| TC-016 | AC-016 | integration | 多模块报告聚合 |
| TC-017 | AC-017 | integration | 构建超时 |
| TC-018 | AC-018 | unit | XML 解析失败 |
| TC-019 | AC-019 | integration | AC 标签缺失 |
| TC-020 | AC-020 | integration | 格式化与 Checkstyle 通过 |
| TC-021 | AC-021 | integration | Checkstyle 违规阻断 |
| TC-022 | AC-022 | integration | Spotless 缺失回退 |
| TC-023 | AC-023 | integration | 覆盖率通过 |
| TC-024 | AC-024 | integration | 覆盖率不足阻断 |
| TC-025 | AC-025 | integration | P0/P1/P2 通过率 |
| TC-026 | AC-026 | integration | 覆盖率缺失 |
| TC-027 | AC-027 | integration | 静态问题阻断 |
| TC-028 | AC-028 | integration | light profile |
| TC-029 | AC-029 | integration | analysis JVM 回退 |
| TC-030 | AC-030 | integration | baseline 生效 |
| TC-031 | AC-031 | unit | 识别 Maven/JDK/Boot |
| TC-032 | AC-032 | unit | 识别 Wrapper 与模块 |
| TC-033 | AC-033 | integration | 生成配置与报告 |
| TC-034 | AC-034 | integration | 构建文件不变且幂等 |
| TC-035 | AC-035 | integration | 执行既有测试 |
| TC-036 | AC-036 | integration | 覆盖率缺失降级 |
| TC-037 | AC-037 | integration | JDK 矩阵 |
| TC-038 | AC-038 | integration | 缓存与安全 |
| TC-039 | AC-039 | integration | Windows 冒烟 |
| TC-040 | AC-040 | integration | 测试计划覆盖 |
| TC-041 | AC-041 | integration | 文档 |
| TC-042 | AC-042 | integration | 全量回归 |
