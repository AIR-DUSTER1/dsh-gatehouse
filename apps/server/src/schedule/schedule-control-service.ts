import type { User } from '@gatehouse/contract';
import type { ScheduleRepository } from '../repositories/schedule-repository.js';
import type { AuditService } from '../audit/audit-service.js';
import type { ReviewRepository } from '../repositories/review-repository.js';
import type { ProposalRepository } from '../repositories/proposal-repository.js';
import { DomainError, NotFoundError } from '../domain/errors.js';
import { requireRole } from '../auth.js';
import { nowIso } from '../domain/utils.js';

/** Manual schedule lifecycle actions. Approval correctness is checked by the scheduler. */
export class ScheduleControlService {
  constructor(
    private readonly schedules: ScheduleRepository,
    private readonly proposals: ProposalRepository,
    private readonly cases: ReviewRepository,
    private readonly audit: AuditService,
  ) {}

  pause(scheduleId: string, user: User, traceId: string, now = new Date()): void {
    requireRole(user, ['reviewer', 'admin']);
    const schedule = this.schedules.get(scheduleId);
    if (!schedule) throw new NotFoundError('排期', scheduleId);
    if (schedule.status !== 'scheduled') throw new DomainError('SCHEDULE_NOT_PAUSABLE', '只有待执行排期可以暂停', '刷新排期状态后重试', 409);
    const at = nowIso(now);
    this.schedules.setStatus(schedule.id, 'paused', at);
    this.record(schedule.proposal_id, user, traceId, 'schedule.paused', 'paused', at);
  }

  resume(scheduleId: string, user: User, traceId: string, now = new Date()): void {
    requireRole(user, ['reviewer', 'admin']);
    const schedule = this.schedules.get(scheduleId);
    if (!schedule) throw new NotFoundError('排期', scheduleId);
    if (schedule.status !== 'paused') throw new DomainError('SCHEDULE_NOT_RESUMABLE', '只有已暂停排期可以恢复', '刷新排期状态后重试', 409);
    if (Date.parse(schedule.expires_at) <= now.getTime()) throw new DomainError('GRANT_EXPIRED', '审批授权已过期，不能恢复', '重新发起审批', 409);
    const at = nowIso(now);
    this.schedules.setStatus(schedule.id, 'scheduled', at);
    this.record(schedule.proposal_id, user, traceId, 'schedule.resumed', 'scheduled', at);
  }

  private record(proposalId: string, user: User, traceId: string, action: string, status: string, at: string): void {
    const proposal = this.proposals.get(proposalId);
    const reviewCase = proposal ? this.cases.get(proposal.review_case_id) : null;
    if (!reviewCase) return;
    this.audit.record({
      entityType: 'review_case', entityId: reviewCase.id, action, actor: user.name,
      before: null, after: { status }, traceId, at,
    });
  }
}
