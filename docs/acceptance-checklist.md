# 验收清单

## 已实现并通过自动化验证

| 能力 | 验收方式 | 结果 |
| --- | --- | --- |
| Proposal 事件幂等入库 | `api.test.ts · verifies HMAC...` | 通过 |
| HMAC 签名与时间戳校验 | 错误签名返回 401 | 通过 |
| viewer 不能审批 | 决策 API 返回 403 | 通过 |
| 申请人不能自审 | approve 返回 `SELF_APPROVAL_FORBIDDEN` | 通过 |
| reviewer 不能修改系统配置 | 设置 API 返回 403 | 通过 |
| 审批幂等 | 相同 key + 相同内容返回 `replayed` | 通过 |
| 幂等键冲突 | 相同 key + 不同内容返回 409 | 通过 |
| scope 变化旧批准失效 | Grant revoked、排期 cancelled | 通过 |
| 未到期不执行 | 调度器 `claimed = 0` | 通过 |
| 到期只执行一次 | 首次执行 1 次，再次运行 0 次 | 通过 |
| 暂停后不执行 | 暂停排期后调度器不领取 | 通过 |
| 恢复后执行 | resume 后正常领取 | 通过 |
| Grant 过期拒绝执行 | 状态 failed / expired | 通过 |
| 控制台重启恢复排期 | 文件数据库重启后继续执行 | 通过 |
| outbox 失败可重试 | 首次失败 pending，第二次 delivered | 通过 |
| 执行器 HTTP 适配器 | HMAC 签名与版本化路由测试 | 通过 |
| review 模式 | 接受项生成 Proposal、不创建 Ticket | 通过 |
| Grant 硬门槛 | 哈希、排期、过期与一次性消费 | 通过 |
| 异步执行回执 | execute 后保持 executing，收到 finished 才完成 | 通过 |
| Worker 失败回执 | failed/blocked 报告生成 execution.failed | 通过 |
| 审计不可修改/删除 | SQLite 触发器抛出 append-only 错误 | 通过 |
| 组件化前端 | Ant Design 6 菜单、表格、表单、弹窗、日期选择、统计与状态标签 | 通过 |
| 前端可扩展性 | 页面级懒加载、依赖分块、统一主题与共享业务组件 | 通过 |
| Web 生产构建 | `vite build` | 通过 |
| 真实浏览器链路 | 登录、队列、详情、批准排期、排期、审计、移动端 | 通过 |

## 浏览器自测覆盖

`pnpm browser:smoke` 使用本机 Chrome 覆盖：

1. 演示账号登录。
2. 工作台统计和最近动态。
3. 待复核列表。
4. Proposal 详情、需求与范围哈希。
5. 审批弹窗、风险确认、排期输入。
6. 提交后进入已排期状态。
7. 排期看板。
8. 审计日志。
9. 390px 移动端布局和侧边栏。

产物位于 `.run/screens/`，结果位于 `.run/browser-smoke.json`。

## 执行侧集成状态

Console 的 HTTP adapter 与 `dsh-superagent` 审批桥均已实现：

```text
POST /orchestrator/api/proposals/:id/decision
POST /orchestrator/api/executions
```

`dsh-superagent` 侧已增加：

- `eval.mode = review`，接受项生成 Proposal 且不创建 Ticket。
- Review Proposal、ApprovalGrant、执行状态和 console event outbox 的持久化。
- 时间戳、nonce 与 HMAC 外部 API 入口。
- 执行前重新校验两个哈希、排期与过期时间，并原子消费 Grant。
- 批准后通过 `Engine.executeProposal` 创建 Ticket / Worker。
- `execution.started`、`execution.finished`、`execution.failed` 事件回传。

`PLUGIN_MODE=mock` 保留为不依赖外部进程的本地演示模式；真实联调使用 `PLUGIN_MODE=http` 并配置两侧共享密钥。


## 最终测试记录

- Gatehouse：契约 4 项、服务端 13 项、Web 3 项，共 20 项通过。
- Gatehouse：全工作区 TypeScript 检查通过。
- Gatehouse：生产构建通过，页面按路由拆分。
- dsh-superagent：审批相关 Core / Policy / HTTP / Panel / Locale / ApprovalBridge 共 461 项通过。
- dsh-superagent：TypeScript 检查与 tsdown 构建通过。
- Chrome 真实浏览器冒烟通过，控制台无报错或失败请求。
- 桌面端和 390px 移动端均完成回归。
- 演示数据库已重置为干净种子数据。

`dsh-superagent` 的完整仓库测试仍包含依赖 POSIX `sh`、`sleep`、symlink 和 Unix mode bits 的既有用例，在 Windows 执行环境中不属于本次审批桥接范围；本次改动相关测试已单独全量通过。
