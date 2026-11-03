import type { ScheduleChangeInput, ScheduleWithdrawInput, User } from '@gatehouse/contract';
import type { Database } from '../db/database.js';
import { transaction } from '../db/database.js';
import type { ScheduleRepository } from '../repositories/schedule-repository.js';
import type { GrantRepository } from '../repositories/grant-repository.js';
import type { OutboxRepository } from '../repositories/outbox-repository.js';
import type { AuditService } from '../audit/audit-service.js';
import type { ReviewRepository } from '../repositories/review-repository.js';
import type { ProposalRepository } from '../repositories/proposal-repository.js';
import { DomainError, NotFoundError } from '../domain/errors.js';
import { requireRole } from '../auth.js';
import { newId, nowIso } from '../domain/utils.js';
import type { PluginScheduleRequest, PluginWithdrawRequest } from '../plugin/plugin-client.js';

/** Manual schedule lifecycle actions with durable plugin synchronization. */
export class ScheduleControlService {
  constructor(
    private readonly db: Database,
    private readonly schedules: ScheduleRepository,
    private readonly grants: GrantRepository,
    private readonly proposals: ProposalRepository,
    private readonly cases: ReviewRepository,
    private readonly outbox: OutboxRepository,
    private readonly audit: AuditService,
    private readonly pluginMaxAttempts: number,
  ) {}

  pause(scheduleId: string, user: User, traceId: string, now = new Date()): void {
    requireRole(user, ['reviewer', 'admin']);
    const schedule = this.requireControllable(scheduleId);
    if (schedule.status !== 'scheduled') throw new DomainError('SCHEDULE_NOT_PAUSABLE', '只有待执行排期可以暂停', '刷新排期状态后重试', 409);
    const at = nowIso(now);
    transaction(this.db, () => {
      this.schedules.setStatus(schedule.id, 'paused', at);
      this.record(schedule.proposal_id, user, traceId, 'schedule.paused', { status: schedule.status }, { status: 'paused' }, at);
    });
  }

  resume(scheduleId: string, user: User, traceId: string, now = new Date()): void {
    requireRole(user, ['reviewer', 'admin']);
    const schedule = this.requireControllable(scheduleId);
    if (schedule.status !== 'paused') throw new DomainError('SCHEDULE_NOT_RESUMABLE', '只有已暂停排期可以恢复', '刷新排期状态后重试', 409);
    if (Date.parse(schedule.expires_at) <= now.getTime()) throw new DomainError('GRANT_EXPIRED', '审批授权已过期，不能恢复', '重新发起审批', 409);
    const at = nowIso(now);
    transaction(this.db, () => {
      this.schedules.setStatus(schedule.id, 'scheduled', at);
      this.record(schedule.proposal_id, user, traceId, 'schedule.resumed', { status: schedule.status }, { status: 'scheduled' }, at);
    });
  }

  /** Change an active schedule and invalidate its plugin sync until the new Grant is delivered. */
  reschedule(scheduleId: string, input: ScheduleChangeInput, user: User, traceId: string, now = new Date()): void {
    requireRole(user, ['reviewer', 'admin']);
    const schedule = this.requireControllable(scheduleId);
    if (!['scheduled', 'paused'].includes(schedule.status)) {
      throw new DomainError('SCHEDULE_NOT_EDITABLE', '只有待执行或已暂停的排期可以修改', '执行开始后不能再修改排期', 409);
    }
    const grant = this.grants.get(schedule.grant_id);
    if (!grant || grant.status !== 'active' || grant.consumed_at) {
      throw new DomainError('GRANT_NOT_ACTIVE', '当前排期的审批授权已失效', '撤回排期并重新审批', 409);
    }
    const proposal = this.proposals.get(schedule.proposal_id);
    if (!proposal) throw new NotFoundError('提案', schedule.proposal_id);
    const reviewCase = this.cases.get(proposal.review_case_id);
    if (!reviewCase) throw new NotFoundError('复核需求', proposal.review_case_id);
    const scheduleAt = new Date(input.schedule_at).toISOString();
    const expiresAt = new Date(input.expires_at).toISOString();
    if (Date.parse(scheduleAt) <= now.getTime()) throw new DomainError('SCHEDULE_IN_PAST', '修改后的排期必须晚于当前时间', '重新选择开始时间', 400);
    if (Date.parse(expiresAt) <= Date.parse(scheduleAt)) throw new DomainError('INVALID_GRANT_EXPIRY', '授权过期时间必须晚于排期时间', '调整授权有效期', 400);
    const at = nowIso(now);
    const operationId = newId('schedule-change');
    transaction(this.db, () => {
      if (!this.grants.reschedule(grant.id, scheduleAt, expiresAt)) {
        throw new DomainError('GRANT_NOT_ACTIVE', '当前排期的审批授权已失效', '撤回排期并重新审批', 409);
      }
      this.schedules.reschedule(schedule.id, scheduleAt, expiresAt, at);
      this.proposals.setStatus(proposal.id, 'scheduled', at);
      this.cases.setStatus(reviewCase.id, 'scheduled', at);
      const payload: PluginScheduleRequest = {
        proposal_id: proposal.id, grant_id: grant.id, requirement_hash: reviewCase.requirement_hash,
        scope_hash: proposal.scope_hash, schedule_at: scheduleAt, expires_at: expiresAt,
        trace_id: traceId, idempotency_key: operationId,
      };
      this.outbox.enqueue({ id: newId('outbox'), topic: 'plugin.reschedule', aggregateId: proposal.id,
        idempotencyKey: `reschedule:${operationId}`, payload, maxAttempts: this.pluginMaxAttempts, createdAt: at });
      this.audit.record({ entityType: 'review_case', entityId: reviewCase.id, action: 'schedule.rescheduled', actor: user.name,
        before: { schedule_at: schedule.schedule_at, expires_at: schedule.expires_at, status: schedule.status },
        after: { schedule_at: scheduleAt, expires_at: expiresAt, status: 'scheduled', reason: input.reason }, traceId, at });
    });
  }

