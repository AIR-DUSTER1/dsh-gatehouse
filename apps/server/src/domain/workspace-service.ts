import { isIP } from 'node:net';
import type {
  RepositoryDescriptionInput,
  RepositoryDescriptionSuggestion,
  RepositoryConfigInput,
  RepositoryDiscovery,
  RoutingReassignInput,
  RoutingDecisionRecord,
  Role,
  User,
  WorkspaceCreateInput,
  WorkspaceListItem,
  WorkspaceRecord,
  WorkspaceRepositoryRecord,
  WorkspaceSourceBindingRecord,
} from '@gatehouse/contract';
import type { AppConfig } from '../config.js';
import type { Database } from '../db/database.js';
import { transaction } from '../db/database.js';
import type { WorkspaceStore, WorkspaceRepositoryInput } from '../repositories/workspace-repository.js';
import type { PluginClient, PluginWorkspaceSyncWorkspace } from '../plugin/plugin-client.js';
import type { AuditService } from '../audit/audit-service.js';
import { DomainError, NotFoundError } from './errors.js';
import { newId, nowIso, stableHash } from './utils.js';
import { requireRole } from '../auth.js';

const KNOWN_PUBLIC_GIT_HOSTS = new Set(['github.com', 'api.github.com', 'gitlab.com', 'bitbucket.org', 'api.bitbucket.org']);
const PRIVATE_IPV4 = [
  /^10\./,
  /^127\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^0\./,
];

export interface RepositoryDescriptionConfirmation extends RepositoryDescriptionInput {
  source_fingerprint?: string | undefined;
  generated_at?: string | undefined;
  model?: string | undefined;
}

/** Application service for workspace onboarding, repository health, description confirmation and DSH sync. */
export class WorkspaceService {
  constructor(
    private readonly db: Database,
    private readonly workspaces: WorkspaceStore,
    private readonly plugin: PluginClient,
    private readonly audit: AuditService,
    private readonly config: Pick<AppConfig, 'repositoryHostAllowlist' | 'allowPrivateRepositoryHosts'>,
  ) {}

  list(user: User): WorkspaceListItem[] {
    return this.workspaces.list(user);
  }

  defaultWorkspace(): WorkspaceRecord | null {
    return this.workspaces.defaultWorkspace();
  }

  workspaceExists(workspaceId: string): boolean {
    return this.workspaces.get(workspaceId) !== null;
  }

  recordRoutingDecision(input: RoutingDecisionRecord): void {
    if (!this.workspaces.routingDecision(input.id)) {
      this.workspaces.createRoutingDecision({
        id: input.id,
        workspaceId: input.workspace_id,
        repositoryId: input.repository_id,
        source: input.source,
        mode: input.mode,
        confidence: input.confidence,
        reason: input.reason,
        candidates: input.candidates,
        requiresHuman: input.requires_human,
        createdAt: input.created_at,
      });
    }
  }

  requireAccess(user: User, workspaceId: string): WorkspaceRecord {
    const workspace = this.workspaces.get(workspaceId);
    if (!workspace) throw new NotFoundError('工作区', workspaceId);
    if (!this.workspaces.canAccess(user, workspaceId)) {
      throw new DomainError('WORKSPACE_FORBIDDEN', '当前账号无权访问该工作区', '请管理员授予工作区成员权限', 403);
    }
    return workspace;
  }

  detail(user: User, workspaceId: string): WorkspaceListItem {
    this.requireAccess(user, workspaceId);
    const workspace = this.workspaces.list(user).find((item) => item.id === workspaceId);
    if (!workspace) throw new NotFoundError('工作区', workspaceId);
    return workspace;
  }

