# 设计

- 从 Git 暂存区或推送 ref 的 blob 生成隔离快照，检查与测试均在快照执行。删除、重命名、带空格/中文路径采用 NUL 分隔，未支持的代码类型阻断。
- JS/TS 使用 ESLint 与 Prettier；JSON/YAML/CSS/HTML/Vue 使用对应解析器；Java/Vue 模板通过物化项目真实检查，Python 使用 Ruff，Shell 使用语法检查。代码参考样例单独记录有限检查范围。
- 检查失败必须非零退出。格式化单独执行、不调用 git add。依赖与工具复用现有安装，缺失提示并阻断；隔离快照保留失败证据，成功清理。
- 安装器检查实际 hooksPath，不覆盖自定义钩子；提供诊断入口。CI 包含 sg-java 推送；Linux Java 模板矩阵只保留手动选项。
- Note 参考资源直接物化为隔离 JDK8 项目，保留原始候选参考文件；新增合成 Note 分层辅助代码只修正重命名后的 import 顺序，不自动格式化候选输入。不把完整 sg-change 角色执行和浏览器 E2E 加入批准的基础提交门禁。
- Java/Vue 模板启动脚本执行语法、ESLint、Prettier；第三方 Maven Wrapper 使用已审查内容哈希，修改或删除阻断。模板代码按编译器/检查器实际覆盖目录分类，避免放在未编译路径的代码被放行。
- 成功清理大型隔离快照，但保留命令日志、完整 verify-runs 与汇总；失败保留快照。Golden 更新只基于刚刚完成且哈希一致的真实四档验收，Linux 保持 not-run。
