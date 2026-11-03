# 架构说明

## 1. 当前总体架构

```text
┌──────────────────────────┐
│ 飞书 / GitHub            │
└────────────┬─────────────┘
             │ 需求
┌────────────▼─────────────┐
│ dsh-superagent           │
│ 接收 / 只读调研           │
│ 生成 Proposal             │
└────────────┬─────────────┘
             │ POST /api/plugin/events（HMAC）
┌────────────▼─────────────┐
│ Console Server            │
│ 接单 / 人工审批 / 排期     │
│ 权限 / outbox / 审计       │
└────────────┬─────────────┘
             │ 决策 + 排期 + 执行命令
┌────────────▼─────────────┐
│ dsh-superagent Executor   │
│ 校验 Grant / Worker / Git │
│ PR / 飞书回执              │
└────────────┬─────────────┘
             │ execution.* 事件
┌────────────▼─────────────┐
│ Console Web / 审计投影     │
└──────────────────────────┘
```

## 2. 职责

### dsh-superagent

- 接收飞书、GitHub 需求。
- 由主 Session 只读调研，不写文件、不提交、不开 PR。
- 生成 Proposal，携带需求哈希、范围哈希和测试计划。
- 接收 Console 的审批决策与排期事实。
- 到点后校验 `ApprovalGrant`，执行 Worker 与交付。
- 回传 `execution.started`、`execution.finished`、`execution.failed`。

### Console Server

- 幂等接收 Proposal 与执行事件。
- 维护复核队列、提案版本和执行投影。
- 执行 RBAC、自审拦截和选填审批意见的长度校验。
- 批准后生成一次性 Grant 与持久化排期。
- 通过 outbox 可靠调用执行器。
- 提供审计查询与统计。
- 不实现 Agent、Git、PR 或 Session 逻辑。

### Console Web

- 只负责信息呈现和用户操作。
- 不包含审批资格、版本绑定、Grant 校验等业务规则。
- 所有操作通过服务端 API 完成。

## 3. 高可用设计

1. 控制台不可用时，dsh-superagent 仍可接收需求并在本地持久化待发送 Proposal。
2. 插件事件以 `event_id` 幂等入库，nonce 防止请求重放。
3. 审批先写本地决策、Grant、排期和审计，再通过 outbox 调用插件。
4. outbox 失败保留 `pending` 状态，指数退避重试；进程重启会恢复 `inflight` 消息。
5. 排期从 SQLite 读取，不依赖内存定时器。
6. 插件消费 Grant 必须原子化并保证一次性。
7. Server `/health` 与 `/ready` 独立反映控制面状态和待投递数量。
8. 调度器按 `SCHEDULE_MAX_CONCURRENCY` 或系统设置限制并发。

## 4. 数据一致性

- 时间统一以 UTC ISO 字符串入库，Web 按 `Asia/Shanghai` 展示。
- 审批绑定 `requirement_hash` 与 `scope_hash`。
- 需求或范围变化时：
  1. 吊销未消费 Grant；
  2. 取消未执行排期；
  3. 提案和需求回到 `pending_review`；
  4. 写入 `approval.invalidated` 审计。
- 执行使用 `execution_id` 作为幂等键；网络重试不会创建第二次执行。

## 5. 模块边界

| 模块 | 职责 |
| --- | --- |
| `packages/contract` | TypeScript 类型、Zod 校验、JSON Schema、HMAC 契约 |
| `apps/server/src/domain` | 审批、事件投影、查询用例 |
| `apps/server/src/repositories` | SQL 与持久化映射 |
| `apps/server/src/plugin` | dsh-superagent HTTP 适配器 |
| `apps/server/src/schedule` | 持久化调度与 transactional outbox |
| `apps/server/src/audit` | 追加审计事实 |
| `apps/web` | 队列、详情、排期、执行、审计与设置页面 |

## 6. 配置边界

所有敏感项通过环境变量注入，详见根目录 `.env.example`。默认密钥只用于本地演示，生产环境必须替换。
