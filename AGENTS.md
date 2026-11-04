# Gatehouse 仓库协作规范

本文件适用于整个仓库，是所有 agent、贡献者和维护者的协作约定。修改代码、测试、提交或发布前都必须先阅读并遵守。若用户当前明确指令与本文件冲突，以用户指令为准，但不得绕过安全边界。

## 1. 仓库职责

Gatehouse 是独立的人工复核与执行控制台，负责承接 DSH Superagent Review 生成的 Proposal，完成人工复核、版本绑定、排期、审批、执行触发和审计投影。

```text
飞书 / GitHub
  → DSH Superagent Review：需求接收、只读评估、生成 Proposal
  → Gatehouse：人工复核、审批、排期、发送一次性 Grant
  → DSH Superagent Review：按 Grant 执行、创建 Ticket / Worker、交付 PR
  → Gatehouse：投影执行结果、展示 PR 和全链路审计
```

### 不可破坏的边界

1. Gatehouse 不直接操作 Git，不创建 worktree，不代替执行侧创建或合并 PR。
2. 人工批准前，执行侧不得创建 Ticket、worktree 或产生任何业务副作用。
3. 审批必须绑定 `requirement_hash`、`scope_hash` 和过期时间；哈希变化后旧批准立即失效。
4. ApprovalGrant 只能原子消费一次，重放或重复执行必须被拒绝。
5. 插件请求必须校验 HMAC、时间戳、nonce 和 idempotency key；密钥不得写入日志、数据库明文字段或提交记录。
6. 审计表必须保持 append-only，任何业务更新或删除都不得绕过审计约束。
7. 审批决策与插件调用通过 transactional outbox 解耦，不能在数据库事务中执行外部网络副作用。

## 2. 技术栈与目录

- Node.js >= 22（使用内置 `node:sqlite`）
- pnpm 12.5.1；不要使用 npm 或 yarn
- TypeScript strict 模式
- 服务端：Fastify + SQLite
- Web：React 19 + Vite + Ant Design 6

```text
apps/server/src/       Fastify API、领域服务、SQLite 仓储、调度器、插件适配器
apps/server/tests/     服务端单元与集成测试
apps/web/src/          React 控制台、页面、组件、API 客户端和样式
apps/web/tests/        Web 单元测试
packages/contract/src/ 前后端共享协议、Zod schema、签名与事件类型
scripts/               本地工具、浏览器冒烟和提交信息校验
docs/                  已落地的架构、审批、插件集成、数据模型和验收文档
plans/                 本地开发计划文档，仅保存在开发机，不纳入 Git
data/                  本地 SQLite 数据，已被 .gitignore 忽略
```

新增模块时优先保持现有分层：HTTP/路由只负责协议转换，业务规则进入 domain/service，SQL 集中在数据访问层，前后端协议进入 `packages/contract`。

## 3. 本地准备

```powershell
pnpm install
Copy-Item .env.example .env
pnpm hooks:install
pnpm dev
```

`pnpm install` 会自动执行 `prepare` 安装本地 Git hooks；如果 hooks 未生效，手动执行 `pnpm hooks:install`。不要使用 `--no-verify` 绕过提交校验。

常用验证命令：

```powershell
pnpm test          # contract + server + web 测试
pnpm typecheck     # 全工作区 TypeScript 检查
pnpm build         # 服务端类型检查 + Web 生产构建
pnpm browser:smoke # 需先启动 pnpm dev，并使用本机 Chrome
pnpm commit:check  # 校验当前 HEAD 的提交信息
```

## 4. 实现约定

### TypeScript 与服务端

- 保持 `strict`、`noUncheckedIndexedAccess` 和 `exactOptionalPropertyTypes` 通过；不要用 `any` 逃避类型检查。
- 外部输入必须在边界用 Zod 或等价 schema 校验，不信任 HTTP body、query、header 或插件事件。
- 领域规则放在领域服务中；路由、调度器和适配器不能各自复制审批、哈希、幂等或权限判断。
- 数据库写入需要事务时使用事务边界；外部插件调用不得包裹在数据库事务内。
- 错误响应不得泄露密钥、token、内部堆栈或完整 SQL。
- 新增或修改插件事件时同步更新 contract、签名测试和 `docs/plugin-integration.md`。

### Web

- 使用 React 19、Ant Design 6 和现有共享组件，不引入与现有设计系统冲突的 UI 库。
- 页面采用现有布局、颜色、间距、状态展示和响应式模式；不要加入无业务意义的装饰或“AI 风格”大面积渐变、玻璃拟态和营销文案。
- 异步操作必须有 loading、empty、error 和成功反馈；审批、排期、执行等高风险操作要有明确确认和可读结果。
- 权限控制不能只依赖前端隐藏按钮；服务端必须再次校验。
- 新页面优先复用 `AppShell`、通用 UI 组件和 contract 类型，并按项目现有方式做页面级懒加载。

### 计划文档

- 后续开发、实施、重构和迁移计划统一写入仓库根目录的 `plans/`。
- `plans/` 已被 `.gitignore` 排除，计划文档不得提交、推送或复制到 `docs/`。
- `docs/` 只保留已落地、可供交付和运维使用的正式文档。

