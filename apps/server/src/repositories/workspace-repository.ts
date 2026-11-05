import type {
  RepositoryObservationConfig,
  RepositoryProvider,
  RepositoryStatus,
  RoutingDecisionRecord,
  Source,
  User,
  WorkspaceListItem,
  WorkspaceRecord,
  WorkspaceRepositoryRecord,
  WorkspaceSourceBindingRecord,
  WorkspaceStatus,
} from '@gatehouse/contract';
import type { Database } from '../db/database.js';
import { parseJson } from '../domain/utils.js';

type WorkspaceRow = Omit<WorkspaceRecord, never>;
type RepositoryRow = Omit<WorkspaceRepositoryRecord, 'observe' | 'capabilities' | 'routing_keywords' | 'exclusions'> & {
  observe_json: string;
  capabilities_json: string;
  routing_keywords_json: string;
  exclusions_json: string;
};
type BindingRow = Omit<WorkspaceSourceBindingRecord, 'enabled' | 'health'> & { enabled: number; health_json: string };
type RoutingRow = Omit<RoutingDecisionRecord, 'candidates' | 'requires_human'> & { candidates_json: string; requires_human: number };

export interface WorkspaceRepositoryInput {
  id: string;
  workspaceId: string;
  provider: RepositoryProvider;
  repositoryKey: string;
  apiBaseUrl: string | null;
  webBaseUrl: string;
  cloneUrl: string;
  defaultBranch: string;
  credentialRef: string;
  customCaRef: string | null;
  observe: RepositoryObservationConfig;
  description: string;
  shortDescription: string;
  capabilities: string[];
  routingKeywords: string[];
  exclusions: string[];
  confidence: number;
  descriptionVersion: number;
  descriptionHash: string;
  sourceFingerprint: string | null;
  generatedAt: string | null;
  confirmedBy: string | null;
  confirmedAt: string | null;
  status: RepositoryStatus;
  createdAt: string;
  updatedAt: string;
}

export interface RoutingDecisionInput {
  id: string;
  workspaceId: string | null;
  repositoryId: string | null;
  source: Source;
  mode: RoutingDecisionRecord['mode'];
  confidence: number | null;
  reason: string;
  candidates: RoutingDecisionRecord['candidates'];
  requiresHuman: boolean;
  createdAt: string;
}

/** Workspace metadata, repository bindings, route evidence and member access live in one repository. */
export class WorkspaceStore {
  constructor(private readonly db: Database) {}

  list(user: Pick<User, 'id' | 'permissions'>): WorkspaceListItem[] {
    const rows = user.permissions.includes('workspace.manage')
      ? this.db.prepare('SELECT * FROM workspaces ORDER BY created_at ASC').all() as WorkspaceRow[]
      : this.db.prepare(`
          SELECT w.* FROM workspaces w
          JOIN workspace_memberships m ON m.workspace_id = w.id
          WHERE m.user_id = ? ORDER BY w.created_at ASC
        `).all(user.id) as WorkspaceRow[];
    return rows.map((row) => this.listItem(row));
  }

  get(id: string): WorkspaceRecord | null {
    const row = this.db.prepare('SELECT * FROM workspaces WHERE id = ?').get(id) as WorkspaceRow | undefined;
    return row ? { ...row } : null;
  }

  getBySlug(slug: string): WorkspaceRecord | null {
    const row = this.db.prepare('SELECT * FROM workspaces WHERE slug = ?').get(slug) as WorkspaceRow | undefined;
    return row ? { ...row } : null;
  }

