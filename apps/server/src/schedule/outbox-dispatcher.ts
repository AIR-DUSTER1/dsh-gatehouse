import type { Database } from '../db/database.js';
import { transaction } from '../db/database.js';
import type { OutboxMessage, OutboxRepository } from '../repositories/outbox-repository.js';
import type { ScheduleRepository } from '../repositories/schedule-repository.js';
import type { GrantRepository } from '../repositories/grant-repository.js';
import type { ProposalRepository } from '../repositories/proposal-repository.js';
import type { ReviewRepository } from '../repositories/review-repository.js';
import type { AuditService } from '../audit/audit-service.js';
import type { PluginClient, PluginDecisionRequest, PluginExecuteRequest, PluginExecuteResponse, PluginScheduleRequest,
  PluginWithdrawRequest } from '../plugin/plugin-client.js';
import { nowIso } from '../domain/utils.js';

export interface DrainResult { delivered: number; retried: number; dead: number }

/** Delivers transactional outbox messages and projects successful plugin outcomes. */
export class OutboxDispatcher {
  private running = false;

  constructor(
    private readonly db: Database,
    private readonly outbox: OutboxRepository,
    private readonly schedules: ScheduleRepository,
    private readonly grants: GrantRepository,
    private readonly proposals: ProposalRepository,
    private readonly cases: ReviewRepository,
    private readonly audit: AuditService,
    private readonly plugin: PluginClient,
  ) {}

  recover(now = new Date()): void {
    this.outbox.recoverInflight(nowIso(now));
  }

  async drain(now = new Date(), limit = 20): Promise<DrainResult> {
    if (this.running) return { delivered: 0, retried: 0, dead: 0 };
    this.running = true;
    const result: DrainResult = { delivered: 0, retried: 0, dead: 0 };
    try {
      const at = nowIso(now);
      for (const message of this.outbox.due(at, limit)) {
        this.outbox.markInflight(message.id, at);
        try {
          const projection = await this.deliver(message);
          transaction(this.db, () => {
            this.projectSuccess(message, projection, at);
            this.outbox.markDelivered(message.id, at);
          });
          result.delivered += 1;
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          if (message.attempts + 1 >= message.maxAttempts) {
            transaction(this.db, () => {
              this.projectDead(message, reason, at);
              this.outbox.markDead(message.id, reason, at);
            });
            result.dead += 1;
          } else {
            const backoffMs = Math.min(60_000, 1_000 * 2 ** message.attempts);
            const nextAttempt = nowIso(new Date(now.getTime() + backoffMs));
            this.outbox.markFailedAttempt(message.id, reason, nextAttempt, at);
            if (message.topic === 'plugin.execute') {
              const schedule = this.schedules.getByProposal(message.aggregateId);
              if (schedule) this.schedules.recordError(schedule.id, reason, at);
            }
            result.retried += 1;
          }
        }
      }
      return result;
    } finally {
      this.running = false;
    }
  }

  private async deliver(message: OutboxMessage): Promise<{ executionId?: string; ticketId?: string; prUrl?: string | null; completed?: boolean }> {
    if (message.topic === 'plugin.decision') {
      await this.plugin.decide(message.payload as PluginDecisionRequest);
      return {};
    }
    if (message.topic === 'plugin.execute') {
      const payload = message.payload as PluginExecuteRequest
      const response: PluginExecuteResponse = await this.plugin.execute(payload)
      if (response.execution_id !== payload.execution_id) throw new Error(`plugin returned execution_id ${response.execution_id}, expected ${payload.execution_id}`)
      return { executionId: response.execution_id, ...(response.ticket_id ? { ticketId: response.ticket_id } : {}), prUrl: response.pr_url ?? null, completed: response.completed === true };
    }
    if (message.topic === 'plugin.reschedule') {
      await this.plugin.reschedule(message.payload as PluginScheduleRequest);
      return {};
    }
    if (message.topic === 'plugin.withdraw') {
      await this.plugin.withdraw(message.payload as PluginWithdrawRequest);
      return {};
    }
    throw new Error(`未知 outbox topic: ${message.topic}`);
  }