  create(input: WorkspaceCreateInput, user: User, traceId: string, now = new Date()): WorkspaceListItem {
    requireRole(user, ['admin']);
    const at = nowIso(now);
    const workspaceId = newId('workspace');
    const workspace: WorkspaceRecord = {
      id: workspaceId,
      name: input.name,
      slug: input.slug,
      description: input.description,
      description_version: 1,
      description_hash: input.description ? stableHash(input.description) : null,
      status: 'onboarding',
      created_at: at,
      updated_at: at,
    };
    this.validateWorkspaceUrls(input.repository ? {
      api_base_url: input.repository.api_base_url,
      web_base_url: input.repository.web_base_url,
      clone_url: input.repository.clone_url,
    } : null);
    transaction(this.db, () => {
      this.workspaces.create(workspace);
      this.workspaces.addMember(workspace.id, user.id, at);
      if (input.repository) this.createRepositoryRecord(workspace.id, input.repository, user, at);
      this.audit.record({
        entityType: 'workspace', entityId: workspace.id, action: 'workspace.created', actor: user.name,
        before: null, after: { name: workspace.name, slug: workspace.slug, status: workspace.status }, traceId, at,
      });
    });
    return this.detail(user, workspace.id);
  }

  addRepository(workspaceId: string, input: RepositoryConfigInput,
    user: User, traceId: string, now = new Date()): WorkspaceRepositoryRecord {
    requireRole(user, ['admin']);
    const workspace = this.requireAccess(user, workspaceId);
    if (workspace.status === 'disabled') {
      throw new DomainError('WORKSPACE_DISABLED', '工作区已停用，不能新增仓库', '先启用工作区或选择其他工作区', 409);
    }
    this.validateWorkspaceUrls({ api_base_url: input.api_base_url, web_base_url: input.web_base_url, clone_url: input.clone_url });
    const at = nowIso(now);
    let repository!: WorkspaceRepositoryRecord;
    transaction(this.db, () => {
      repository = this.createRepositoryRecord(workspaceId, input, user, at);
      this.audit.record({
        entityType: 'repository', entityId: repository.id, action: 'repository.created', actor: user.name,
        before: null, after: { workspace_id: workspaceId, provider: repository.provider, repository_key: repository.repository_key },
        traceId, at, workspaceId,
      });
    });
    return repository;
  }

