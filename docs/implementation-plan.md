> 2026-11-02 实施口径更新：`dsh-superagent` 负责需求接收、只读评估和执行交付；本项目负责接单、人工复核、版本绑定、排期、触发执行与审计。真实执行器通过版本化 HTTP API 接入。

# Gatehouse 实施计划

## 1. 背景与目标

当前 `dsh-superagent` 已经能够接收飞书或 GitHub 需求，由主 Session 评估后自动创建 Ticket 并交给 Worker 执行。直接自动执行对需求类工作不够安全：调研结论尚未被人工确认前，不应产生代码修改、worktree、提交或 PR。

本项目新增一个独立的人工复核与排期控制台，用于展示调研结果、执行范围、影响面和风险，并由人工决定批准、驳回或要求补充。人工批准后，任务进入排期，到达执行时间再由 `dsh-superagent` 自动执行。

### 目标流程

```text
飞书 / GitHub 需求
→ dsh-superagent 接收
→ 主 Session 只读调研
→ 生成执行提案 Proposal
→ 发送到独立控制台
→ 人工复核
→ 批准 / 驳回 / 要求补充
→ 批准后生成排期
→ 到期后插件创建 Ticket
→ Worker 自动执行
→ PR / 飞书回执
→ 控制台展示执行结果与审计
```

### 核心原则

1. 人工批准前绝不执行。
2. 调研 Session 只读，不写文件、不提交、不开 PR。
3. 批准必须绑定需求版本和执行范围。
4. 控制台不直接读写插件 SQLite。
5. 插件只增加最小的审批网关与执行门槛。
6. 控制台独立演进，承担队列、审批、排期、展示和审计。

## 2. 架构质量约束

本项目的架构决策必须同时满足以下四项要求。后续新增模块、API 或表结构时，先对照本节检查；无法同时满足时，缩小范围或拆分设计，不允许以“临时方案”绕过。

### 2.1 高可用

目标：控制台短暂不可用时，不丢失需求、不重复审批、不阻断插件接收消息。

约束：

1. 插件是需求接收的第一入口。控制台宕机时，插件继续接收并持久化 Proposal，事件通过重试队列发送。
2. 插件事件与审批命令必须幂等。同一事件 ID、同一 idempotency key 重放不能改变最终结果。
3. 控制台数据库写入与外部插件调用分离：先本地持久化决策与审计，再调用插件；调用失败保留待重试状态。
4. 排期器必须可恢复。服务重启后从数据库读取下一批任务，不依赖内存定时器。
5. ApprovalGrant 一次性消费。插件在创建 Ticket 前原子校验并消费 Grant，避免网络重试导致重复执行。
6. 插件与控制台各自健康检查独立暴露，避免一方健康状态被另一方掩盖。
7. 所有跨进程调用必须有超时、重试上限、失败原因和可对账的状态。

### 2.2 易维护

目标：小模块、明确契约、少隐式行为，升级插件或控制台时可以独立发布。

约束：

1. 契约集中在 `packages/contract`，两侧不得私自定义不兼容字段。
2. API 版本从 `v1` 开始；兼容变更不改变旧字段语义，破坏性变更新增版本。
3. 领域逻辑不写在路由处理器或 React 组件中；路由只做参数校验和调用用例。
4. 数据库访问集中在 repository 层，业务用例不手写 SQL 字符串。
5. 外部插件调用集中在 `plugin` adapter，不在页面、调度器或审计模块中散落 HTTP 细节。
6. 配置通过显式环境变量或配置文件注入，不隐藏在代码常量中。
7. 每个模块的公开导出必须有简明契约说明；复杂流程必须有一张当前行为图。
8. 迁移脚本与代码同步提交，且支持从上一个稳定版本升级。

### 2.3 单一职责

目标：每个模块只有一个变化原因，插件与控制台不形成双向维护负担。

职责划分：

```text
dsh-superagent：
  需求接收、调研、Proposal 生成、ApprovalGrant 校验、Worker 执行、Git/PR 交付

console server：
  复审队列、审批决策、排期、权限、审计、插件事件投影

console web：
  信息呈现与人工操作入口，不承载审批规则
```

约束：

1. 控制台不实现 Agent 执行、Git、PR 或 Session 逻辑。
2. 插件不实现复杂审批 UI、组织权限或报表。
3. Server 的领域用例按审批、排期、审计、插件投影拆分，不建一个大而全的 service。
4. Web 页面按队列、详情、排期、执行、审计拆分；共享 UI 放 components，不共享业务判断。
5. 审计模块只记录与查询事件，不参与审批放行判断。
6. 排期模块只决定何时调用插件，不重新判断提案是否值得批准。

