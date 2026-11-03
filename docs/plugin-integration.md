# dsh-superagent 集成契约

## 方向 1：dsh-superagent → Console

### 事件入口

```http
POST /api/plugin/events
content-type: application/json
x-timestamp: 1762140000000
x-nonce: 9a4e0dfb-fb45-45b4-ae90-f3fca11f12bc
x-signature: <hex hmac>
```

签名内容：

```text
HMAC-SHA256(PLUGIN_EVENT_SECRET, `${timestamp}.${nonce}.${JSON.stringify(body)}`)
```

要求：

- timestamp 与服务器时间差不超过 5 分钟。
- nonce 在数据库唯一，禁止重放。
- `event_id` 幂等。
- `version` 当前为 `1.0`。

### Proposal 创建事件

```json
{
  "version": "1.0",
  "event_id": "evt_20261102_001",
  "event_type": "proposal.created",
  "occurred_at": "2026-11-02T06:10:00.000Z",
  "trace_id": "trace-feishu-8831",
  "data": {
    "case": {
      "id": "case_8831",
      "plugin_case_id": "feishu_8831",
      "source": "feishu",
      "requester": "陈晓",
      "title": "统一 HSE 隐患导出模板",
      "requirement_text": "导出字段需要与列表保持一致……",
      "requirement_hash": "sha256:...",
      "status": "pending_review",
      "risk_level": "high",
      "source_context": "飞书群「研发协作」",
      "message_url": "https://example.feishu.cn/messages/xxx",
      "created_at": "2026-11-02T06:09:30.000Z",
      "updated_at": "2026-11-02T06:09:30.000Z"
    },
    "proposal": {
      "id": "proposal_8831_v1",
      "review_case_id": "case_8831",
      "assessment_revision": 1,
      "summary": "调研结论……",
      "scope": ["修改导出 API", "补齐字段映射"],
      "scope_hash": "sha256:...",
      "rule_hits": ["touches-api"],
      "impact_files": ["vessel-web/src/api/hse.ts"],
      "test_plan": ["筛选组合测试", "导出性能测试"],
      "estimated_cost": "约 3 小时",
      "risk": "high",
      "risk_reason": "影响导出契约与权限边界",
      "status": "pending_review",
      "created_at": "2026-11-02T06:09:30.000Z",
      "updated_at": "2026-11-02T06:09:30.000Z"
    }
  }
}
```

其他事件：

- `proposal.updated`
- `proposal.superseded`
- `execution.started`
- `execution.finished`
- `execution.failed`

执行事件 `data`：

```json
{
  "proposal_id": "proposal_8831_v1",
  "execution_id": "execution_8831_01",
  "pr_url": "https://github.com/org/repo/pull/329",
  "error": "optional"
}
```

## 方向 2：Console → dsh-superagent

### 审批决策

```http
POST /orchestrator/api/proposals/:proposal_id/decision
```

```json
{
  "proposal_id": "proposal_8831_v1",
  "decision": "approve",
  "reviewer": "复核人",
  "comment": "范围明确，可以执行",
  "grant_id": "grant_123",
  "requirement_hash": "sha256:...",
  "scope_hash": "sha256:...",
  "schedule_at": "2026-11-03T02:00:00.000Z",
  "expires_at": "2026-11-04T02:00:00.000Z",
  "trace_id": "trace-approval-1",
  "idempotency_key": "review-approval-1"
}
```

dsh-superagent 必须校验：

- HMAC 与时间戳/nonce。
- proposal 当前状态。
- 两个哈希与插件保存事实一致。
- 排期与过期时间。
- Gatehouse 生成的 `grant_id`；执行侧必须使用同一 canonical ID，不能自行生成第二枚 ID。
- 幂等键；重复请求返回同一结果。

### 改期

```http
POST /orchestrator/api/proposals/:proposal_id/reschedule
```

请求包含 `proposal_id`、`grant_id`、两个哈希、新的 `schedule_at` / `expires_at`、`trace_id` 与 `idempotency_key`。执行侧只有在该 Grant 仍为 active、未消费且哈希一致时才能更新；重复的旧幂等键只能返回历史结果，不能把新排期回滚。

### 撤回

```http
POST /orchestrator/api/proposals/:proposal_id/withdraw
```

请求包含 `proposal_id`、`grant_id`、两个哈希、撤回原因、`trace_id` 与 `idempotency_key`。执行侧必须吊销 active Grant、把 Proposal 恢复为 `pending_review`，并拒绝旧 Grant 的后续执行请求。

### 到期执行

```http
POST /orchestrator/api/executions
```

```json
{
  "proposal_id": "proposal_8831_v1",
  "grant_id": "grant_123",
  "requirement_hash": "sha256:...",
  "scope_hash": "sha256:...",
  "execution_id": "execution_8831_01",
  "trace_id": "schedule_sched_123",
  "idempotency_key": "execute:execution_8831_01"
}
```

dsh-superagent 必须在创建 Ticket、启动 Worker、创建 worktree、写文件、提交或开 PR 之前原子校验并消费 Grant。没有有效 Grant 时所有执行副作用都必须被拒绝。

执行同步进入 dead 后，Gatehouse 只能在 Grant 仍有效且存在同一 `execution_id` 的 dead outbox 时允许人工重试。重试必须复用原 `execution_id`，防止重复 Ticket 或交付。

## 回调与最终状态

执行接口只负责原子消费 Grant、创建 Ticket 并返回 `execution_id` 与 `ticket_id`。Console 在调用成功后保持 `executing`，只有收到 `execution.finished` 才投影为 `completed`，收到 `execution.failed` 才投影为 `failed`。本地 mock adapter 可以同步模拟完成，但真实 dsh-superagent 必须回传事件。重放使用相同 `execution_id`，不得产生第二次交付。
