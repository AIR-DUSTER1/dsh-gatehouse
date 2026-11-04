# Gatehouse

人工复核、排期与执行控制台，用于承接 `dsh-superagent` 的调研提案，并在人工批准后按排期触发执行与交付回执。

## 职责边界

```text
飞书 / GitHub
  → dsh-superagent：接收需求、只读调研、生成 Proposal
  → Console：接单、人工复核、版本绑定、排期、审计
  → dsh-superagent：到点执行、创建 PR、发送飞书回执
  → Console：投影执行结果，展示 PR 与全链路审计
```

- `dsh-superagent` 不自行决定审批结果，也不会在人工批准前产生执行副作用。
- Console 不操作 Git、不创建 worktree、不直接创建 PR。
- 批准与执行通过 `ApprovalGrant` 绑定 `requirement_hash`、`scope_hash` 和过期时间。

## 本地运行

要求 Node.js >= 22（使用内置 `node:sqlite`）与 pnpm 12。

```powershell
pnpm install
Copy-Item .env.example .env
# 修改 .env 中的三个 BOOTSTRAP_ADMIN_* 变量
pnpm dev
```

- Web：http://127.0.0.1:5173
- API：http://127.0.0.1:8787
- 健康检查：http://127.0.0.1:8787/health
- 就绪检查：http://127.0.0.1:8787/ready

空数据库首次启动时只创建 `.env` 中显式配置的初始管理员，不写入任何需求、提案、排期或演示账号。管理员密码至少 12 位；后续账号接入外部的成员管理流程。

`PLUGIN_MODE=mock` 仅用于自动化测试和本地开发，会产生模拟执行结果。生产环境必须使用 `PLUGIN_MODE=http` 并配置 `dsh-superagent` 地址与共享密钥。

## 多工作区与仓库

Gatehouse 是工作区和仓库配置的控制面，DSH Superagent Review 执行实际连接与轮询。

1. 管理员进入“工作区与仓库”，新建工作区并填写 Provider、仓库标识、API/Web/克隆地址与凭据引用。
2. Gatehouse 调用 DSH 做只读连通性和权限检查，并读取仓库元数据与 README。
3. DSH 使用当前配置且位于允许列表中的模型生成仓库描述建议。
4. 管理员确认描述后，Gatehouse 保存版本和哈希，吊销旧工作区绑定授权，并同步给 DSH。
5. 后续任务通过 URL 中的 `/w/:workspaceId/...` 隔离展示；全局统计在 `/analytics` 汇总。

凭据字段只接受 `env:NAME` 或 `file:PATH` 引用，用于 Gatehouse 触发 DSH 的只读仓库发现；实际 Git Push/PR 仍使用 DSH 运行账户已配置的 CLI/Git 凭据，不保存明文 Token。首版不宣传未实现的 `system:` 凭据解析。生产环境应设置：

```dotenv
REPOSITORY_HOST_ALLOWLIST=github.com,git.internal.example
ALLOW_PRIVATE_REPOSITORY_HOSTS=true
```

首个稳定版本完整支持 GitHub 多仓库事件轮询；GitHub Enterprise 使用同一机制时，需要 `gh` CLI 已登录对应主机，并把该主机加入允许列表。GitLab、Gitea、Bitbucket 和裸 Git 可作为通用执行 Target 接入（校验、描述、路由与 Git 交付），但本版本不伪装其原生 Issue/MR 事件轮询能力；任务来源应使用飞书、Webhook 或人工录入。自定义 CA 文件解析与 `system:` 凭据存储属于后续能力，本版本会在校验阶段明确拒绝，而不是静默忽略。

## 常用命令

```powershell
pnpm hooks:install  # 安装本地 commit-msg 校验钩子
pnpm test          # 契约 + 服务端 + Web 测试
pnpm typecheck     # 全工作区类型检查
pnpm build         # 服务端类型检查 + Web 生产构建
pnpm browser:smoke # 需先启动 pnpm dev，并设置 BROWSER_TEST_EMAIL / BROWSER_TEST_PASSWORD
pnpm commit:check  # 校验当前 HEAD 的提交信息
```