### 2.4 方便人类阅读和理解

目标：新维护者能在短时间内理解状态流、数据归属和失败路径。

约束：

1. 状态名使用业务语言，避免技术实现名；每个状态必须有进入条件、允许动作和退出路径。
2. 所有跨系统字段必须同名或显式映射，例如 `requirement_hash`、`scope_hash`、`idempotency_key`。
3. API 错误必须包含稳定错误码、人类可读原因和建议动作。
4. 页面上的每个状态必须解释“现在等谁、下一步是什么、失败在哪里看”。
5. 时间统一保存 UTC，展示层按用户时区格式化；排期输入明确包含时区。
6. 标识、哈希和外部链接使用等宽字体，长文本提供复制按钮。
7. 请求、提案、批准、排期、执行使用同一 trace ID 串联。
8. 文档与行为不一致时，以代码行为验证结果为准，并在同一变更中修正文档。

## 3. 项目定位

新项目目录：

```text
D:\code\dsh-gatehouse
```

定位：

- `dsh-superagent`：消息接收、调研、规则评估、Ticket、Worker、Session、Git、PR。
- `dsh-gatehouse`：人工复核、审批、排期、权限、通知、展示、审计、统计。

控制台不是另一个 Agent 执行器，也不复制 `dsh-superagent` 的执行内核。它是一个独立的管理面，通过版本化 API 与插件集成。

### 3.1 总体架构

```text
┌──────────────────────┐
│ dsh-superagent       │
│ - 飞书 / GitHub 触发 │
│ - 主 Session 调研    │
│ - Proposal 生成      │
│ - ApprovalGrant 校验 │
│ - Worker 执行        │
│ - Git / PR 交付      │
└──────────┬───────────┘
           │ HTTP API + HMAC + idempotency key
┌──────────┴───────────┐
│ console server       │
│ - 复审队列           │
│ - 审批决策           │
│ - 排期               │
│ - 权限               │
│ - 审计               │
└──────────┬───────────┘
           │ REST / WebSocket
┌──────────┴───────────┐
│ console web          │
│ - 队列 / 详情        │
│ - 排期 / 执行        │
│ - 审计 / 统计        │
└──────────────────────┘
```

### 3.2 边界规则

必须通过 API 集成：

- 插件向控制台发送事件。
- 控制台向插件发送审批决策。
- 所有命令签名、幂等并携带版本号。

禁止：

- 控制台直接连接或修改插件 SQLite。
- 控制台直接创建 PR。
- 控制台绕过插件启动 Worker。
- 控制台直接修改插件内部 Session 状态。

## 4. 目录结构

建议初始结构：

```text
D:\code\dsh-gatehouse
├─ apps/
│  ├─ server/
│  │  ├─ src/
│  │  │  ├─ api/
│  │  │  ├─ domain/
│  │  │  ├─ plugin/
│  │  │  ├─ schedule/
│  │  │  ├─ audit/
│  │  │  └─ db/
│  │  └─ tests/
│  └─ web/
│     ├─ src/
│     │  ├─ pages/
│     │  │  ├─ ReviewQueue/
│     │  │  ├─ CaseDetail/
│     │  │  ├─ Schedule/
│  │  │  ├─ Execution/
│  │  │  ├─ Audit/
│  │  │  └─ Settings/
│     │  ├─ components/
│     │  └─ api/
├─ packages/
│  └─ contract/
│     ├─ src/
│     └─ schemas/
├─ docs/
│  ├─ implementation-plan.md
│  ├─ architecture.md
│  ├─ approval-flow.md
│  ├─ plugin-integration.md
│  └─ data-model.md
├─ pnpm-workspace.yaml
├─ package.json
└─ README.md
```

技术选型：

- TypeScript。
- pnpm workspace。
- 后端：Fastify。
- 前端：React + Vite。
- 数据库：SQLite 起步，保留 PostgreSQL 迁移空间。
- 契约：OpenAPI + JSON Schema。
- 部署：先本机运行，后续 Docker。

## 5. 领域模型

### 5.1 ReviewCase

一条进入人工复核流程的需求。

```text
id
plugin_case_id
source
requester
title
requirement_text
requirement_hash
status
risk_level
created_at
updated_at
```

### 5.2 Proposal

主 Session 调研后生成的执行提案。

```text
id
review_case_id
assessment_revision
summary
scope
scope_hash
rule_hits
impact_files
test_plan
estimated_cost
risk
risk_reason
status
created_at
```

状态：

```text
pending_review
info_requested
approved
rejected
superseded
scheduled
executing
completed
failed
```

### 5.3 ReviewDecision

