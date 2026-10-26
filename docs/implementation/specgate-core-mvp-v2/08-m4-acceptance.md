# M4 格式化、Review、H3 与交付验收

- 日期：2026-10-25；依据 CORE2-0401…0404；结果：通过。

格式化提交后，服务端在该 integration commit 上再次执行完整质量门；格式化无改动时也运行。质量报告的 runId 必须不同于格式化前记录，且报告 commit 必须等于格式化后的 commit。失败留在 FORMATTING 并记录失败报告与修复证据；状态迁移拒绝缺少第二次质量门的 Review。

Review 准备、执行、H3 请求以及归档预览均检查质量与 Review 的 commit。公开工具不接受调用方传入 Review 报告；未装配 provider 时明确返回 unavailable。原生 Reviewer 以只读 sandbox 执行，必须输出可解析结构化 JSON，报告记录服务端来源与会话信息。finding 必须引用所报文件、行号上的具体文本。测试中的 provider 为明确的 fixture，不计作真实原生 AI 会话。

客户摘要直接显示 DeliveryRecord 的全部 knownIssues，并显示记录中的 open risk 标识；未验证 AC 如出现在评估中会写入 knownIssues。回滚说明仍按记录输出。

- [M4 聚焦回归](../../verification/specgate-core-mvp/execution-20261025/m4-green-focused.txt)：57/57，0 fail/skip/cancel。包含格式化产生新 commit 后实际运行测试子进程、失败关闭 Review、跨 commit 与注入拒绝、H3、交付包回归。
- [完整回归](../../verification/specgate-core-mvp/execution-20261025/m4-green-full.txt)：719/719，0 fail/skip/cancel。
- [lint](../../verification/specgate-core-mvp/execution-20261025/m4-green-lint.txt)、[format](../../verification/specgate-core-mvp/execution-20261025/m4-green-format.txt)、[pack](../../verification/specgate-core-mvp/execution-20261025/m4-green-pack.txt)：退出 0。

测试使用独立短 TEMP。实际人工 H3、真实原生 Reviewer 会话和业务项目金丝雀仍属于 M6，当前未执行；本阶段不把 fixture 视作业务交付。
