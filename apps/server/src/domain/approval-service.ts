import type { DecisionInput, User, ReviewDecisionRecord } from '@gatehouse/contract';
import type { Database } from '../db/database.js';
import { transaction } from '../db/database.js';
import type { ReviewRepository } from '../repositories/review-repository.js';
import type { ProposalRepository } from '../repositories/proposal-repository.js';
import type { DecisionRepository } from '../repositories/decision-repository.js';
import type { GrantRepository } from '../repositories/grant-repository.js';
import type { ScheduleRepository } from '../repositories/schedule-repository.js';
import type { OutboxRepository } from '../repositories/outbox-repository.js';
import type { AuditService } from '../audit/audit-service.js';
import { DomainError, NotFoundError } from './errors.js';
import { newId, nowIso, stableHash } from './utils.js';
import { requireRole } from '../auth.js';
import type { PluginDecisionRequest } from '../plugin/plugin-client.js';

export interface DecisionResult {
  decision: ReviewDecisionRecord;
  replayed: boolean;
  proposalId: string;
}

/** Approval use case owns role, self-approval, hash binding and transactional decision persistence. */
export class ApprovalService {
  constructor(
    private readonly db: Database,
    private readonly cases: ReviewRepository,
    private readonly proposals: ProposalRepository,
    private readonly decisions: DecisionRepository,
    private readonly grants: GrantRepository,
    private readonly schedules: ScheduleRepository,
    private readonly outbox: OutboxRepository,
    private readonly audit: AuditService,
    private readonly pluginMaxAttempts: number,
  ) {}

  decide(input: {
    proposalId: string;
    user: User;
    decision: DecisionInput;
    idempotencyKey: string;
    traceId: string;
    now?: Date;
  }): DecisionResult {
    requireRole(input.user, ['reviewer', 'admin']);
    if (!input.idempotencyKey.trim()) {
      throw new DomainError('IDEMPOTENCY_KEY_REQUIRED', '缺少幂等键', '为本次审批生成唯一幂等键后重试', 400);
    }
    const requestHash = stableHash({ proposalId: input.proposalId, decision: input.decision });
    const existing = this.decisions.findByIdempotencyKey(input.idempotencyKey);
    if (existing) {
      if (existing.request_hash !== requestHash) {
        throw new DomainError('IDEMPOTENCY_CONFLICT', '相同幂等键被用于不同审批内容', '请使用新的幂等键', 409);
      }
      return { decision: existing, replayed: true, proposalId: existing.proposal_id };
    }

    const proposal = this.proposals.get(input.proposalId);
    if (!proposal) throw new NotFoundError('提案', input.proposalId);
    const reviewCase = this.cases.get(proposal.review_case_id);
    if (!reviewCase) throw new NotFoundError('复核需求', proposal.review_case_id);
    if (proposal.status !== 'pending_review') {
      throw new DomainError('PROPOSAL_NOT_REVIEWABLE', `当前提案状态为 ${proposal.status}，不能再次审批`, '刷新详情并确认当前状态', 409);
    }
    if (input.decision.decision === 'approve' && input.user.name === reviewCase.requester) {
      throw new DomainError('SELF_APPROVAL_FORBIDDEN', '申请人不能批准自己的需求', '请交给另一位复核人处理', 403);
    }

    const now = input.now ?? new Date();
    const at = nowIso(now);
    let scheduleAt = '';
    let expiresAt = '';
    if (input.decision.decision === 'approve') {
      scheduleAt = new Date(input.decision.schedule_at).toISOString();
      expiresAt = new Date(input.decision.expires_at).toISOString();
      if (Date.parse(scheduleAt) <= now.getTime()) {
        throw new DomainError('SCHEDULE_IN_PAST', '排期时间必须晚于当前时间', '重新选择执行时间', 400);
      }
      if (Date.parse(expiresAt) <= Date.parse(scheduleAt)) {
        throw new DomainError('INVALID_GRANT_EXPIRY', '授权过期时间必须晚于排期时间', '调整授权有效期', 400);
      }
    }

    const decisionId = newId('decision');
    const decisionRecord: ReviewDecisionRecord = {
      id: decisionId,
      proposal_id: proposal.id,
      decision: input.decision.decision,
      reviewer: input.user.name,
      comment: input.decision.comment,
      created_at: at,
    };

    const nextStatus = input.decision.decision === 'approve'
      ? 'scheduled'
      : input.decision.decision === 'reject' ? 'rejected' : 'info_requested';

    transaction(this.db, () => {
      this.decisions.create({ ...decisionRecord, idempotency_key: input.idempotencyKey, request_hash: requestHash });
      this.proposals.setStatus(proposal.id, nextStatus, at);
      this.cases.setStatus(reviewCase.id, nextStatus, at);
      this.audit.record({
        entityType: 'review_case', entityId: reviewCase.id, action: 'decision.recorded', actor: input.user.name,
        before: { status: proposal.status }, after: { status: nextStatus, decision: input.decision.decision, comment: input.decision.comment },
        traceId: input.traceId, at,
      });

      if (input.decision.decision === 'approve') {
        const grantId = newId('grant');
        this.grants.create({
          id: grantId, proposal_id: proposal.id, reviewer: input.user.name,
          requirement_hash: reviewCase.requirement_hash, scope_hash: proposal.scope_hash,
          approved_at: at, schedule_at: scheduleAt, expires_at: expiresAt, consumed_at: null, status: 'active',
        });
        this.schedules.create({
          id: newId('schedule'), proposal_id: proposal.id, grant_id: grantId,
          schedule_at: scheduleAt, expires_at: expiresAt, status: 'scheduled', approval_synced_at: null,
          attempts: 0, max_attempts: this.pluginMaxAttempts, last_error: null, execution_id: null, pr_url: null,
          created_at: at, updated_at: at,
        });
        this.audit.record({
          entityType: 'review_case', entityId: reviewCase.id, action: 'grant.created', actor: input.user.name,
          before: null, after: { grant_id: grantId, schedule_at: scheduleAt, expires_at: expiresAt },
          traceId: input.traceId, at,
        });
        this.audit.record({
          entityType: 'review_case', entityId: reviewCase.id, action: 'schedule.created', actor: input.user.name,
          before: null, after: { schedule_at: scheduleAt, status: 'scheduled' }, traceId: input.traceId, at,
        });
      }

      const pluginPayload: PluginDecisionRequest = {
        proposal_id: proposal.id,
        decision: input.decision.decision,
        reviewer: input.user.name,
        comment: input.decision.comment,
        requirement_hash: reviewCase.requirement_hash,
        scope_hash: proposal.scope_hash,
        ...(input.decision.decision === 'approve' ? { schedule_at: scheduleAt, expires_at: expiresAt } : {}),
        trace_id: input.traceId,
        idempotency_key: input.idempotencyKey,
      };
      this.outbox.enqueue({
        id: newId('outbox'), topic: 'plugin.decision', aggregateId: proposal.id,
        idempotencyKey: `decision:${input.idempotencyKey}`, payload: pluginPayload,
        maxAttempts: this.pluginMaxAttempts, createdAt: at,
      });
    });

    return { decision: decisionRecord, replayed: false, proposalId: proposal.id };
  }
}