  private projectSuccess(message: OutboxMessage, projection: { executionId?: string; ticketId?: string; prUrl?: string | null; completed?: boolean }, at: string): void {
    const proposal = this.proposals.get(message.aggregateId);
    if (!proposal) throw new Error(`提案 ${message.aggregateId} 不存在`);
    const reviewCase = this.cases.get(proposal.review_case_id);
    if (!reviewCase) throw new Error(`复核需求 ${proposal.review_case_id} 不存在`);
    const schedule = this.schedules.getByProposal(proposal.id);
    if (message.topic === 'plugin.decision') {
      if (schedule) {
        this.schedules.markApprovalSynced(proposal.id, at);
        this.audit.record({
          entityType: 'review_case', entityId: reviewCase.id, action: 'schedule.plugin_synced', actor: 'system',
          before: { approval_synced_at: null }, after: { approval_synced_at: at }, traceId: `outbox:${message.id}`, at,
          workspaceId: schedule.workspace_id ?? proposal.workspace_id ?? reviewCase.workspace_id ?? null,
        });
      }
      return;
    }
    if (message.topic === 'plugin.reschedule') {
      if (schedule) {
        this.schedules.markApprovalSynced(proposal.id, at);
        this.audit.record({
          entityType: 'review_case', entityId: reviewCase.id, action: 'schedule.reschedule_synced', actor: 'system',
          before: { approval_synced_at: null }, after: { approval_synced_at: at }, traceId: `outbox:${message.id}`, at,
          workspaceId: schedule.workspace_id ?? proposal.workspace_id ?? reviewCase.workspace_id ?? null,
        });
      }
      return;
    }
    if (message.topic === 'plugin.withdraw') {
      this.audit.record({
        entityType: 'review_case', entityId: reviewCase.id, action: 'schedule.withdraw_synced', actor: 'system',
        before: { grant_status: 'revoked' }, after: { synced: true }, traceId: `outbox:${message.id}`, at,
        workspaceId: schedule?.workspace_id ?? proposal.workspace_id ?? reviewCase.workspace_id ?? null,
      });
      return;
    }
    if (message.topic === 'plugin.execute' && schedule) {
      if (projection.completed) {
        this.grants.consume(schedule.grant_id, at);
        this.schedules.complete(schedule.id, projection.prUrl ?? null, at);
        this.proposals.setStatus(proposal.id, 'completed', at);
        this.cases.setStatus(reviewCase.id, 'completed', at);
        this.audit.record({
          entityType: 'review_case', entityId: reviewCase.id, action: 'execution.finished', actor: 'dsh-superagent',
          before: { status: 'executing' }, after: { status: 'completed', execution_id: projection.executionId, pr_url: projection.prUrl },
          traceId: `outbox:${message.id}`, at,
          workspaceId: schedule.workspace_id ?? proposal.workspace_id ?? reviewCase.workspace_id ?? null,
        });
      } else {
        this.audit.record({
          entityType: 'review_case', entityId: reviewCase.id, action: 'execution.dispatched', actor: 'system',
          before: { status: 'scheduled' }, after: { status: 'executing', execution_id: projection.executionId, ticket_id: projection.ticketId ?? null },
          traceId: `outbox:${message.id}`, at,
          workspaceId: schedule.workspace_id ?? proposal.workspace_id ?? reviewCase.workspace_id ?? null,
        });
      }
    }
  }

  private projectDead(message: OutboxMessage, reason: string, at: string): void {
    const proposal = this.proposals.get(message.aggregateId);
    if (!proposal) return;
    const reviewCase = this.cases.get(proposal.review_case_id);
    if (!reviewCase) return;
    const schedule = this.schedules.getByProposal(proposal.id);
    if (schedule && message.topic === 'plugin.reschedule') {
      this.schedules.recordError(schedule.id, reason, at);
      this.audit.record({
        entityType: 'review_case', entityId: reviewCase.id, action: 'plugin.reschedule.failed', actor: 'system',
        before: { approval_synced_at: null }, after: { reason, outbox_id: message.id }, traceId: `outbox:${message.id}`, at,
        workspaceId: schedule.workspace_id ?? proposal.workspace_id ?? reviewCase.workspace_id ?? null,
      });
      return;
    }
    if (message.topic === 'plugin.withdraw') {
      if (schedule) this.schedules.recordError(schedule.id, reason, at);
      this.audit.record({
        entityType: 'review_case', entityId: reviewCase.id, action: 'plugin.withdraw.failed', actor: 'system',
        before: { grant_status: 'revoked' }, after: { reason, outbox_id: message.id }, traceId: `outbox:${message.id}`, at,
        workspaceId: schedule?.workspace_id ?? proposal.workspace_id ?? reviewCase.workspace_id ?? null,
      });
      return;
    }
    if (schedule) {
      if (message.topic === 'plugin.decision') this.schedules.cancel(schedule.id, reason, at);
      else this.schedules.fail(schedule.id, reason, at);
    }
    this.proposals.setStatus(proposal.id, 'failed', at);
    this.cases.setStatus(reviewCase.id, 'failed', at);
    this.audit.record({
      entityType: 'review_case', entityId: reviewCase.id, action: 'plugin.sync.failed', actor: 'system',
      before: { status: proposal.status }, after: { status: 'failed', reason, outbox_id: message.id },
      traceId: `outbox:${message.id}`, at,
      workspaceId: schedule?.workspace_id ?? proposal.workspace_id ?? reviewCase.workspace_id ?? null,
    });
  }
}