  update(workspaceId: string, input: { name?: string; description?: string }, user: User, traceId: string,
    now = new Date()): WorkspaceRecord {
    requireRole(user, ['admin']);
    const current = this.requireAccess(user, workspaceId);
    const at = nowIso(now);
    const next: WorkspaceRecord = {
      ...current,
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.description === undefined ? {} : { description: input.description }),
      description_version: input.description !== undefined ? current.description_version + 1 : current.description_version,
      description_hash: input.description !== undefined ? stableHash(input.description) : current.description_hash,
      updated_at: at,
    };
    transaction(this.db, () => {
      this.workspaces.update(next);
      this.audit.record({
        entityType: 'workspace', entityId: workspaceId, action: 'workspace.updated', actor: user.name,
        before: { name: current.name, description: current.description, description_version: current.description_version },
        after: { name: next.name, description: next.description, description_version: next.description_version }, traceId, at,
      });
    });
    return next;
  }

  async validateRepository(repositoryId: string, user: User, traceId: string, now = new Date()): Promise<RepositoryDiscovery> {
    requireRole(user, ['admin', 'reviewer']);
    const repository = this.requireRepository(repositoryId);
    this.requireAccess(user, repository.workspace_id);
    const at = nowIso(now);
    this.workspaces.setRepositoryHealth(repository.id, 'unknown', '正在检查仓库连通性与权限', at);
    try {
      const discovery = await this.plugin.validateRepository(this.repositoryPayload(repository, traceId));
      const needsChangeRequests = discovery.provider === 'github' || discovery.provider === 'gitlab' || discovery.provider === 'gitea';
      const ready = discovery.permissions.read && discovery.permissions.push && (!needsChangeRequests || discovery.permissions.change_requests);
      const state = ready ? 'ready' : 'error';
      this.workspaces.setRepositoryHealth(repository.id, state, ready ? '连通性、读取与交付权限检查通过' : '仓库权限不完整，请检查凭据引用', at);
      this.audit.record({
        entityType: 'repository', entityId: repository.id, action: 'repository.validated', actor: user.name,
        before: { status: repository.status, health_state: repository.health_state },
        after: { status: state === 'ready' ? 'ready' : 'error', discovery }, traceId, at, workspaceId: repository.workspace_id,
      });
      return discovery;
    } catch (error) {
      this.workspaces.setRepositoryHealth(repository.id, 'error', this.redactError(error), at);
      throw error;
    }
  }

  async describeRepository(repositoryId: string, user: User, traceId: string, now = new Date()): Promise<RepositoryDescriptionSuggestion> {
    requireRole(user, ['admin', 'reviewer']);
    const repository = this.requireRepository(repositoryId);
    this.requireAccess(user, repository.workspace_id);
    const suggestion = await this.plugin.describeRepository(this.repositoryPayload(repository, traceId));
    this.audit.record({
      entityType: 'repository', entityId: repository.id, action: 'repository.description_generated', actor: user.name,
      before: null, after: { source_fingerprint: suggestion.source_fingerprint, model: suggestion.model },
      traceId, at: nowIso(now), workspaceId: repository.workspace_id,
    });
    return suggestion;
  }

  confirmDescription(repositoryId: string, input: RepositoryDescriptionConfirmation, user: User, traceId: string,
    now = new Date()): WorkspaceRepositoryRecord {
    requireRole(user, ['admin']);
    const repository = this.requireRepository(repositoryId);
    this.requireAccess(user, repository.workspace_id);
    const at = nowIso(now);
    const descriptionVersion = repository.description_version + 1;
    const descriptionHash = stableHash({
      short_description: input.short_description,
      capabilities: input.capabilities,
      routing_keywords: input.routing_keywords,
      exclusions: input.exclusions,
      confidence: input.confidence,
      version: descriptionVersion,
    });
    let updated!: WorkspaceRepositoryRecord;
    transaction(this.db, () => {
      updated = this.workspaces.updateRepository({
        ...this.toRepositoryInput(repository),
        description: input.short_description,
        shortDescription: input.short_description,
        capabilities: input.capabilities,
        routingKeywords: input.routing_keywords,
        exclusions: input.exclusions,
        confidence: input.confidence,
        descriptionVersion,
        descriptionHash,
        sourceFingerprint: input.source_fingerprint ?? repository.source_fingerprint,
        generatedAt: input.generated_at ?? repository.generated_at ?? at,
        confirmedBy: user.name,
        confirmedAt: at,
        status: 'ready',
        updatedAt: at,
      });
      this.invalidateRepositoryApprovals(repository, '仓库描述已确认新版本', user.name, traceId, at);
      this.workspaces.setStatus(repository.workspace_id, 'active', at);
      this.audit.record({
        entityType: 'repository', entityId: repository.id, action: 'repository.description_confirmed', actor: user.name,
        before: { description_hash: repository.description_hash, description_version: repository.description_version },
        after: { description_hash: descriptionHash, description_version: descriptionVersion,
          capabilities: input.capabilities, routing_keywords: input.routing_keywords },
        traceId, at, workspaceId: repository.workspace_id,
      });
    });
    return updated;
  }

  async syncWorkspaces(user: User, traceId: string, now = new Date()): Promise<{
    applied: number; disabled: number; config_version: number; config_hash: string; replayed: boolean;
  }> {
    requireRole(user, ['admin']);
    const workspaces = this.workspaces.list(user);
    const version = Math.max(0, ...this.workspaces.bindings().map((binding) => binding.config_version)) + 1;
    const payloadWorkspaces: PluginWorkspaceSyncWorkspace[] = [];
    for (const workspace of workspaces) {
      for (const repository of workspace.repositories) {
        const binding = this.workspaces.bindingForRepository(repository.id);
        payloadWorkspaces.push({
          ...this.repositoryPayload(repository, traceId),
          workspace_slug: workspace.slug,
          workspace_name: workspace.name,
          workspace_status: workspace.status,
          description: repository.short_description || repository.description,
          description_version: repository.description_version,
          description_hash: repository.description_hash,
          short_description: repository.short_description,
          capabilities: repository.capabilities,
          routing_keywords: repository.routing_keywords,
          exclusions: repository.exclusions,
          confidence: repository.confidence,
          source_instance_id: binding?.source_instance_id ?? this.sourceInstanceId(workspace.slug, repository),
        });
      }
    }
    const configHash = stableHash(payloadWorkspaces);
    const result = await this.plugin.syncWorkspaces({
      trace_id: traceId,
      idempotency_key: `workspace-sync:${configHash}`,
      config_version: version,
      config_hash: configHash,
      workspaces: payloadWorkspaces,
    });
    const at = nowIso(now);
    transaction(this.db, () => {
      for (const item of payloadWorkspaces) {
        const existing = this.workspaces.bindingForRepository(item.repository_id);
        const binding: WorkspaceSourceBindingRecord = {
          id: existing?.id ?? newId('binding'),
          workspace_id: item.workspace_id,
          repository_id: item.repository_id,
          provider: item.provider,
          source_instance_id: item.source_instance_id,
          config_version: result.config_version,
          applied_config_hash: result.config_hash,
          enabled: item.workspace_status === 'active' || item.workspace_status === 'onboarding',
          last_synced_at: at,
          health: result.replayed ? (existing?.health ?? {}) : { state: 'ready', checked_at: at },
        };
        this.workspaces.upsertBinding(binding);
      }
      this.audit.record({
        entityType: 'system', entityId: 'workspace-sync', action: 'workspaces.synced', actor: user.name,
        before: null, after: { config_version: result.config_version, config_hash: result.config_hash,
          repositories: payloadWorkspaces.length, replayed: result.replayed }, traceId, at,
      });
    });
    return result;
  }

  async disable(workspaceId: string, user: User, traceId: string, now = new Date()): Promise<WorkspaceRecord> {
    requireRole(user, ['admin']);
    const workspace = this.requireAccess(user, workspaceId);
    const at = nowIso(now);
    transaction(this.db, () => {
      this.workspaces.setStatus(workspace.id, 'disabled', at);
      this.invalidateWorkspaceApprovals(workspace.id, '工作区已停用', user.name, traceId, at);
      this.audit.record({
        entityType: 'workspace', entityId: workspace.id, action: 'workspace.disabled', actor: user.name,
        before: { status: workspace.status }, after: { status: 'disabled' }, traceId, at,
      });
    });
    await this.syncWorkspaces(user, traceId, now);
    return this.workspaces.get(workspace.id)!;
  }

  async reassignProposal(proposalId: string, input: RoutingReassignInput, user: User, traceId: string,
    now = new Date()): Promise<void> {
    requireRole(user, ['reviewer', 'admin']);
    const proposal = this.db.prepare('SELECT * FROM proposals WHERE id = ?').get(proposalId) as {
      id: string; review_case_id: string; workspace_id: string | null; repository_id: string | null;
      workspace_binding_hash: string | null; status: string;
    } | undefined;
    if (!proposal) throw new NotFoundError('提案', proposalId);
    if (!['pending_review', 'info_requested', 'approved', 'scheduled'].includes(proposal.status)) {
      throw new DomainError('PROPOSAL_NOT_REASSIGNABLE', '执行开始后不能改派工作区', '先撤回执行或等待当前流程结束', 409);
    }
    this.requireAccess(user, input.workspace_id);
    const workspace = this.workspaces.get(input.workspace_id)!;
    if (workspace.status === 'disabled') {
      throw new DomainError('WORKSPACE_DISABLED', '目标工作区已停用', '选择其他工作区', 409);
    }
    if (input.repository_id) {
      const repository = this.workspaces.repository(input.repository_id);
      if (!repository || repository.workspace_id !== input.workspace_id) {
        throw new DomainError('REPOSITORY_BINDING_INVALID', '目标仓库不属于所选工作区', '重新选择仓库', 400);
      }
      if (repository.status !== 'ready') {
        throw new DomainError('REPOSITORY_NOT_READY', '目标仓库尚未完成描述确认', '先完成仓库接入流程', 409);
      }
    }
    const caseRow = this.db.prepare('SELECT routing_decision_id, workspace_id FROM review_cases WHERE id = ?')
      .get(proposal.review_case_id) as { routing_decision_id: string | null; workspace_id: string | null } | undefined;
    const currentWorkspaceId = proposal.workspace_id ?? caseRow?.workspace_id ?? null;
    if (currentWorkspaceId) this.requireAccess(user, currentWorkspaceId);
    const at = nowIso(now);
    const bindingHash = this.workspaceBindingHash(input.workspace_id, input.repository_id);
    await this.plugin.reassignProposal({
      proposal_id: proposalId,
      workspace_id: input.workspace_id,
      repository_id: input.repository_id,
      reason: input.reason,
      trace_id: traceId,
      idempotency_key: `route:${stableHash({ proposalId, workspaceId: input.workspace_id,
        repositoryId: input.repository_id, reason: input.reason })}`,
    });
    const decisionId = caseRow?.routing_decision_id ?? newId('routing');
    transaction(this.db, () => {
      const existing = this.workspaces.routingDecision(decisionId);
      if (existing) {
        this.workspaces.overrideRoutingDecision(decisionId, input.workspace_id, input.repository_id,
          user.name, input.reason, at);
      } else {
        this.workspaces.createRoutingDecision({
          id: decisionId,
          workspaceId: input.workspace_id,
          repositoryId: input.repository_id,
          source: 'manual',
          mode: 'manual',
          confidence: 1,
          reason: input.reason,
          candidates: [],
          requiresHuman: false,
          createdAt: at,
        });
      }
      this.db.prepare(`
        UPDATE proposals SET workspace_id = ?, repository_id = ?, workspace_binding_hash = ?,
          status = 'pending_review', updated_at = ? WHERE id = ?
      `).run(input.workspace_id, input.repository_id, bindingHash, at, proposal.id);
      this.db.prepare(`
        UPDATE review_cases SET workspace_id = ?, repository_id = ?, routing_decision_id = ?,
          status = 'pending_review', updated_at = ? WHERE id = ?
      `).run(input.workspace_id, input.repository_id, decisionId, at, proposal.review_case_id);
      this.db.prepare("UPDATE approval_grants SET status = 'revoked' WHERE proposal_id = ? AND status = 'active'")
        .run(proposal.id);
      this.db.prepare("UPDATE schedules SET status = 'cancelled', last_error = ?, updated_at = ? WHERE proposal_id = ? AND status IN ('scheduled', 'paused')")
        .run('工作区已由复核人改派', at, proposal.id);
      this.audit.record({
        entityType: 'review_case', entityId: proposal.review_case_id, action: 'routing.reassigned', actor: user.name,
        before: { workspace_id: proposal.workspace_id, repository_id: proposal.repository_id,
          routing_decision_id: caseRow?.routing_decision_id ?? null },
        after: { workspace_id: input.workspace_id, repository_id: input.repository_id,
          routing_decision_id: decisionId, reason: input.reason }, traceId, at, workspaceId: input.workspace_id,
      });
    });
  }

  members(workspaceId: string, user: User): Array<{ user_id: string }> {
    requireRole(user, ['admin']);
    this.requireAccess(user, workspaceId);
    return this.workspaces.memberIds(workspaceId).map((userId) => ({ user_id: userId }));
  }

  addMember(workspaceId: string, userId: string, user: User, traceId: string, now = new Date()): void {
    requireRole(user, ['admin']);
    this.requireAccess(user, workspaceId);
    const at = nowIso(now);
    this.workspaces.addMember(workspaceId, userId, at);
    this.audit.record({
      entityType: 'workspace', entityId: workspaceId, action: 'workspace.member_added', actor: user.name,
      before: null, after: { user_id: userId }, traceId, at, workspaceId,
    });
  }

  removeMember(workspaceId: string, userId: string, user: User, traceId: string, now = new Date()): void {
    requireRole(user, ['admin']);
    this.requireAccess(user, workspaceId);
    const at = nowIso(now);
    this.workspaces.removeMember(workspaceId, userId);
    this.audit.record({
      entityType: 'workspace', entityId: workspaceId, action: 'workspace.member_removed', actor: user.name,
      before: { user_id: userId }, after: null, traceId, at, workspaceId,
    });
  }

  ensureLegacyWorkspace(traceId: string, now = new Date()): WorkspaceRecord {
    const existing = this.workspaces.get('workspace_legacy');
    if (existing) return existing;
    const at = nowIso(now);
    const workspace: WorkspaceRecord = {
      id: 'workspace_legacy', name: '历史数据', slug: 'legacy', description: '接收未携带工作区信息的旧版事件。',
      description_version: 1, description_hash: null, status: 'onboarding', created_at: at, updated_at: at,
    };
    transaction(this.db, () => {
      this.workspaces.create(workspace);
      this.audit.record({
        entityType: 'workspace', entityId: workspace.id, action: 'workspace.legacy_created', actor: 'system',
        before: null, after: { status: workspace.status }, traceId, at,
      });
    });
    return workspace;
  }

  repositoryForEvent(workspaceId: string, repositoryId: string | null): WorkspaceRepositoryRecord | null {
    if (!repositoryId) return null;
    const repository = this.workspaces.repository(repositoryId);
    return repository?.workspace_id === workspaceId ? repository : null;
  }

  workspaceBindingHash(workspaceId: string | null, repositoryId: string | null): string | null {
    if (!workspaceId) return null;
    const repository = repositoryId ? this.workspaces.repository(repositoryId) : null;
    return stableHash({
      workspace_id: workspaceId,
      repository_id: repositoryId,
      description_hash: repository?.description_hash ?? null,
    });
  }

  private createRepositoryRecord(workspaceId: string, input: RepositoryConfigInput,
    user: User, at: string): WorkspaceRepositoryRecord {
    const descriptionHash = stableHash({ repository_key: input.repository_key, description: '', version: 1 });
    return this.workspaces.createRepository({
      id: newId('repository'),
      workspaceId,
      provider: input.provider,
      repositoryKey: input.repository_key,
      apiBaseUrl: input.api_base_url,
      webBaseUrl: input.web_base_url,
      cloneUrl: input.clone_url,
      defaultBranch: input.default_branch,
      credentialRef: this.validateCredentialRef(input.credential_ref),
      customCaRef: input.custom_ca_ref,
      observe: input.observe,
      description: '',
      shortDescription: '',
      capabilities: [],
      routingKeywords: [],
      exclusions: [],
      confidence: 0,
      descriptionVersion: 1,
      descriptionHash,
      sourceFingerprint: null,
      generatedAt: null,
      confirmedBy: null,
      confirmedAt: null,
      status: 'pending',
      createdAt: at,
      updatedAt: at,
    });
  }

  private requireRepository(repositoryId: string): WorkspaceRepositoryRecord {
    const repository = this.workspaces.repository(repositoryId);
    if (!repository) throw new NotFoundError('仓库', repositoryId);
    return repository;
  }

  private repositoryPayload(repository: WorkspaceRepositoryRecord, traceId: string) {
    return {
      workspace_id: repository.workspace_id,
      repository_id: repository.id,
      provider: repository.provider,
      repository_key: repository.repository_key,
      api_base_url: repository.api_base_url,
      web_base_url: repository.web_base_url,
      clone_url: repository.clone_url,
      default_branch: repository.default_branch,
      credential_ref: repository.credential_ref,
      custom_ca_ref: repository.custom_ca_ref,
      observe: repository.observe,
      trace_id: traceId,
      idempotency_key: `repository:${repository.id}:${repository.updated_at}`,
    };
  }

  private toRepositoryInput(repository: WorkspaceRepositoryRecord): WorkspaceRepositoryInput {
    return {
      id: repository.id, workspaceId: repository.workspace_id, provider: repository.provider,
      repositoryKey: repository.repository_key, apiBaseUrl: repository.api_base_url, webBaseUrl: repository.web_base_url,
      cloneUrl: repository.clone_url, defaultBranch: repository.default_branch, credentialRef: repository.credential_ref,
      customCaRef: repository.custom_ca_ref, observe: repository.observe, description: repository.description,
      shortDescription: repository.short_description, capabilities: repository.capabilities,
      routingKeywords: repository.routing_keywords, exclusions: repository.exclusions, confidence: repository.confidence,
      descriptionVersion: repository.description_version, descriptionHash: repository.description_hash,
      sourceFingerprint: repository.source_fingerprint, generatedAt: repository.generated_at,
      confirmedBy: repository.confirmed_by, confirmedAt: repository.confirmed_at, status: repository.status,
      createdAt: repository.created_at, updatedAt: repository.updated_at,
    };
  }

  private sourceInstanceId(slug: string, repository: WorkspaceRepositoryRecord): string {
    const suffix = stableHash(repository.id).slice('sha256:'.length, 'sha256:'.length + 8);
    return `${repository.provider}-${slug}-${suffix}`.toLowerCase().replace(/[^a-z0-9-]/g, '-');
  }

  private validateCredentialRef(value: string): string {
    const ref = value.trim();
    if (!ref) return '';
    if (!/^(env|file):[A-Za-z0-9_./:@-]+$/.test(ref)) {
      throw new DomainError('INVALID_CREDENTIAL_REF', '凭据字段只能填写引用名', '使用 env:变量名或 file:受控路径', 400);
    }
    return ref;
  }

  private validateWorkspaceUrls(input: { api_base_url: string | null; web_base_url: string; clone_url: string } | null): void {
    if (!input) return;
    for (const value of [input.api_base_url, input.web_base_url, input.clone_url].filter((item): item is string => !!item)) {
      if (value.startsWith('git@')) throw new DomainError('UNSUPPORTED_CLONE_URL', '当前版本不接受内联 SSH 凭据', '改用 HTTPS 克隆地址并在 DSH 中配置凭据引用', 400);
      let url: URL;
      try { url = new URL(value); } catch { throw new DomainError('INVALID_REPOSITORY_URL', '仓库地址格式无效', '填写完整 URL', 400); }
      if (url.protocol !== 'https:' && url.protocol !== 'http:') {
        throw new DomainError('INVALID_REPOSITORY_PROTOCOL', '仓库地址只支持 HTTP 或 HTTPS', '检查 Provider 地址', 400);
      }
      if (url.username || url.password) {
        throw new DomainError('INLINE_CREDENTIALS_FORBIDDEN', '仓库地址不能包含账号或密码', '改用凭据引用', 400);
      }
      if (url.protocol === 'http:' && !this.isPrivateHost(url.hostname)) {
        throw new DomainError('INSECURE_REPOSITORY_URL', '公网仓库必须使用 HTTPS', '启用 TLS 后重试', 400);
      }
      const host = url.hostname.toLowerCase();
      const privateHost = this.isPrivateHost(host);
      if (privateHost && !this.config.allowPrivateRepositoryHosts) {
        throw new DomainError('PRIVATE_REPOSITORY_HOST_BLOCKED', '当前配置禁止访问内网仓库地址', '由管理员配置允许列表并启用内网仓库支持', 400);
      }
      if (!KNOWN_PUBLIC_GIT_HOSTS.has(host) && !this.config.repositoryHostAllowlist.includes(host)) {
        throw new DomainError('REPOSITORY_HOST_NOT_ALLOWED', `自建仓库主机 ${host} 必须先加入允许列表`, `允许列表：${this.config.repositoryHostAllowlist.join(', ') || '未配置'}`, 400);
      }
      if (!KNOWN_PUBLIC_GIT_HOSTS.has(host) && !this.config.allowPrivateRepositoryHosts) {
        throw new DomainError('PRIVATE_REPOSITORY_HOST_BLOCKED', '当前配置禁止访问自建或内网仓库地址', '启用自建仓库支持并把主机加入允许列表', 400);
      }
    }
  }

  private isPrivateHost(hostname: string): boolean {
    const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
    if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal')) return true;
    if (isIP(host) === 4) return PRIVATE_IPV4.some((pattern) => pattern.test(host));
    if (isIP(host) === 6) return host === '::1' || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80:');
    return false;
  }

  private invalidateRepositoryApprovals(repository: WorkspaceRepositoryRecord, reason: string, actor: string, traceId: string, at: string): void {
    const rows = this.db.prepare(`
      SELECT p.id AS proposal_id, p.review_case_id, g.id AS grant_id, s.id AS schedule_id
      FROM proposals p LEFT JOIN approval_grants g ON g.proposal_id = p.id AND g.status = 'active'
      LEFT JOIN schedules s ON s.proposal_id = p.id AND s.status IN ('scheduled', 'paused')
      WHERE p.workspace_id = ? AND p.repository_id = ?
    `).all(repository.workspace_id, repository.id) as Array<{
      proposal_id: string; review_case_id: string; grant_id: string | null; schedule_id: string | null;
    }>;
    for (const row of rows) {
      if (row.grant_id) this.db.prepare("UPDATE approval_grants SET status = 'revoked' WHERE id = ? AND status = 'active'").run(row.grant_id);
      if (row.schedule_id) this.db.prepare("UPDATE schedules SET status = 'cancelled', last_error = ?, updated_at = ? WHERE id = ?")
        .run(reason, at, row.schedule_id);
      this.db.prepare('UPDATE proposals SET status = ?, updated_at = ? WHERE id = ?').run('pending_review', at, row.proposal_id);
      this.db.prepare('UPDATE review_cases SET status = ?, updated_at = ? WHERE id = ?').run('pending_review', at, row.review_case_id);
      this.audit.record({
        entityType: 'review_case', entityId: row.review_case_id, action: 'workspace.binding_invalidated', actor,
        before: { grant_id: row.grant_id, schedule_id: row.schedule_id },
        after: { status: 'pending_review', reason }, traceId, at, workspaceId: repository.workspace_id,
      });
    }
  }

  private invalidateWorkspaceApprovals(workspaceId: string, reason: string, actor: string, traceId: string, at: string): void {
    const rows = this.db.prepare(`
      SELECT p.id AS proposal_id, p.review_case_id, g.id AS grant_id, s.id AS schedule_id
      FROM proposals p LEFT JOIN approval_grants g ON g.proposal_id = p.id AND g.status = 'active'
      LEFT JOIN schedules s ON s.proposal_id = p.id AND s.status IN ('scheduled', 'paused')
      WHERE p.workspace_id = ?
    `).all(workspaceId) as Array<{ proposal_id: string; review_case_id: string; grant_id: string | null; schedule_id: string | null }>;
    for (const row of rows) {
      if (row.grant_id) this.db.prepare("UPDATE approval_grants SET status = 'revoked' WHERE id = ? AND status = 'active'").run(row.grant_id);
      if (row.schedule_id) this.db.prepare("UPDATE schedules SET status = 'cancelled', last_error = ?, updated_at = ? WHERE id = ?")
        .run(reason, at, row.schedule_id);
      this.db.prepare('UPDATE proposals SET status = ?, updated_at = ? WHERE id = ? AND status IN (?, ?, ?)')
        .run('pending_review', at, row.proposal_id, 'approved', 'scheduled', 'executing');
      this.db.prepare('UPDATE review_cases SET status = ?, updated_at = ? WHERE id = ?').run('pending_review', at, row.review_case_id);
      this.audit.record({
        entityType: 'review_case', entityId: row.review_case_id, action: 'workspace.disabled', actor,
        before: { status: 'active' }, after: { status: 'pending_review', reason }, traceId, at, workspaceId,
      });
    }
  }

  private redactError(error: unknown): string {
    const text = error instanceof Error ? error.message : String(error);
    return text.replace(/\b(?:gh[pousr]_|glpat-|Bearer\s+)[A-Za-z0-9._-]+/g, '[redacted]').slice(0, 500);
  }
}

export function roleMayViewWorkspace(role: Role): boolean {
  return role === 'viewer' || role === 'reviewer' || role === 'admin';
}