  /** Revoke the active Grant, cancel the schedule and return the Proposal to human review. */
  withdraw(scheduleId: string, input: ScheduleWithdrawInput, user: User, traceId: string, now = new Date()): void {
    requireRole(user, ['reviewer', 'admin']);
    const schedule = this.requireControllable(scheduleId);
    if (!['scheduled', 'paused'].includes(schedule.status)) {
      throw new DomainError('SCHEDULE_NOT_WITHDRAWABLE', '只有待执行或已暂停的排期可以撤回', '执行开始后不能撤回', 409);
    }
    const grant = this.grants.get(schedule.grant_id);
    if (!grant || grant.status !== 'active' || grant.consumed_at) {
      throw new DomainError('GRANT_NOT_ACTIVE', '当前排期的审批授权已失效', '刷新详情后重试', 409);
    }
    const proposal = this.proposals.get(schedule.proposal_id);
    if (!proposal) throw new NotFoundError('提案', schedule.proposal_id);
    const reviewCase = this.cases.get(proposal.review_case_id);
    if (!reviewCase) throw new NotFoundError('复核需求', proposal.review_case_id);
    const reason = input.reason.trim() || '人工撤回排期';
    const at = nowIso(now);
    const operationId = newId('schedule-withdraw');
    transaction(this.db, () => {
      this.grants.revoke(grant.id);
      this.schedules.cancel(schedule.id, reason, at);
      this.proposals.setStatus(proposal.id, 'pending_review', at);
      this.cases.setStatus(reviewCase.id, 'pending_review', at);
      const payload: PluginWithdrawRequest = {
        proposal_id: proposal.id, grant_id: grant.id, requirement_hash: reviewCase.requirement_hash,
        scope_hash: proposal.scope_hash, reason, trace_id: traceId, idempotency_key: operationId,
      };
      this.outbox.enqueue({ id: newId('outbox'), topic: 'plugin.withdraw', aggregateId: proposal.id,
        idempotencyKey: `withdraw:${operationId}`, payload, maxAttempts: this.pluginMaxAttempts, createdAt: at });
      this.audit.record({ entityType: 'review_case', entityId: reviewCase.id, action: 'schedule.withdrawn', actor: user.name,
        before: { schedule_at: schedule.schedule_at, status: schedule.status, grant_status: grant.status },
        after: { status: 'cancelled', proposal_status: 'pending_review', reason }, traceId, at });
    });
  }

  private requireControllable(scheduleId: string) {
    const schedule = this.schedules.get(scheduleId);
    if (!schedule) throw new NotFoundError('排期', scheduleId);
    if (schedule.status === 'executing' || schedule.status === 'completed' || schedule.execution_id) {
      throw new DomainError('SCHEDULE_ALREADY_STARTED', '执行已开始，不能暂停、改期或撤回', '到交付记录查看当前执行', 409);
    }
    return schedule;
  }

  private record(proposalId: string, user: User, traceId: string, action: string, before: unknown, after: unknown, at: string): void {
    const proposal = this.proposals.get(proposalId);
    const reviewCase = proposal ? this.cases.get(proposal.review_case_id) : null;
    if (!reviewCase) return;
    this.audit.record({ entityType: 'review_case', entityId: reviewCase.id, action, actor: user.name, before, after, traceId, at });
  }
}