  create(input: WorkspaceRecord): WorkspaceRecord {
    this.db.prepare(`
      INSERT INTO workspaces(id, name, slug, description, description_version, description_hash, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(input.id, input.name, input.slug, input.description, input.description_version,
      input.description_hash, input.status, input.created_at, input.updated_at);
    return input;
  }

  update(input: WorkspaceRecord): void {
    this.db.prepare(`
      UPDATE workspaces SET name = ?, description = ?, description_version = ?, description_hash = ?,
        status = ?, updated_at = ? WHERE id = ?
    `).run(input.name, input.description, input.description_version, input.description_hash,
      input.status, input.updated_at, input.id);
  }

  setStatus(id: string, status: WorkspaceStatus, at: string): void {
    this.db.prepare('UPDATE workspaces SET status = ?, updated_at = ? WHERE id = ?').run(status, at, id);
  }

  repositories(workspaceId: string): WorkspaceRepositoryRecord[] {
    const rows = this.db.prepare('SELECT * FROM workspace_repositories WHERE workspace_id = ? ORDER BY created_at ASC')
      .all(workspaceId) as RepositoryRow[];
    return rows.map((row) => this.mapRepository(row));
  }

  repository(id: string): WorkspaceRepositoryRecord | null {
    const row = this.db.prepare('SELECT * FROM workspace_repositories WHERE id = ?').get(id) as RepositoryRow | undefined;
    return row ? this.mapRepository(row) : null;
  }

  findRepositoryForWorkspace(workspaceId: string): WorkspaceRepositoryRecord | null {
    const row = this.db.prepare('SELECT * FROM workspace_repositories WHERE workspace_id = ? ORDER BY created_at ASC LIMIT 1')
      .get(workspaceId) as RepositoryRow | undefined;
    return row ? this.mapRepository(row) : null;
  }

  createRepository(input: WorkspaceRepositoryInput): WorkspaceRepositoryRecord {
    this.db.prepare(`
      INSERT INTO workspace_repositories(
        id, workspace_id, provider, repository_key, api_base_url, web_base_url, clone_url, default_branch,
        credential_ref, custom_ca_ref, observe_json, description, short_description, capabilities_json,
        routing_keywords_json, exclusions_json, confidence, description_version, description_hash,
        source_fingerprint, generated_at, confirmed_by, confirmed_at, status, health_state, health_detail,
        health_checked_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'unknown', '', NULL, ?, ?)
    `).run(input.id, input.workspaceId, input.provider, input.repositoryKey, input.apiBaseUrl,
      input.webBaseUrl, input.cloneUrl, input.defaultBranch, input.credentialRef, input.customCaRef,
      JSON.stringify(input.observe), input.description, input.shortDescription, JSON.stringify(input.capabilities),
      JSON.stringify(input.routingKeywords), JSON.stringify(input.exclusions), input.confidence,
      input.descriptionVersion, input.descriptionHash, input.sourceFingerprint, input.generatedAt,
      input.confirmedBy, input.confirmedAt, input.status, input.createdAt, input.updatedAt);
    return this.repository(input.id)!;
  }

  updateRepository(input: WorkspaceRepositoryInput): WorkspaceRepositoryRecord {
    this.db.prepare(`
      UPDATE workspace_repositories SET api_base_url = ?, web_base_url = ?, clone_url = ?, default_branch = ?,
        credential_ref = ?, custom_ca_ref = ?, observe_json = ?, description = ?, short_description = ?,
        capabilities_json = ?, routing_keywords_json = ?, exclusions_json = ?, confidence = ?,
        description_version = ?, description_hash = ?, source_fingerprint = ?, generated_at = ?,
        confirmed_by = ?, confirmed_at = ?, status = ?, updated_at = ? WHERE id = ?
    `).run(input.apiBaseUrl, input.webBaseUrl, input.cloneUrl, input.defaultBranch, input.credentialRef,
      input.customCaRef, JSON.stringify(input.observe), input.description, input.shortDescription,
      JSON.stringify(input.capabilities), JSON.stringify(input.routingKeywords), JSON.stringify(input.exclusions),
      input.confidence, input.descriptionVersion, input.descriptionHash, input.sourceFingerprint,
      input.generatedAt, input.confirmedBy, input.confirmedAt, input.status, input.updatedAt, input.id);
    return this.repository(input.id)!;
  }

  setRepositoryHealth(id: string, state: WorkspaceRepositoryRecord['health_state'], detail: string, at: string): void {
    this.db.prepare('UPDATE workspace_repositories SET health_state = ?, health_detail = ?, health_checked_at = ?, updated_at = ? WHERE id = ?')
      .run(state, detail, at, at, id);
  }

  bindings(workspaceId?: string): WorkspaceSourceBindingRecord[] {
    const rows = (workspaceId
      ? this.db.prepare('SELECT * FROM workspace_source_bindings WHERE workspace_id = ? ORDER BY source_instance_id').all(workspaceId)
      : this.db.prepare('SELECT * FROM workspace_source_bindings ORDER BY source_instance_id').all()) as BindingRow[];
    return rows.map((row) => ({ ...row,
      enabled: row.enabled === 1, health: parseJson<Record<string, unknown>>(row.health_json, {}) }));
  }

  bindingForRepository(repositoryId: string): WorkspaceSourceBindingRecord | null {
    const row = this.db.prepare('SELECT * FROM workspace_source_bindings WHERE repository_id = ?')
      .get(repositoryId) as BindingRow | undefined;
    return row ? { ...row, enabled: row.enabled === 1, health: parseJson<Record<string, unknown>>(row.health_json, {}) } : null;
  }

  upsertBinding(input: WorkspaceSourceBindingRecord): void {
    this.db.prepare(`
      INSERT INTO workspace_source_bindings(id, workspace_id, repository_id, provider, source_instance_id,
        config_version, applied_config_hash, enabled, last_synced_at, health_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET workspace_id = excluded.workspace_id, repository_id = excluded.repository_id,
        provider = excluded.provider, source_instance_id = excluded.source_instance_id,
        config_version = excluded.config_version, applied_config_hash = excluded.applied_config_hash,
        enabled = excluded.enabled, last_synced_at = excluded.last_synced_at, health_json = excluded.health_json
    `).run(input.id, input.workspace_id, input.repository_id, input.provider, input.source_instance_id,
      input.config_version, input.applied_config_hash, input.enabled ? 1 : 0, input.last_synced_at,
      JSON.stringify(input.health));
  }

  createRoutingDecision(input: RoutingDecisionInput): RoutingDecisionRecord {
    this.db.prepare(`
      INSERT INTO routing_decisions(id, workspace_id, repository_id, source, mode, confidence, reason,
        candidates_json, requires_human, overridden_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)
    `).run(input.id, input.workspaceId, input.repositoryId, input.source, input.mode, input.confidence,
      input.reason, JSON.stringify(input.candidates), input.requiresHuman ? 1 : 0, input.createdAt);
    return this.routingDecision(input.id)!;
  }

  routingDecision(id: string): RoutingDecisionRecord | null {
    const row = this.db.prepare('SELECT * FROM routing_decisions WHERE id = ?').get(id) as RoutingRow | undefined;
    return row ? { ...row, candidates: parseJson(row.candidates_json, []), requires_human: row.requires_human === 1 } : null;
  }

  overrideRoutingDecision(id: string, workspaceId: string, repositoryId: string | null,
    actor: string, reason: string, at: string): RoutingDecisionRecord {
    this.db.prepare(`
      UPDATE routing_decisions SET workspace_id = ?, repository_id = ?, mode = 'manual', confidence = 1,
        reason = ?, requires_human = 0, overridden_by = ?, created_at = ? WHERE id = ?
    `).run(workspaceId, repositoryId, reason, actor, at, id);
    return this.routingDecision(id)!;
  }

  canAccess(user: Pick<User, 'id' | 'permissions'>, workspaceId: string): boolean {
    if (user.permissions.includes('workspace.manage')) return true;
    return !!this.db.prepare('SELECT 1 FROM workspace_memberships WHERE workspace_id = ? AND user_id = ?')
      .get(workspaceId, user.id);
  }

  addMember(workspaceId: string, userId: string, at: string): void {
    this.db.prepare('INSERT OR IGNORE INTO workspace_memberships(workspace_id, user_id, created_at) VALUES (?, ?, ?)')
      .run(workspaceId, userId, at);
  }

  removeMember(workspaceId: string, userId: string): void {
    this.db.prepare('DELETE FROM workspace_memberships WHERE workspace_id = ? AND user_id = ?').run(workspaceId, userId);
  }

  memberIds(workspaceId: string): string[] {
    return (this.db.prepare('SELECT user_id FROM workspace_memberships WHERE workspace_id = ? ORDER BY user_id')
      .all(workspaceId) as Array<{ user_id: string }>).map((row) => row.user_id);
  }

  openTaskCount(workspaceId: string): number {
    const row = this.db.prepare(`
      SELECT COUNT(*) AS count FROM review_cases
      WHERE workspace_id = ? AND status IN ('pending_review', 'info_requested', 'approved', 'scheduled', 'executing')
    `).get(workspaceId) as { count: number };
    return row.count;
  }

  defaultWorkspace(): WorkspaceRecord | null {
    const row = this.db.prepare("SELECT * FROM workspaces WHERE status IN ('active', 'onboarding') ORDER BY created_at ASC LIMIT 1")
      .get() as WorkspaceRow | undefined;
    return row ? { ...row } : null;
  }

  private listItem(row: WorkspaceRow): WorkspaceListItem {
    return { ...row, repositories: this.repositories(row.id), source_bindings: this.bindings(row.id),
      open_tasks: this.openTaskCount(row.id) };
  }

  private mapRepository(row: RepositoryRow): WorkspaceRepositoryRecord {
    return { ...row, observe: parseJson<RepositoryObservationConfig>(row.observe_json, {
      issues: true, change_requests: true, comments: true, ci: true,
    }), capabilities: parseJson(row.capabilities_json, []), routing_keywords: parseJson(row.routing_keywords_json, []),
    exclusions: parseJson(row.exclusions_json, []) };
  }
}