人工复核决策。

```text
id
proposal_id
decision
reviewer
comment
created_at
```

决策类型：

```text
approve
reject
request_info
```

### 5.4 ApprovalGrant

批准后插件用于放行执行的一次性授权。

```text
id
proposal_id
reviewer
requirement_hash
scope_hash
approved_at
schedule_at
expires_at
consumed_at
```

规则：

- 需求文本变化后失效。
- 执行范围变化后失效。
- 过期后失效。
- 只能消费一次。
- 插件必须独立校验，不能信任控制台 UI 状态。

### 5.5 AuditEvent

审计事件。

```text
id
entity_type
entity_id
action
actor
before
after
created_at
```

审计事件不可修改、不可删除。

## 6. 状态机

### ReviewCase / Proposal 状态流

```text
pending_review
  ├─ request_info → info_requested
  ├─ reject → rejected
  └─ approve → approved
info_requested
  └─ 新补充信息 → pending_review / superseded
approved
  └─ 排期 → scheduled
scheduled
  └─ 到期 → executing
executing
  ├─ 成功 → completed
  └─ 失败 → failed
```

补充信息不建议直接覆盖原始提案。应生成新的 Proposal 版本，并将旧提案标记为 `superseded`，保留完整审计。

## 7. 插件侧增强

插件项目仍位于：

```text
D:\code\dsh-superagent
```

只做最小增强，不把控制台 UI 塞进插件面板。

### 7.1 新增评估模式

现有评估模式：

```text
off
observe
auto
```

新增：

```text
review
```

语义：

- 显式请求仍进入主 Session 评估。
- 评估通过后不创建执行 Ticket。
- 创建 Proposal。
- 等待人工批准。

### 7.2 Proposal 存储

插件内保存 Proposal 摘要与哈希，至少包含：

```text
id
trigger_id
source
requester
requirement_text
requirement_hash
assessment_revision
scope
scope_hash
status
created_at
```

插件不需要保存控制台 UI 状态；插件只保存执行放行所需事实。

### 7.3 插件 API

```http
GET  /orchestrator/api/proposals
GET  /orchestrator/api/proposals/:id
POST /orchestrator/api/proposals/:id/decision
```

决策请求示例：

```json
{
  "decision": "approve",
  "reviewer": "演示复核人",
  "comment": "范围明确，可以执行",
  "requirement_hash": "sha256:...",
  "scope_hash": "sha256:...",
  "schedule_at": "2026-11-03T10:00:00+08:00",
  "expires_at": "2026-11-04T10:00:00+08:00",
  "idempotency_key": "review-0001-approve"
}
```

插件必须校验：

- API token 或 HMAC。
- `requirement_hash`。
- `scope_hash`。
- `schedule_at`。
- `expires_at`。
- idempotency key。
- proposal 当前状态。

### 7.4 执行硬门槛

插件内部强制：

```text
没有有效 ApprovalGrant
→ 不创建 Ticket
→ 不启动 Worker
→ 不创建 worktree
→ 不写文件
→ 不提交
→ 不开 PR
```

这个门槛必须实现为插件内部不变量，不能只依赖前端按钮状态。

## 8. 控制台 API

### 8.1 插件事件入口

控制台接收插件事件：

```http
POST /api/plugin/events
```

事件类型：

```text
proposal.created
proposal.updated
proposal.superseded
execution.started
execution.finished
execution.failed
```

要求：

- HMAC 签名。
- 时间戳防重放。
- 幂等事件 ID。
- 版本化 payload。

### 8.2 控制台前端 API

```http
GET  /api/review-cases
GET  /api/review-cases/:id
GET  /api/proposals/:id
POST /api/proposals/:id/decision
GET  /api/schedule
POST /api/schedule/:id/pause
POST /api/schedule/:id/resume
GET  /api/audit
```

### 8.3 审批命令

控制台调用插件：

```http
POST /orchestrator/api/proposals/:id/decision
```

所有审批命令必须：

- 带审批人。
- 带 `requirement_hash`。
- 带 `scope_hash`。
- 带幂等键。
- 写审计记录后再回写插件。

## 9. 页面设计

### 9.1 待复核队列

列表字段：

- 标题。
- 来源：飞书 / GitHub。
- 提出人。
- 风险等级。
- 命中规则。
- 创建时间。
- 当前状态。
- 操作：进入详情。

筛选：

- 待复核。
- 待补充。
- 已批准。
- 已驳回。
- 已排期。
- 执行中。
- 已完成。
- 失败。

### 9.2 详情页

左侧：

- 原始需求。
- 来源上下文。
- 提出人。
- 消息链接。
- 历史补充。

