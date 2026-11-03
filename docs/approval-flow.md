# 审批流程

## 状态机

```text
pending_review
  ├─ approve      → scheduled
  ├─ reject       → rejected
  └─ request_info → info_requested

info_requested
  └─ 新提案版本 → pending_review（旧版本 superseded）

scheduled
  ├─ pause     → paused
  ├─ reschedule → scheduled（更新 Grant 的排期与过期时间）
  ├─ withdraw  → cancelled（Grant revoked、需求回到 pending_review）
  └─ due   → executing

paused
  ├─ resume → scheduled
  ├─ reschedule → scheduled
  └─ withdraw → cancelled

executing
  ├─ execution.finished → completed
  └─ execution.failed   → failed
```

## 批准事务

一次批准在同一 SQLite 事务内完成：

1. 校验 reviewer/admin 角色。
2. 校验申请人不能批准自己的需求。
3. 校验当前提案为 `pending_review`。
4. 校验排期晚于当前时间、Grant 过期时间晚于排期。
5. 写入 `review_decisions`，使用唯一 `idempotency_key` 和请求哈希。
6. 更新需求和提案为 `scheduled`。
7. 写入一次性 `approval_grants`。
8. 写入 `schedules`。
9. 写入决策、Grant、排期审计。
10. 写入 `outbox_messages`。

提交后尝试投递 outbox。投递失败不会回滚人工决策，排期等待后续重试。

## 到期执行

```text
schedule_at <= now
  → 检查 Grant 为 active
  → 检查 Grant 未过期
  → 检查 requirement_hash / scope_hash 仍匹配
  → 原子领取任务，状态改为 executing
  → 写入 plugin.execute outbox
  → 调用 dsh-superagent
  → execution.finished 或 execution.failed 投影
```

同一 `execution_id` 的重放必须由执行器返回同一结果，不得创建第二个 Worker 或 PR。

## 改期与撤回

只有 `scheduled` / `paused` 且 Grant 为 `active`、尚未开始执行时允许改期或撤回。

改期在同一数据库事务内更新 Grant 与 Schedule，清空 `approval_synced_at`，再通过 transactional outbox 将新排期同步给执行侧。同步完成前调度器不会领取该任务。

撤回会吊销 Grant、取消 Schedule、把需求与提案恢复为 `pending_review`，并异步通知执行侧吊销旧 Grant。撤回后可再次审批；旧 Grant 与旧 Schedule 行会以新审批内容重新激活，审计记录保留完整前后状态。

## 失败路径

| 场景 | 行为 |
| --- | --- |
| 插件审批同步失败 | 排期保留，`approval_synced_at` 为空，outbox 重试 |
| 排期还未同步到插件 | 调度器不会领取，避免提前执行 |
| Grant 过期 | 排期失败，Grant 标记 expired，不调用执行器 |
| Requirement/Scope 变化 | 吊销 Grant、取消排期、回到 pending_review |
| 执行器网络失败 | 同一 execution_id 重试 |
| 最大重试耗尽 | 排期与执行标记 failed，审计写入失败原因 |
