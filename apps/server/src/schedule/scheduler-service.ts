import type { Database } from '../db/database.js';
import { transaction } from '../db/database.js';
import type { ScheduleRepository } from '../repositories/schedule-repository.js';
import type { GrantRepository } from '../repositories/grant-repository.js';
import type { ProposalRepository } from '../repositories/proposal-repository.js';
import type { ReviewRepository } from '../repositories/review-repository.js';
import type { OutboxRepository } from '../repositories/outbox-repository.js';
import type { SettingsRepository } from '../repositories/settings-repository.js';
import type { AuditService } from '../audit/audit-service.js';
import type { OutboxDispatcher } from './outbox-dispatcher.js';
import { newId, nowIso } from '../domain/utils.js';
import type { WorkspaceService } from '../domain/workspace-service.js';

/** Persistent scheduler. Every wake reads due work from SQLite; no in-memory timer is authoritative. */
export class SchedulerService {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly db: Database,
    private readonly schedules: ScheduleRepository,
    private readonly grants: GrantRepository,
    private readonly proposals: ProposalRepository,
    private readonly cases: ReviewRepository,
    private readonly outbox: OutboxRepository,
    private readonly settings: SettingsRepository,
    private readonly audit: AuditService,
    private readonly dispatcher: OutboxDispatcher,
    private readonly pollMs: number,
    private readonly defaultMaxConcurrency: number,
    private readonly maxAttempts: number,
    private readonly workspaceService: WorkspaceService,
  ) {}

  start(): void {
    if (this.timer) return;
    this.dispatcher.recover();
    this.timer = setInterval(() => void this.runOnce().catch((error) => console.error('[scheduler]', error)), this.pollMs);
    this.timer.unref();
    void this.runOnce().catch((error) => console.error('[scheduler]', error));
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async runOnce(now = new Date()): Promise<{ claimed: number; delivered: number }> {
    if (this.running) return { claimed: 0, delivered: 0 };
    this.running = true;
    try {
      await this.dispatcher.drain(now);
      const at = nowIso(now);
      const maxConcurrency = Number.parseInt(this.settings.get('max_concurrency') ?? '', 10) || this.defaultMaxConcurrency;
      const available = Math.max(0, maxConcurrency - this.schedules.countExecuting());
      if (available === 0) return { claimed: 0, delivered: 0 };
      const candidates = this.schedules.due(at, available);
      let claimed = 0;
      for (const candidate of candidates) {
        const claimedNow = transaction(this.db, () => this.claim(candidate.id, at));
        if (claimedNow) claimed += 1;
      }
      const result = await this.dispatcher.drain(now);
      return { claimed, delivered: result.delivered };
    } finally {
      this.running = false;
    }
  }

  private claim(scheduleId: string, at: string): boolean {
    const schedule = this.schedules.get(scheduleId);
    if (!schedule || schedule.status !== 'scheduled' || !schedule.approval_synced_at || schedule.schedule_at > at) return false;
    const proposal = this.proposals.get(schedule.proposal_id);
    if (!proposal) return false;
    const reviewCase = this.cases.get(proposal.review_case_id);
    if (!reviewCase) return false;
    const grant = this.grants.get(schedule.grant_id);
    if (!grant) return false;
    const workspaceId = schedule.workspace_id ?? proposal.workspace_id ?? reviewCase.workspace_id ?? null;
    if (!workspaceId) {
      this.schedules.cancel(schedule.id, '任务尚未绑定工作区', at);
      this.proposals.setStatus(proposal.id, 'pending_review', at);
      this.cases.setStatus(reviewCase.id, 'pending_review', at);
      return false;
    }
    const workspace = this.workspaceService.detail({ id: 'system', role: 'admin', name: 'system', email: 'system@local' }, workspaceId);
    if (workspace.status !== 'active') {
      this.grants.revoke(grant.id);
      this.schedules.cancel(schedule.id, '目标工作区未启用', at);
      this.proposals.setStatus(proposal.id, 'pending_review', at);
      this.cases.setStatus(reviewCase.id, 'pending_review', at);
      this.audit.record({
        entityType: 'review_case', entityId: reviewCase.id, action: 'workspace.execution_blocked', actor: 'system',
        before: { workspace_status: workspace.status }, after: { status: 'pending_review' },
        traceId: `schedule:${schedule.id}`, at, workspaceId,
      });
      return false;
    }
    const repositoryId = schedule.repository_id ?? proposal.repository_id ?? reviewCase.repository_id ?? null;
    const bindingHash = this.workspaceService.workspaceBindingHash(workspaceId, repositoryId);
    if (grant.workspace_binding_hash !== bindingHash || proposal.workspace_binding_hash !== bindingHash) {
      this.grants.revoke(grant.id);
      this.schedules.cancel(schedule.id, '工作区绑定已变化', at);
      this.proposals.setStatus(proposal.id, 'pending_review', at);
      this.cases.setStatus(reviewCase.id, 'pending_review', at);
      this.audit.record({
        entityType: 'review_case', entityId: reviewCase.id, action: 'workspace.binding_invalidated', actor: 'system',
        before: { grant_hash: grant.workspace_binding_hash, proposal_hash: proposal.workspace_binding_hash },
        after: { status: 'pending_review', current_hash: bindingHash },
        traceId: `schedule:${schedule.id}`, at, workspaceId,
      });
      return false;
    }

    if (grant.status !== 'active' || grant.consumed_at) {
      this.schedules.cancel(schedule.id, '审批授权已失效', at);
      this.proposals.setStatus(proposal.id, 'pending_review', at);
      this.cases.setStatus(reviewCase.id, 'pending_review', at);
      this.audit.record({
        entityType: 'review_case', entityId: reviewCase.id, action: 'approval.invalidated', actor: 'system',
        before: { grant_status: grant.status }, after: { status: 'pending_review', reason: '审批授权已失效' },
        traceId: `schedule:${schedule.id}`, at, workspaceId,
      });
      return false;
    }
    if (Date.parse(grant.expires_at) <= Date.parse(at)) {
      this.grants.expire(grant.id);
      this.schedules.fail(schedule.id, '审批授权已过期', at);
      this.proposals.setStatus(proposal.id, 'failed', at);
      this.cases.setStatus(reviewCase.id, 'failed', at);
      this.audit.record({
        entityType: 'review_case', entityId: reviewCase.id, action: 'approval.expired', actor: 'system',
        before: { expires_at: grant.expires_at }, after: { status: 'failed' }, traceId: `schedule:${schedule.id}`, at, workspaceId,
      });
      return false;
    }
    if (grant.requirement_hash !== reviewCase.requirement_hash || grant.scope_hash !== proposal.scope_hash) {
      this.grants.revoke(grant.id);
      this.schedules.cancel(schedule.id, '需求或执行范围已变化', at);
      this.proposals.setStatus(proposal.id, 'pending_review', at);
      this.cases.setStatus(reviewCase.id, 'pending_review', at);
      this.audit.record({
        entityType: 'review_case', entityId: reviewCase.id, action: 'approval.invalidated', actor: 'system',
        before: { requirement_hash: grant.requirement_hash, scope_hash: grant.scope_hash },
        after: { status: 'pending_review', reason: '需求或执行范围已变化' }, traceId: `schedule:${schedule.id}`, at, workspaceId,
      });
      return false;
    }

    const executionId = schedule.execution_id ?? newId('execution');
    this.schedules.markExecuting(schedule.id, executionId, at);
    this.proposals.setStatus(proposal.id, 'executing', at);
    this.cases.setStatus(reviewCase.id, 'executing', at);
    this.outbox.enqueue({
      id: newId('outbox'), topic: 'plugin.execute', aggregateId: proposal.id,
      idempotencyKey: `execute:${executionId}`,
      payload: {
        proposal_id: proposal.id, grant_id: grant.id, requirement_hash: reviewCase.requirement_hash,
        scope_hash: proposal.scope_hash, workspace_binding_hash: bindingHash, execution_id: executionId,
        trace_id: `schedule:${schedule.id}`, idempotency_key: `execute:${executionId}`,
      },
      maxAttempts: this.maxAttempts, createdAt: at,
    });
    this.audit.record({
      entityType: 'review_case', entityId: reviewCase.id, action: 'execution.started', actor: 'system',
      before: { status: 'scheduled' }, after: { status: 'executing', execution_id: executionId },
      traceId: `schedule:${schedule.id}`, at, workspaceId,
    });
    return true;
  }
}
