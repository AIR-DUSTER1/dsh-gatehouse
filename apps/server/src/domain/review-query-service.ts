import type {
  AuditEventRecord,
  DashboardStatistics,
  ProposalRecord,
  ReviewCaseDetail,
  ReviewQueueItem,
  RiskLevel,
  ScheduleListItem,
} from '@gatehouse/contract';
import type { ReviewRepository, CaseQuery } from '../repositories/review-repository.js';
import type { ProposalRepository } from '../repositories/proposal-repository.js';
import type { DecisionRepository } from '../repositories/decision-repository.js';
import type { GrantRepository } from '../repositories/grant-repository.js';
import type { ScheduleRepository } from '../repositories/schedule-repository.js';
import type { AuditRepository, AuditQuery } from '../repositories/audit-repository.js';
import type { AnalyticsRepository } from '../repositories/analytics-repository.js';
import { NotFoundError } from '../domain/errors.js';

/** Read-side use case for queue, detail, schedule, audit and dashboard projections. */
export class ReviewQueryService {
  constructor(
    private readonly cases: ReviewRepository,
    private readonly proposals: ProposalRepository,
    private readonly decisions: DecisionRepository,
    private readonly grants: GrantRepository,
    private readonly schedules: ScheduleRepository,
    private readonly audit: AuditRepository,
    private readonly analytics: AnalyticsRepository,
  ) {}

  listCases(query: CaseQuery): { items: ReviewQueueItem[]; total: number } {
    return this.cases.list(query);
  }

  getCaseDetail(caseId: string): ReviewCaseDetail {
    const reviewCase = this.cases.get(caseId);
    if (!reviewCase) throw new NotFoundError('复核需求', caseId);
    const proposals = this.proposals.listForCase(caseId);
    const latest = proposals[0];
    const decisions = latest ? this.decisions.listForProposal(latest.id) : [];
    const grant = latest ? this.grants.getByProposal(latest.id) : null;
    const schedule = latest ? this.schedules.getByProposal(latest.id) : null;
    const auditEvents = this.audit.forEntity('review_case', caseId);
    return {
      review_case: reviewCase,
      proposals,
      decisions,
      grant,
      schedule,
      audit_events: this.sortAudit(auditEvents),
    };
  }

  getProposalDetail(proposalId: string): {
    proposal: ProposalRecord;
    decisions: ReturnType<DecisionRepository['listForProposal']>;
    grant: ReturnType<GrantRepository['getByProposal']>;
    schedule: ReturnType<ScheduleRepository['getByProposal']>;
  } {
    const proposal = this.proposals.get(proposalId);
    if (!proposal) throw new NotFoundError('提案', proposalId);
    return {
      proposal,
      decisions: this.decisions.listForProposal(proposalId),
      grant: this.grants.getByProposal(proposalId),
      schedule: this.schedules.getByProposal(proposalId),
    };
  }

  listSchedules(): ScheduleListItem[] {
    return this.schedules.list();
  }

  listAudit(query: AuditQuery): { items: AuditEventRecord[]; total: number } {
    return this.audit.list(query);
  }

  dashboard(): DashboardStatistics {
    const all = this.cases.list({ page: 1, pageSize: 10000 }).items;
    const schedules = this.schedules.list();
    const riskDistribution: Record<RiskLevel, number> = { low: 0, medium: 0, high: 0, critical: 0 };
    for (const item of all) riskDistribution[item.risk_level] += 1;
    const ruleCounts = new Map<string, number>();
    for (const item of all) for (const rule of item.rule_hits) ruleCounts.set(rule, (ruleCounts.get(rule) ?? 0) + 1);
    const completed = schedules.filter((item) => item.status === 'completed').length;
    const failed = schedules.filter((item) => item.status === 'failed').length;
    const finished = completed + failed;
    const metrics = this.analytics.reviewMetrics();
    return {
      total_cases: all.length,
      pending_review: all.filter((item) => item.status === 'pending_review').length,
      high_risk: all.filter((item) => item.risk_level === 'high' || item.risk_level === 'critical').length,
      average_review_minutes: metrics.averageMinutes,
      execution_success_rate: finished === 0 ? 0 : Math.round((completed / finished) * 1000) / 10,
      approved_sla_rate: metrics.slaRate,
      risk_distribution: riskDistribution,
      rule_hits: [...ruleCounts.entries()].map(([rule, count]) => ({ rule, count })).sort((a, b) => b.count - a.count).slice(0, 6),
      recent_activity: this.audit.recent(8),
    };
  }

  private sortAudit(events: AuditEventRecord[]): AuditEventRecord[] {
    return [...events].sort((a, b) => a.created_at.localeCompare(b.created_at));
  }
}
