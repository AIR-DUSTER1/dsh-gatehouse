import type {
  ProposalRecord, ReviewCaseRecord, ReviewDecisionRecord, ApprovalGrantRecord, ScheduleRecord,
} from '@gatehouse/contract';
import type { Database } from './db/database.js';
import type { ReviewRepository } from './repositories/review-repository.js';
import type { ProposalRepository } from './repositories/proposal-repository.js';
import type { DecisionRepository } from './repositories/decision-repository.js';
import type { GrantRepository } from './repositories/grant-repository.js';
import type { ScheduleRepository } from './repositories/schedule-repository.js';
import type { UserRepository } from './repositories/user-repository.js';
import type { SettingsRepository } from './repositories/settings-repository.js';
import type { AuditService } from './audit/audit-service.js';
import { hashPassword } from './auth.js';
import { newId, sha256 } from './domain/utils.js';

interface SeedContext {
  db: Database;
  cases: ReviewRepository;
  proposals: ProposalRepository;
  decisions: DecisionRepository;
  grants: GrantRepository;
  schedules: ScheduleRepository;
  users: UserRepository;
  settings: SettingsRepository;
  audit: AuditService;
}

function isoOffset(base: Date, days: number, hours = 0): string {
  return new Date(base.getTime() + days * 86_400_000 + hours * 3_600_000).toISOString();
}

function hash(value: unknown): string { return sha256(JSON.stringify(value)); }

