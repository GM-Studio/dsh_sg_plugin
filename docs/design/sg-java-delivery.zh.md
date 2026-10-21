# sg-java 交付与验证记录

> 历史文档：sg-java 4.3 起已移除 sg-init 内置多 agent 验收/测试/交付流程；当前需求与实现以 [v4.3 需求](../requirements/2026-10-21-v4.3-sg-init-closed-loop-requirements.md) 为准。

## 源码与边界
实现位于隔离 sg-java worktree，原 feat/v4-monorepo 工作区保留。未自动提交或发布插件源码；新生成项目 Git 基线与初始化归档属于确认授权。

## 新默认使用
/sg-init --path <完全空目录> 默认 lenient：生成35文件完整 Java8/Boot2.7.18/Vue3/TS 项目、req v1、Git 基线，隔离并发 test/lint/format/review，受控修复后重新验证；真正审查通过、无高/严重未解决风险且已知代码检查失败不能接受。环境失败明示未验证。

--strict 要求实际构建/测试/静态/格式/走查/HTTP CRUD/重启持久化全部通过；--generate-only 只生成，不归档质量通过。quality={mode,generateOnly}；旧 execution 仅附加兼容，工具链安装需显式选。

无宿主多agent服务时返回 MAIN_AGENT_PENDING，工具主agent自然继续；slash通过延迟followup继续而不是 notice 冒充执行。主agent实际记录 test/lint/format/review 四文件，调用 sg_init_finalize；修复后 sg_init_resume 校验范围、重绑基线并重新审查。报告位于 guard 允许的 docs/initialization/pending/<baseline>，隔离报告 docs/initialization/agent-reports，未放松 .specgate 写保护。

## 安全与归档
报告仅数据，校验实际文件/hash/命令结果，防路径逃逸、junction、配置/req改写、陈旧审查与任意agent commit。严格最终format使用check不修改已审源码；并发取消回收隔离worktree。

finalize/resume按根串行锁，策略绑定已确认tracked metadata，修复提交只含分配路径，lockfile精确校验；归档仅提交确切归档及req两份文件，不包含用户预暂存内容。真实归档commit后才IDLE，后续change独立人工审批。失败归档同进程可凭已验证快照重试；重启后未签名状态不可当作已验证凭证，需重新验证。

## 验证证据
最新全库421测试通过，ESLint通过，新增相关文件Prettier检查通过，npm pack --dry-run通过；既有全库格式约160历史告警未批量改写。包括严格/宽松/仅生成、无服务真实降级、实际写guard兼容、H1/H2/H3衔接、事务失败并发重复、元数据篡改、symlink逃逸和受控修复。

开发代表项目使用明确mock确认fixture（不是生产宿主人类批准）；生成代码实际独立agent走查，前端5测试/类型构建/Vite构建/ESLint/Prettier通过，后端Spotless检查通过。修复Windows默认EOL导致Spotless假格式差异：pin UNIX；修复编辑期间toggle后Save回滚completion并加真实回归。

代表项目已完成实际宽松独立归档：生成基线13fb057，修复基线eb5dfeb，归档commit 1e4f297ca7da86311fe7660652f4e00ef7888773；init-report与根state均IDLE。归档阶段test/lint=unverified、format/review=verified，后续change守卫恢复标准校验，未自动创建业务change。默认宿主自动并发路径通过注入宿主服务及实际写guard测试；本次代表项目采用无服务降级及真实独立代码审查，尚未在安装插件的实际宿主激活链整条运行。

## 未验证与剩余风险
本机Java进程无法创建backend target输出：Maven test提示Cannot create resource output directory；Checkstyle提示Unable to create output stream。此为实际环境失败，未以shell权限绕过。后端测试/静态、真实CRUD运行、重启持久化未在代表项目验证，严格代表验收尚未完成；宽松仅语义走查通过并明确保留未验证。

Java8/Boot2维护风险与无认证不是生产安全承诺。剩余非阻塞项：标准HTTP405/415可被通用异常映射500（中），并发编辑last-writer-wins（低），不冒充全部风险清零。宿主agent报告命令日志是AI记录证据而非密码学证明，严格通过真实执行复验。Git worktree不是OS权限隔离，dispatch注入必须响应abort。