右侧：

- Agent 调研结论。
- 建议执行范围。
- 影响文件。
- 测试计划。
- 风险说明。
- 命中规则。
- 预估成本。
- 历史提案版本。

操作：

```text
批准并排期
驳回
要求补充信息
```

批准时必填：

- 排期时间。
- 审批意见。
- 风险确认。

### 9.3 排期页

支持看板或日历：

```text
待批准
已批准待排期
已排期
执行中
已完成
失败
```

展示：

- 当前执行数。
- 最大并发。
- 今日待执行。
- 超时任务。
- 阻塞任务。

### 9.4 审计页

完整链路：

```text
消息到达
→ 调研完成
→ 提案创建
→ 人工批准
→ 排期
→ Ticket 创建
→ Worker 启动
→ PR 创建
→ 完成
```

每一步记录：

- 时间。
- 操作者。
- 输入摘要。
- 输出摘要。
- 错误信息。

## 10. 安全与权限

### 10.1 角色

```text
viewer
reviewer
admin
```

权限：

- viewer：只读。
- reviewer：复核、批准、驳回、要求补充。
- admin：配置插件连接、成员、角色、执行窗口。

### 10.2 分离约束

- 申请人不能批准自己的需求。
- 只有 reviewer 或 admin 能批准。
- 高风险需求可要求第二个审批人，作为后续增强。
- 所有审批必须留下意见。

### 10.3 通信安全

- 插件与控制台使用共享 secret 生成 HMAC。
- 请求带 timestamp 与 nonce。
- 所有命令带 idempotency key。
- 契约带版本号。
- 敏感配置使用环境变量，不提交仓库。

## 11. 实施阶段

### Phase 0：项目初始化、架构约束与契约冻结

产出：

```text
D:\code\dsh-gatehouse
├─ apps/server
├─ apps/web
├─ packages/contract
└─ docs
```

任务：

1. 初始化 Git 仓库。
2. 初始化 pnpm workspace。
3. 编写 architecture.md。
4. 编写 approval-flow.md。
5. 定义 OpenAPI。
6. 定义 Proposal / Decision / Grant JSON Schema。
7. 定义插件事件。
8. 用 mock 数据渲染提案详情页。
9. 建立架构检查清单：高可用、易维护、单一职责、人类可读。
10. 为每条硬约束写出对应验收方式。

验收：

- 契约文档评审通过。
- mock 队列与详情页可打开。
- schema 校验测试通过。

### Phase 1：插件增加 review 模式

任务：

1. 增加 `eval.mode = review`。
2. 生成 Proposal。
3. 保存 requirement_hash 与 scope_hash。
4. 未批准前禁止创建 Ticket。
5. 新增 Proposal API。
6. 新增审批决策 API。
7. 新增 ApprovalGrant。
8. 增加插件端单元测试。

验收：

1. 飞书发送明确需求后生成 Proposal。
2. 没有 Worker 启动。
3. 没有 worktree 创建。
4. 没有 PR。
5. 批准后才创建 Ticket。
6. 重复批准请求不会重复执行。
7. scope 变化后旧批准失效。

### Phase 2：控制台 MVP

任务：

1. 接收插件事件。
2. 入库。
3. 展示待复核队列。
4. 展示详情页。
5. 支持批准、驳回、要求补充。
6. 调插件 API 写回决策。
7. 展示基础时间线。

验收：

- 飞书消息可以进入控制台。
- 人工批准后任务进入排期。
- 驳回后不执行。
- 刷新页面后状态正确。
- 审批动作全部有审计记录。

### Phase 3：排期与自动执行

任务：

1. 批准时填写 schedule_at。
2. 控制台展示排期。
3. 到期调用插件执行。
4. 插件校验 ApprovalGrant。
5. 支持暂停与恢复。
6. 支持最大并发限制。
7. 插件重启后恢复排期状态。

验收：

- 批准但未到期不执行。
- 到期自动执行。
- 插件重启后排期不丢失。
- ApprovalGrant 过期后不能执行。
- 排期暂停后不执行。

### Phase 4：权限与安全

任务：

1. 用户登录。
2. 角色权限。
3. 申请人不能 self-approve。
4. API token / HMAC。
5. 幂等键。
6. 审计不可删改。

验收：

- viewer 不能批准。
- reviewer 不能修改系统配置。
- 申请人不能批准自己的需求。
- 重放请求不会重复执行。
- scope 或 requirement 变化后旧批准失效。

### Phase 5：展示增强

任务：

1. 风险统计。
2. 规则命中统计。
3. 平均复核时长。
4. 执行成功率。
5. PR 链接。
6. 飞书原始消息链接。
7. 失败原因分析。
8. 审批 SLA。

