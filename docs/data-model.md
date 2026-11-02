# 数据模型

数据库起步使用 SQLite（`node:sqlite`），repository 层集中访问。外键开启，文件模式启用 WAL。

## 主要表

### review_cases

一条进入人工复核的需求。保留 `plugin_case_id` 与插件需求建立映射，保存原始需求、需求哈希、来源和当前状态。

### proposals

不可变调研提案版本。业务更新通过新版本表达；`assessment_revision` 标识版本，`scope_json` 保存执行范围，`scope_hash` 用于批准绑定。

### review_decisions

人工决策事实，保存 reviewer、意见、`idempotency_key` 和请求哈希。相同幂等键只能对应完全相同的请求内容。

### approval_grants

批准后生成的一次性授权：

- `requirement_hash`
- `scope_hash`
- `approved_at`
- `schedule_at`
- `expires_at`
- `consumed_at`
- `status`: `active | consumed | revoked | expired`

### schedules

持久化排期。`approval_synced_at` 表示审批事实已可靠发送给执行器。调度器只领取：

```text
status = scheduled
AND approval_synced_at IS NOT NULL
AND schedule_at <= now
```

### audit_events

只追加的审计事实。数据库触发器禁止 UPDATE 和 DELETE。记录实体、动作、操作者、前后摘要、trace ID 和 UTC 时间。

### plugin_events

插件事件幂等表。`event_id` 主键、`nonce` 唯一，保存处理状态与错误，便于排查和重试。

### outbox_messages

跨进程副作用的事务性 outbox。状态为 `pending | inflight | delivered | dead`，记录尝试次数、下次重试时间、最大次数和最后错误。

### users / settings

本地账号与角色；运行期最大并发配置。

## 关系

```text
review_cases 1 ── N proposals
proposals    1 ── N review_decisions
proposals    1 ── 0..1 approval_grants
proposals    1 ── 0..1 schedules
review_cases 1 ── N audit_events（逻辑关联）
```

## 时间与哈希

- 所有时间以 UTC ISO 8601 入库。
- UI 以 `Asia/Shanghai` 展示；排期输入包含用户时区。
- 哈希格式固定为 `sha256:<64 lowercase hex>`。
- `requirement_hash` 和 `scope_hash` 是跨系统字段，不允许改名或在不同层重新定义语义。

## 迁移

当前 schema 创建与迁移入口为 `apps/server/src/db/database.ts`。初始版本记录在 `schema_migrations`。后续变更必须新增版本步骤，不得修改已发布迁移语义。