### 数据与安全

- 不在仓库提交 `.env`、密钥、真实 token、演示数据库、上传文件或测试产生的数据。
- 不通过字符串拼接构造 SQL；参数化查询优先。
- 不修改历史审计记录；需要纠错时追加新的审计事件。
- 涉及权限、签名、Grant、幂等、并发调度或审计的修改必须补充回归测试。

## 5. 测试与完成标准

任何行为变更至少满足：

1. 有对应的单元、契约或集成测试；修复 bug 时先补能复现问题的测试。
2. `pnpm test`、`pnpm typecheck` 和 `pnpm build` 全部通过。
3. UI 变更在桌面和窄屏下检查，必要时执行 `pnpm browser:smoke`，确认无 console error、page error 和失败请求。
4. 不留下临时测试数据、调试日志、跳过测试或未处理警告。
5. 同步更新受影响的 README、AGENTS.md 或 `docs/` 文档。
6. 提交信息符合下面的 Git 规范，并确保最终 diff 只包含本次任务相关内容。

> 平台限制导致的测试无法执行时，必须在交付说明中写清命令、失败环境和未覆盖风险，不能用“测试通过”掩盖未执行项。

## 6. Git 分支与提交规范

### 分支

- `main` 保持可运行、可构建、可审查。
- 功能分支：`feat/<short-slug>`
- 修复分支：`fix/<short-slug>`
- 文档/工程分支：`docs/<short-slug>`、`chore/<short-slug>`、`refactor/<short-slug>`
- 不直接在 `main` 上开发；不重写已推送的 `main` 历史，不对 `main` 执行 force push。

### Commit message

采用 Conventional Commits，格式为：

```text
<type>(<scope>)!: <subject>
```

`scope` 可省略；`!` 仅用于不兼容变更，并必须在正文 footer 中补充 `BREAKING CHANGE: ...`。

允许的 `type`：

| type | 用途 |
| --- | --- |
| `feat` | 新增用户可见能力 |
| `fix` | 修复缺陷 |
| `refactor` | 不改变行为的重构 |
| `perf` | 性能优化 |
| `test` | 测试相关 |
| `docs` | 文档 |
| `style` | 格式或样式整理，不改变逻辑 |
| `build` | 构建系统或依赖 |
| `ci` | CI/CD |
| `chore` | 维护工作 |
| `revert` | 回滚提交 |
| `merge` | 合并提交 |

推荐 `scope`：`contract`、`server`、`web`、`api`、`db`、`scheduler`、`plugin`、`auth`、`ui`、`docs`、`deps`、`ci`、`repo`。

示例：

```text
feat(web): add schedule conflict warning
fix(server): reject expired approval grant
refactor(scheduler): isolate due job selection
test(contract): cover signature replay
docs: explain plugin retry policy
chore(deps): bump fastify
```

硬性要求：

- subject 必须描述实际变更，使用祈使语气，长度不超过 72 个字符，不以句号结尾。
- header 总长度不超过 100 个字符；正文与 header 之间空一行。
- 一个 commit 只做一个可解释的逻辑变更；不要把无关格式化混入业务提交。
- 禁止 `WIP`、`update`、`fix bug`、`changes` 等空泛描述。
- 不把生成物、数据文件、密钥或临时调试文件加入提交。
- 不使用 `--no-verify`；不使用 `git commit --amend` 修改已推送提交；不在 `main` 上 force push。
- 发现提交信息错误时，优先追加符合规范的提交；尚未推送且由本人创建的提交可在确认影响范围后修正。

### 自动校验

- `.githooks/commit-msg` 调用 `scripts/validate-commit-message.mjs`，本地 commit 时立即拒绝不合规信息。
- `.github/workflows/commit-message.yml` 在 Pull Request 中校验相对 base 分支的全部提交。
- 安装或修复 hooks：`pnpm hooks:install`。
- 手动校验当前提交：`pnpm commit:check`。
- 手动校验范围：`node scripts/validate-commit-message.mjs --range origin/main..HEAD`。

## 7. 审查重点

涉及以下区域时，审查者必须额外检查：

- 审批：角色权限、本人审批限制、哈希绑定、过期时间、Grant 一次性消费。
- 插件：HMAC 算法、时间戳窗口、nonce 防重放、idempotency、重试与 outbox。
- 调度：到期边界、并发上限、暂停/恢复、重启恢复、重复触发。
- Web：高风险操作确认、错误态、窄屏可用性、权限隐藏与服务端校验一致性。
- 数据：append-only 审计、事务边界、迁移兼容性和测试数据清理。

## 8. 禁止事项

- 禁止把 Gatehouse 改造成 Git/PR 执行器，或让它在人工批准前触发执行。
- 禁止提交真实密钥、cookie、token、个人数据或生产数据库。
- 禁止为了让测试通过而删除测试、放宽断言、吞掉异常或引入未记录的安全绕过。
- 禁止绕过当前环境允许的模型列表和工具权限配置。
- 禁止擅自重置、清理或覆盖工作区中与当前任务无关的用户修改。

维护者应在完成实现、验证和文档同步后，再使用符合规范的提交信息提交并推送变更。