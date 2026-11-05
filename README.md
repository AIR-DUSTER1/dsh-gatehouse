# Gatehouse

Gatehouse 是 `DSH Superagent Review` 的人工复核与交付控制台。Agent 的评估结果先进入人工复核，确认范围和排期后才生成一次性执行授权；Gatehouse 负责展示执行回执、PR 交付与全链路审计。

## 主要能力

- **人工复核**：查看需求、影响范围、风险评估和测试计划，完成批准、驳回或要求补充信息。
- **审批与排期**：批准后生成一次性授权，支持排期、改期、撤回、暂停、恢复和失败重试。
- **多工作区隔离**：任务、仓库、成员、排期和审计按工作区隔离，避免跨仓库混单。
- **执行与交付**：展示执行状态、PR 链接和失败原因，不直接操作 Git 或代替执行侧创建 PR。
- **全局统计**：集中查看跨工作区的任务、交付和工作区运行情况。
- **用户与角色**：一次性邀请、账号启停、自定义角色和权限矩阵。

## 快速开始

要求 Node.js >= 22 和 pnpm 12.5.1。

```powershell
pnpm install
Copy-Item .env.example .env
# 修改 .env 中的 BOOTSTRAP_ADMIN_* 配置
pnpm dev
```

启动后访问：

- Web：<http://127.0.0.1:5173>
- API：<http://127.0.0.1:8787>
- 健康检查：<http://127.0.0.1:8787/health>
- 就绪检查：<http://127.0.0.1:8787/ready>

空数据库首次启动时只创建 `.env` 中显式配置的初始管理员，管理员密码至少 12 位。`PLUGIN_MODE=mock` 仅用于本地开发和自动化测试；生产环境应使用 `PLUGIN_MODE=http` 并配置执行器地址与共享密钥。

## 接入工作区与仓库

1. 进入“工作区与仓库”，填写 Provider、仓库标识、访问地址和凭据引用。
2. Gatehouse 请求 DSH 完成只读连通性检查，并生成仓库描述建议。
3. 管理员确认描述后，Gatehouse 保存版本并同步给 DSH。
4. 后续任务通过 `/w/:workspaceId/...` 进入对应工作区。

凭据字段只接受 `env:NAME` 或 `file:PATH` 引用，不保存明文 Token。Git Push 和 PR 交付使用 DSH 运行账户已有的 Git 凭据。私仓环境需要配置主机允许列表：

```dotenv
REPOSITORY_HOST_ALLOWLIST=github.com,git.internal.example
ALLOW_PRIVATE_REPOSITORY_HOSTS=true
```

当前稳定支持 GitHub / GitHub Enterprise 多仓库事件轮询。GitLab、Gitea、Bitbucket 和通用 Git 仓库可作为执行目标接入；未实现的 Provider 原生轮询能力不会伪装为已支持。

## 文档

- [架构说明](docs/architecture.md)
- [审批流程](docs/approval-flow.md)
- [插件集成](docs/plugin-integration.md)
- [数据模型](docs/data-model.md)
- [验收清单](docs/acceptance-checklist.md)

## 相关仓库

- [Gatehouse](https://github.com/AIR-DUSTER1/dsh-gatehouse)：人工复核、审批、排期、交付投影与审计控制台。
- [DSH Superagent Review](https://github.com/AIR-DUSTER1/dsh-superagent-review)：需求评估、Proposal、Grant 校验、Worker 执行与 PR 交付。

DSH Superagent Review 来源于开源项目 **dsh-superagent**：

<https://github.com/deepseek-ai/dsh-superagent-prototype>
