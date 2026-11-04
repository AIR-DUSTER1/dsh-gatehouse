import type { PluginEventEnvelope, ProposalStatus } from '@gatehouse/contract';
import { executionDataSchema, pluginEventSchema, proposalCreatedDataSchema, proposalCreatedDataV2Schema } from '@gatehouse/contract';
import type { Database } from '../db/database.js';
import { transaction } from '../db/database.js';
import type { PluginEventRepository } from '../repositories/plugin-event-repository.js';
import type { ReviewRepository } from '../repositories/review-repository.js';
import type { ProposalRepository } from '../repositories/proposal-repository.js';
import type { GrantRepository } from '../repositories/grant-repository.js';
import type { ScheduleRepository } from '../repositories/schedule-repository.js';
import type { AuditService } from '../audit/audit-service.js';
import { DomainError } from '../domain/errors.js';
import { nowIso } from '../domain/utils.js';
import type { WorkspaceService } from './workspace-service.js';

export interface PluginEventResult { eventId: string; duplicate: boolean; status: 'processed' }

/** Projects dsh-superagent events into the review read model. HMAC is verified at the API boundary. */
export class PluginEventService {
  constructor(
    private readonly db: Database,
    private readonly events: PluginEventRepository,
    private readonly cases: ReviewRepository,
    private readonly proposals: ProposalRepository,
    private readonly grants: GrantRepository,
    private readonly schedules: ScheduleRepository,
    private readonly audit: AuditService,
    private readonly workspaces: WorkspaceService,
  ) {}