## 核心实现

- Fastify v1 API + React 19 + Ant Design 6 企业控制台。
- 页面级懒加载与按依赖拆分产物，便于后续按模块扩展。
- SQLite 持久化，仓库层集中 SQL。
- HMAC-SHA256 插件事件签名、时间戳窗口和 nonce 防重放。
- 审批决策与插件调用通过 transactional outbox 解耦。
- 调度器每次从 SQLite 读取到期任务，支持重启恢复、暂停/恢复、改期、撤回与最大并发。
- 改期会更新执行侧 Grant；撤回会吊销 Grant，并把需求退回待复核。
- ApprovalGrant 一次性消费；需求或范围哈希变化会使旧批准失效。
- Gatehouse 与执行侧共用同一 canonical Grant ID；执行同步失败时可安全复用原 execution_id 重试。
- 审计表 append-only，由 SQLite 触发器阻止更新和删除。
- 工作区、仓库、成员和工作区绑定哈希均由服务端校验，所有任务、排期和审计查询都强制携带 `workspace_id`。
- 仓库描述版本化；描述或工作区绑定变化会使旧 Grant 失效并要求重新复核。
- 全局统计与工作区明细复用同一组参数化 SQL，并有合计对账测试。

详细文档见 [架构说明](docs/architecture.md)、[审批流程](docs/approval-flow.md)、[插件集成](docs/plugin-integration.md)、[数据模型](docs/data-model.md) 和 [验收清单](docs/acceptance-checklist.md)。

## 协作与提交规范

仓库的统一协作、架构边界、测试要求和安全规则见 [AGENTS.md](AGENTS.md)。所有提交必须使用 Conventional Commits：

```text
<type>(<scope>)!: <subject>
```

例如 `feat(web): add schedule conflict warning`、`fix(server): reject expired approval grant`、`docs: explain plugin retry policy`。允许的 type 包括 `feat`、`fix`、`refactor`、`perf`、`test`、`docs`、`style`、`build`、`ci`、`chore`、`revert` 和 `merge`；subject 使用祈使语气，不超过 72 个字符。

执行 `pnpm hooks:install` 后，本地 `commit-msg` 钩子会拒绝不合规提交；GitHub Pull Request 的 `Commit message` workflow 会校验相对 base 分支的全部提交。hooks 由 `pnpm install` 的 `prepare` 自动安装。

## 与 dsh-superagent 联调

1. 在 `dsh-superagent` 的 Eval 设置中选择 `review`。
2. 配置 `consoleUrl`、`consoleEventSecret`、`consoleSharedSecret`。
3. 在 Gatehouse `.env` 中设置 `PLUGIN_MODE=http`、相同的 `PLUGIN_BASE_URL`、`PLUGIN_EVENT_SECRET` 和 `PLUGIN_SHARED_SECRET`。
4. 两侧分别启动后，dsh-superagent 会将 Proposal 回传 Gatehouse；批准后 Gatehouse 发送一次性 Grant，到期再触发执行。
5. 执行完成后由 dsh-superagent 回传 `execution.finished` 或 `execution.failed`，Gatehouse 不根据 HTTP 接受响应直接判定完成。

真实执行命令契约见 [plugin-integration.md](docs/plugin-integration.md)。

## 相关仓库

- **Gatehouse**（当前仓库）：人工复核、审批、排期、执行投影与审计控制台。  
  `https://github.com/AIR-DUSTER1/dsh-gatehouse`
- **DSH Superagent Review**：与 Gatehouse 配套的执行侧独立发行版，负责需求评估、Proposal、Grant 校验、Worker 执行与 PR 交付。  
  `https://github.com/AIR-DUSTER1/dsh-superagent-review`

DSH Superagent Review 来源于开源项目 **dsh-superagent**：  
[https://github.com/deepseek-ai/dsh-superagent-prototype](https://github.com/deepseek-ai/dsh-superagent-prototype)