/** Inserts a coherent demo dataset once. Safe to call at every boot. */
export function seedDemoData(context: SeedContext): void {
  if (context.users.list().length > 0) return;
  const base = new Date();
  const users = [
    { id: 'user_li', email: 'li@example.com', name: '演示复核人', role: 'reviewer' as const },
    { id: 'user_he', email: 'he@example.com', name: '何雨', role: 'reviewer' as const },
    { id: 'user_wang', email: 'wang@example.com', name: '演示只读成员', role: 'viewer' as const },
    { id: 'user_zhao', email: 'zhao@example.com', name: '演示管理员', role: 'admin' as const },
  ];
  for (const user of users) context.users.create({ ...user, password_hash: hashPassword('demo123') });
  context.settings.set('max_concurrency', '2', base.toISOString());

  const rows: Array<{
    reviewCase: ReviewCaseRecord;
    proposal: ProposalRecord;
    decision?: Omit<ReviewDecisionRecord, 'id'> & { key: string };
    grant?: Omit<ApprovalGrantRecord, 'id'>;
    schedule?: Omit<ScheduleRecord, 'id'>;
    action?: string;
  }> = [];

  const add = (
    id: string,
    title: string,
    requester: string,
    source: 'feishu' | 'github',
    requirement: string,
    risk: ReviewCaseRecord['risk_level'],
    status: ReviewCaseRecord['status'],
    summary: string,
    scope: string[],
    ruleHits: string[],
    impactFiles: string[],
    testPlan: string[],
    daysAgo: number,
    options: { decision?: { decision: ReviewDecisionRecord['decision']; reviewer: string; comment: string }; schedule?: { status: ScheduleRecord['status']; at: string; pr?: string | null; synced?: boolean } } = {},
  ) => {
    const createdAt = isoOffset(base, -daysAgo, 2);
    const updatedAt = isoOffset(base, -Math.max(0, daysAgo - 1), 5);
    const reviewCase: ReviewCaseRecord = {
      id: `case_${id}`, plugin_case_id: `plugin_${id}`, source, requester, title,
      requirement_text: requirement, requirement_hash: hash(requirement), status, risk_level: risk,
      source_context: source === 'feishu' ? '飞书群「研发协作」中的明确需求' : 'GitHub Issue #184',
      message_url: source === 'feishu' ? 'https://example.feishu.cn/messages/demo' : 'https://github.com/example/repo/issues/184',
      created_at: createdAt, updated_at: updatedAt,
    };
    const proposal: ProposalRecord = {
      id: `proposal_${id}`, review_case_id: reviewCase.id, assessment_revision: 1, summary,
      scope, scope_hash: hash(scope), rule_hits: ruleHits, impact_files: impactFiles,
      test_plan: testPlan, estimated_cost: risk === 'high' ? '约 4-6 小时' : '约 2-3 小时',
      risk, risk_reason: risk === 'high' ? '涉及跨模块契约和权限边界，需要重点回归。' : '改动范围可控，需覆盖核心交互与异常分支。',
      status, created_at: createdAt, updated_at: updatedAt,
    };
    const row: (typeof rows)[number] = { reviewCase, proposal };
    if (options.decision) {
      row.decision = {
        proposal_id: proposal.id, decision: options.decision.decision,
        reviewer: options.decision.reviewer, comment: options.decision.comment,
        created_at: isoOffset(base, -Math.max(0, daysAgo - 0.25), 2), key: `demo-${id}`,
      };
    }
    if (options.schedule) {
      const scheduleAt = options.schedule.at;
      row.grant = {
        proposal_id: proposal.id, reviewer: options.decision?.reviewer ?? '演示复核人',
        requirement_hash: reviewCase.requirement_hash, scope_hash: proposal.scope_hash,
        approved_at: updatedAt, schedule_at: scheduleAt, expires_at: isoOffset(base, 3, 8),
        consumed_at: options.schedule.status === 'completed' ? updatedAt : null,
        status: options.schedule.status === 'completed' ? 'consumed' : 'active',
      };
      row.schedule = {
        proposal_id: proposal.id, grant_id: '', schedule_at: scheduleAt,
        expires_at: row.grant.expires_at, status: options.schedule.status,
        approval_synced_at: options.schedule.synced === false ? null : updatedAt,
        attempts: ['completed', 'failed', 'executing'].includes(options.schedule.status) ? 1 : 0,
        max_attempts: 5, last_error: options.schedule.status === 'failed' ? 'dsh-superagent 执行超时，已完成最大重试次数。' : null,
        execution_id: ['completed', 'failed', 'executing'].includes(options.schedule.status) ? `execution_${id}` : null,
        pr_url: options.schedule.pr ?? null, created_at: updatedAt, updated_at: updatedAt,
      };
    }
    rows.push(row);
  };

  add('hse_export', '统一 HSE 隐患导出模板', '陈晓', 'feishu',
    '导出隐患台账时需要和列表字段保持一致，并支持按项目、状态、时间范围筛选。',
    'high', 'pending_review', '统一 HSE 隐患导出的字段映射、筛选参数和 Blob 下载契约。',
    ['对齐隐患列表筛选契约', '实现导出接口与前端下载反馈', '补充导出权限与空数据测试'],
    ['touches-api', 'cross-module', 'permission'], ['vessel-web/src/views/hse-status/index.vue', 'vessel-web/src/api/hse.ts'],
    ['筛选条件组合测试', '10,000 行导出性能验证', '无权限与空数据提示'], 0);

  add('calendar_month', '修复排班日历跨月丢事件', '何雨', 'github',
    '排班日历切换跨月时，部分倒班事件不会显示，需要排查日期边界。',
    'medium', 'pending_review', '修复跨月日期区间计算，并补充月末与闰年边界测试。',
    ['修正月份区间计算', '补充跨月缓存刷新', '增加边界单测'],
    ['touches-core', 'date-boundary'], ['dsh-superagent/src/calendar/range.ts'],
    ['月末跨月测试', '闰年二月测试', '时区一致性测试'], 1);

  add('weekly_report', '新增项目周报自动汇总', '刘洋', 'feishu',
    '每周五自动汇总各项目进展、风险和下周计划，并发送到项目群。',
    'low', 'info_requested', '基于项目活动数据生成周报模板，通过飞书机器人定时发送。',
    ['定义周报模板', '聚合项目活动数据', '接入飞书定时发送'],
    ['touches-integration'], ['docs/weekly-report-template.md'],
    ['模板快照测试', '飞书发送失败重试测试'], 2,
    { decision: { decision: 'request_info', reviewer: '演示复核人', comment: '需要补充目标项目清单和周报负责人。' } });

  add('dependency_alert', '升级依赖并修复安全告警', '演示只读成员', 'github',
    '升级存在高危漏洞的依赖，并确认没有破坏现有构建。',
    'high', 'rejected', '升级锁定依赖版本并处理兼容性告警。',
    ['升级主依赖', '修复编译兼容问题', '执行全量构建'],
    ['risk-high', 'dependency'], ['package.json', 'pnpm-lock.yaml'],
    ['全量构建', '关键页面回归'], 3,
    { decision: { decision: 'reject', reviewer: '演示复核人', comment: '版本跨度大且发布窗口临近，本迭代暂缓。' } });

  add('kanban_filter', '新增排期看板筛选', '陈晓', 'feishu',
    '看板需要支持按负责人、风险和来源筛选，筛选状态需要在刷新后保留。',
    'medium', 'scheduled', '增加排期看板组合筛选与 URL 状态同步。',
    ['新增筛选参数', '同步 URL query', '增加重置与空状态'],
    ['frontend', 'touches-ui'], ['console-web/src/pages/Schedule.tsx'],
    ['筛选组合测试', '刷新状态保持测试'], 2,
    { decision: { decision: 'approve', reviewer: '演示复核人', comment: '范围和验收标准明确，可以进入排期。' },
      schedule: { status: 'scheduled', at: isoOffset(base, 0, 6), synced: true } });

  add('receipt_dedup', '修复审批回执重复发送', '刘洋', 'github',
    '审批完成后偶尔收到两条飞书回执，需要基于事件 ID 做幂等。',
    'low', 'completed', '为审批回执增加事件幂等键和已发送状态。',
    ['增加回执幂等表', '补充重试逻辑', '增加重复事件测试'],
    ['idempotency'], ['dsh-superagent/src/receipt.ts'],
    ['重复事件测试', '网络重试测试'], 5,
    { decision: { decision: 'approve', reviewer: '演示复核人', comment: '问题明确，按幂等方案修复。' },
      schedule: { status: 'completed', at: isoOffset(base, -2, 4), pr: 'https://github.com/example/repo/pull/328' } });

  add('mobile_audit', '补充移动端审计详情', '陈晓', 'feishu',
    '移动端审计列表点开后信息缺失，需要补齐执行时间、操作者和错误详情。',
    'high', 'failed', '补充移动端审计详情抽屉和失败信息展示。',
    ['实现详情抽屉', '加载审计明细', '展示错误与复制能力'],
    ['frontend', 'risk-high'], ['console-web/src/pages/Audit.tsx'],
    ['移动端视口测试', '长文本换行测试', '复制能力测试'], 4,
    { decision: { decision: 'approve', reviewer: '何雨', comment: '同意补充移动端详情。' },
      schedule: { status: 'failed', at: isoOffset(base, -1, 5) } });

  add('approval_search', '优化审批搜索性能', '何雨', 'github',
    '大量历史审批下搜索响应超过 3 秒，需要增加组合索引和分页缓存。',
    'medium', 'executing', '优化审批查询索引，并增加慢查询指标。',
    ['分析查询计划', '增加组合索引', '增加慢查询日志'],
    ['database', 'performance'], ['console-server/src/db/migrations/002_indexes.sql'],
    ['100k 数据查询测试', '索引回滚验证'], 3,
    { decision: { decision: 'approve', reviewer: '演示复核人', comment: '性能数据充分，批准执行。' },
      schedule: { status: 'executing', at: isoOffset(base, 0, -1), synced: true } });

  for (const row of rows) {
    context.cases.create(row.reviewCase);
    context.proposals.create(row.proposal);
    context.audit.record({
      entityType: 'review_case', entityId: row.reviewCase.id, action: 'proposal.created', actor: 'dsh-superagent',
      before: null, after: { proposal_id: row.proposal.id, summary: row.proposal.summary }, traceId: `seed-${row.reviewCase.id}`,
      at: row.proposal.created_at,
    });
    if (row.decision) {
      context.decisions.create({
        id: newId('decision'), proposal_id: row.decision.proposal_id, decision: row.decision.decision,
        reviewer: row.decision.reviewer, comment: row.decision.comment, created_at: row.decision.created_at,
        idempotency_key: row.decision.key, request_hash: hash(row.decision),
      });
      context.audit.record({
        entityType: 'review_case', entityId: row.reviewCase.id, action: 'decision.recorded', actor: row.decision.reviewer,
        before: { status: 'pending_review' }, after: { decision: row.decision.decision, comment: row.decision.comment },
        traceId: `seed-${row.reviewCase.id}`, at: row.decision.created_at,
      });
    }
    if (row.grant) {
      const grantId = newId('grant');
      context.grants.create({ ...row.grant, id: grantId });
      if (row.schedule) {
        const scheduleId = newId('schedule');
        context.schedules.create({ ...row.schedule, id: scheduleId, grant_id: grantId });
        context.audit.record({
          entityType: 'review_case', entityId: row.reviewCase.id, action: 'schedule.created', actor: row.decision?.reviewer ?? 'system',
          before: null, after: { schedule_at: row.schedule.schedule_at, status: row.schedule.status },
          traceId: `seed-${row.reviewCase.id}`, at: row.reviewCase.updated_at,
        });
        if (row.schedule.status === 'completed') {
          context.audit.record({
            entityType: 'review_case', entityId: row.reviewCase.id, action: 'execution.finished', actor: 'dsh-superagent',
            before: { status: 'executing' }, after: { status: 'completed', pr_url: row.schedule.pr_url },
            traceId: `seed-${row.reviewCase.id}`, at: row.reviewCase.updated_at,
          });
        }
      }
    }
  }
}
