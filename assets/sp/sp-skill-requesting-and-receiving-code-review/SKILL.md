# sp-skill-requesting-and-receiving-code-review

## 何时使用

任务实现完成、准备合并前；以及收到 blocking 意见时。

## 请求审查

1. 给出 diff 范围、对应 AC、测试结果，不要只给“请审查”。
2. 指明需要重点看的风险：边界、错误路径、并发、安全。
3. 要求 reviewer 输出结构化结果：`verdict`、`blocking[{file,line,reason}]`、`nonBlocking[]`。

## 接收审查

1. 每条 blocking 必须有文件、行号、理由；缺一不合法，打回重写。
2. 先修 blocking，再讨论 nonBlocking；不要在未修复时争论。
3. 修复后重新跑验证，并把结果附在回复里。
4. 不同意某条 blocking 时，给出反例或测试，而不是“我觉得没问题”。

## 检查清单

- [ ] 请求里带了 AC 与测试结果
- [ ] blocking 有 file+line+reason
- [ ] 修复后重新验证
- [ ] 没有在 blocking 未清时合并

## 反模式

- “LGTM”式审查
- 只改代码不补测试
- 把 blocking 降级为“以后再说”