  process(input: { envelope: PluginEventEnvelope; nonce: string; now?: Date }): PluginEventResult {
    const parsed = pluginEventSchema.parse(input.envelope);
    const now = input.now ?? new Date();
    const at = nowIso(now);
    const existing = this.events.get(parsed.event_id);
    if (existing?.status === 'processed') return { eventId: parsed.event_id, duplicate: true, status: 'processed' };
    const nonceOwner = this.events.getByNonce(input.nonce);
    if (nonceOwner && nonceOwner.event_id !== parsed.event_id) {
      throw new DomainError('NONCE_REPLAYED', '请求 nonce 已被使用', '为本次事件生成新的 nonce', 409);
    }
    if (!existing) {
      this.events.begin(parsed.event_id, parsed.event_type, input.nonce, parsed, parsed.trace_id, at);
    }
    try {
      transaction(this.db, () => this.apply(parsed, at));
      this.events.complete(parsed.event_id, at);
      return { eventId: parsed.event_id, duplicate: false, status: 'processed' };
    } catch (error) {
      this.events.fail(parsed.event_id, error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  private apply(event: PluginEventEnvelope, at: string): void {
    if (event.event_type === 'proposal.created' || event.event_type === 'proposal.updated') {
      this.applyProposal(event, at);
      return;
    }
    if (event.event_type === 'proposal.superseded') {
      this.applySuperseded(event, at);
      return;
    }
    this.applyExecution(event, at);
  }

  private applyProposal(event: PluginEventEnvelope, at: string): void {
    const v2Data = event.version === '2.0' ? proposalCreatedDataV2Schema.parse(event.data) : null;
    const data = v2Data ?? proposalCreatedDataSchema.parse(event.data);
    const requestedWorkspaceId = v2Data
      ? v2Data.workspace_id
      : data.case.workspace_id ?? data.proposal.workspace_id ?? null;
    const fallback = this.workspaces.defaultWorkspace() ?? this.workspaces.ensureLegacyWorkspace(`${event.trace_id}:legacy`);
    const workspaceId = requestedWorkspaceId ?? fallback.id;
    const repositoryId = v2Data
      ? v2Data.repository_id
      : data.proposal.repository_id ?? data.case.repository_id ?? null;
    if (!this.workspaces.workspaceExists(workspaceId)) {
      throw new DomainError('WORKSPACE_NOT_FOUND', `工作区 ${workspaceId} 不存在`, '先在 Gatehouse 完成工作区接入', 404);
    }
    if (repositoryId && !this.workspaces.repositoryForEvent(workspaceId, repositoryId)) {
      throw new DomainError('REPOSITORY_BINDING_INVALID', '事件中的仓库不属于目标工作区', '检查 DSH 工作区配置', 409);
    }
    const workspaceBindingHash = v2Data
      ? v2Data.workspace_binding_hash
      : this.workspaces.workspaceBindingHash(workspaceId, repositoryId);
    const expectedBindingHash = this.workspaces.workspaceBindingHash(workspaceId, repositoryId);
    if (workspaceBindingHash && workspaceBindingHash !== expectedBindingHash) {
      throw new DomainError('WORKSPACE_BINDING_MISMATCH', '事件携带的工作区绑定哈希与当前配置不一致', '同步工作区配置后重新评估', 409);
    }
    const routingDecisionId = v2Data
      ? v2Data.routing_decision.id
      : null;
    if (v2Data) {
      if (v2Data.routing_decision.workspace_id !== workspaceId
        || v2Data.routing_decision.repository_id !== repositoryId) {
        throw new DomainError('ROUTING_BINDING_MISMATCH', '路由结果与事件目标工作区不一致', '检查 DSH 路由事件', 409);
      }
      this.workspaces.recordRoutingDecision({ ...v2Data.routing_decision, overridden_by: v2Data.routing_decision.overridden_by ?? null });
    }
    const caseStatus: ProposalStatus = 'pending_review';
    const proposalStatus: ProposalStatus = 'pending_review';
    const existingCase = this.cases.get(data.case.id) ?? this.cases.getByPluginCaseId(data.case.plugin_case_id);
    const existingProposal = this.proposals.get(data.proposal.id);

    if (!existingCase) {
      this.cases.create({ ...data.case, workspace_id: workspaceId, repository_id: repositoryId,
        routing_decision_id: routingDecisionId, status: caseStatus, updated_at: at });
    } else {
      if (existingCase.workspace_id && existingCase.workspace_id !== workspaceId) {
        throw new DomainError('CASE_WORKSPACE_MISMATCH', '同一复核需求不能跨工作区更新', '检查 DSH 路由结果', 409);
      }
      this.cases.update({ ...data.case, id: existingCase.id, workspace_id: workspaceId, repository_id: repositoryId,
        routing_decision_id: routingDecisionId ?? existingCase.routing_decision_id ?? null,
        status: caseStatus, updated_at: at });
    }
    const caseId = existingCase?.id ?? data.case.id;

    if (existingProposal) {
      const grant = this.grants.getByProposal(existingProposal.id);
      const hashesChanged = existingProposal.scope_hash !== data.proposal.scope_hash
        || existingCase?.requirement_hash !== data.case.requirement_hash
        || existingProposal.workspace_id !== workspaceId || existingProposal.repository_id !== repositoryId
        || existingProposal.workspace_binding_hash !== workspaceBindingHash;
      this.proposals.update({
        ...data.proposal,
        review_case_id: caseId,
        workspace_id: workspaceId,
        repository_id: repositoryId,
        workspace_binding_hash: workspaceBindingHash,
        status: hashesChanged ? 'pending_review' : data.proposal.status === 'superseded' ? 'superseded' : proposalStatus,
        updated_at: at,
      });
      if (hashesChanged && grant?.status === 'active') {
        this.grants.revoke(grant.id);
        const schedule = this.schedules.getByProposal(existingProposal.id);
        if (schedule) this.schedules.cancel(schedule.id, '需求或执行范围已变化', at);
        this.audit.record({
          entityType: 'review_case', entityId: caseId, action: 'approval.invalidated', actor: 'dsh-superagent',
          before: { proposal_id: existingProposal.id, scope_hash: existingProposal.scope_hash, requirement_hash: existingCase?.requirement_hash },
          after: { status: 'pending_review', reason: '需求、范围或工作区绑定已变化' }, traceId: event.trace_id, at, workspaceId,
        });
      }
    } else {
      this.proposals.create({ ...data.proposal, review_case_id: caseId, workspace_id: workspaceId,
        repository_id: repositoryId, workspace_binding_hash: workspaceBindingHash,
        status: proposalStatus, updated_at: at });
      this.proposals.supersedeOthers(caseId, data.proposal.id, at);
    }
    this.audit.record({
      entityType: 'review_case', entityId: caseId, action: event.event_type, actor: 'dsh-superagent',
      before: null, after: { proposal_id: data.proposal.id, assessment_revision: data.proposal.assessment_revision,
        workspace_id: workspaceId, repository_id: repositoryId },
      traceId: event.trace_id, at, workspaceId,
    });
  }

  private applySuperseded(event: PluginEventEnvelope, at: string): void {
    const proposalId = String(event.data.proposal_id ?? '');
    if (!proposalId) throw new DomainError('INVALID_PLUGIN_EVENT', 'proposal.superseded 缺少 proposal_id', '检查插件事件契约', 400);
    const proposal = this.proposals.get(proposalId);
    if (!proposal) throw new DomainError('PROPOSAL_NOT_FOUND', `提案 ${proposalId} 不存在`, '检查插件事件顺序', 404);
    this.proposals.setStatus(proposal.id, 'superseded', at);
    this.cases.setStatus(proposal.review_case_id, 'superseded', at);
    const grant = this.grants.getByProposal(proposal.id);
    if (grant?.status === 'active') this.grants.revoke(grant.id);
    const schedule = this.schedules.getByProposal(proposal.id);
    if (schedule && ['scheduled', 'paused'].includes(schedule.status)) this.schedules.cancel(schedule.id, '提案已被新版本替代', at);
    this.audit.record({
      entityType: 'review_case', entityId: proposal.review_case_id, action: 'proposal.superseded', actor: 'dsh-superagent',
      before: { proposal_id: proposal.id, status: proposal.status }, after: { status: 'superseded', superseded_by: event.data.superseded_by ?? null },
      traceId: event.trace_id, at, workspaceId: proposal.workspace_id ?? null,
    });
  }

  private applyExecution(event: PluginEventEnvelope, at: string): void {
    const data = executionDataSchema.parse(event.data);
    const proposal = this.proposals.get(data.proposal_id);
    if (!proposal) throw new DomainError('PROPOSAL_NOT_FOUND', `提案 ${data.proposal_id} 不存在`, '检查插件事件顺序', 404);
    const schedule = this.schedules.getByProposal(proposal.id);
    if (event.event_type === 'execution.started') {
      this.proposals.setStatus(proposal.id, 'executing', at);
      this.cases.setStatus(proposal.review_case_id, 'executing', at);
      if (schedule && ['scheduled', 'paused'].includes(schedule.status)) this.schedules.setStatus(schedule.id, 'executing', at);
    } else if (event.event_type === 'execution.finished') {
      this.proposals.setStatus(proposal.id, 'completed', at);
      this.cases.setStatus(proposal.review_case_id, 'completed', at);
      if (schedule) {
        this.grants.consume(schedule.grant_id, at);
        this.schedules.complete(schedule.id, data.pr_url ?? null, at);
      }
    } else {
      this.proposals.setStatus(proposal.id, 'failed', at);
      this.cases.setStatus(proposal.review_case_id, 'failed', at);
      if (schedule) this.schedules.fail(schedule.id, data.error ?? '执行失败', at);
    }
    this.audit.record({
      entityType: 'review_case', entityId: proposal.review_case_id, action: event.event_type, actor: 'dsh-superagent',
      before: { status: proposal.status }, after: { execution_id: data.execution_id, pr_url: data.pr_url ?? null, error: data.error ?? null },
      traceId: event.trace_id, at, workspaceId: proposal.workspace_id ?? null,
    });
  }
}