后续增强：

- 多仓库。
- 多级审批。
- 审批模板。
- 定时执行窗口。
- 预算限制。
- 周报。

## 12. 第一周交付目标

目标是一条完整闭环：

```text
飞书 @机器人提需求
→ 插件生成 Proposal
→ 控制台出现待复核项
→ 人工批准并排期
→ 到期自动执行
→ 插件创建 PR
→ 控制台展示执行结果和审计记录
```

建议节奏：

| 时间 | 交付 |
| --- | --- |
| 第 1 天 | 新目录初始化、契约设计、mock 页面 |
| 第 2 天 | 契约冻结、schema 测试 |
| 第 3 天 | 插件 review 模式与 Proposal API |
| 第 4 天 | 未批准禁止执行与 ApprovalGrant |
| 第 5 天 | 控制台队列、详情、审批 API |
| 第 6 天 | 排期执行与幂等校验 |
| 第 7 天 | 端到端测试、审计页面、文档补齐 |

## 13. 测试计划

### 插件测试

必须覆盖：

- review 模式不创建 Ticket。
- review 模式不启动 Worker。
- 未批准不创建 worktree。
- 批准后创建 Ticket。
- 重复批准只执行一次。
- requirement_hash 不匹配时拒绝。
- scope_hash 不匹配时拒绝。
- ApprovalGrant 过期拒绝。
- API 签名错误拒绝。
- 插件重启后恢复 Proposal 状态。

### 控制台测试

必须覆盖：

- 插件事件入库。
- 重复事件不重复入库。
- 队列筛选。
- 详情展示。
- 批准、驳回、要求补充。
- 申请人不能 self-approve。
- viewer 不能审批。
- 审计事件完整。
- 排期未到期不触发。
- 到期触发一次。

### 端到端测试

场景：

1. 飞书明确需求 → 生成待复核项。
2. 驳回 → 不执行。
3. 要求补充 → 生成新提案版本。
4. 批准并排期 → 到期执行。
5. 执行成功 → PR 与审计记录。
6. 执行失败 → 展示失败原因。
7. scope 变化 → 旧批准失效。
8. 重放批准请求 → 不重复执行。

## 14. 第一阶段明确不做

避免第一版范围失控：

1. 不重写 Agent 执行器。
2. 不直接操作插件 SQLite。
3. 不让控制台直接创建 PR。
4. 不把复杂审批 UI 塞进 dsh-superagent 面板。
5. 不做多级审批流。
6. 不做复杂组织架构同步。
7. 不做 Kubernetes 部署。
8. 不做多租户。
9. 不做多仓库支持。

先把“单级人工复核 + 排期 + 审计 + 自动执行”跑通。

## 15. 风险与应对

| 风险 | 影响 | 应对 |
| --- | --- | --- |
| 插件与控制台契约漂移 | 审批状态不一致 | OpenAPI + JSON Schema + 契约测试 |
| ApprovalGrant 被绕过 | 未批准任务执行 | 在插件 Ticket 创建前强制校验，并用测试锁住 |
| 需求或范围变化后旧批准仍有效 | 执行错误范围 | requirement_hash 与 scope_hash 双绑定 |
| 插件热重载状态丢失 | Proposal 或排期丢失 | Proposal 与 Grant 持久化，重启后恢复 |
| 控制台重复发送审批 | 重复执行 | idempotency key 与一次性 Grant |
| 网络中断 | 审批不同步 | 事件重试、幂等入库、状态对账 |
| 审计被修改 | 合规风险 | 审计表 append-only，普通接口不提供更新 |
| UI 状态与插件状态不一致 | 误以为已批准 | 插件状态为准，控制台展示同步版本与校验结果 |

## 16. 完成定义

第一阶段完成时，应满足：

1. 所有需求默认进入 `review` 模式。
2. 未人工批准前没有任何执行副作用。
3. 控制台能展示需求、调研、范围、风险与测试计划。
4. 人工能批准、驳回、要求补充。
5. 批准后能排期自动执行。
6. 执行结果和 PR 链接回显。
7. 全链路审计完整。
8. 契约测试、插件测试、控制台测试、端到端测试通过。
9. 文档覆盖架构、流程、API、数据模型与部署。
10. 架构质量约束逐项验收通过：
    - 高可用：控制台重启、插件重启、事件重放、网络失败均有确定行为。
    - 易维护：契约、迁移、模块边界和配置边界清晰。
    - 单一职责：插件、server、web 的职责没有交叉。
    - 人类可读：状态、错误、时间、trace 和审计能被新人直接理解。
