import type { ProposalRecord, ProposalStatus } from '@gatehouse/contract';
import type { Database } from '../db/database.js';
import { parseJson } from '../domain/utils.js';

type ProposalRow = {
  id: string; review_case_id: string; assessment_revision: number; summary: string;
  scope_json: string; scope_hash: string; rule_hits_json: string; impact_files_json: string;
  test_plan_json: string; estimated_cost: string; risk: ProposalRecord['risk']; risk_reason: string;
  status: ProposalStatus; workspace_id: string | null; repository_id: string | null;
  workspace_binding_hash: string | null; created_at: string; updated_at: string;
};

/** Persistence boundary for immutable proposal versions. */
export class ProposalRepository {
  constructor(private readonly db: Database) {}

  create(input: ProposalRecord): ProposalRecord {
    this.db.prepare(`
      INSERT INTO proposals
      (id, review_case_id, assessment_revision, summary, scope_json, scope_hash, rule_hits_json,
       impact_files_json, test_plan_json, estimated_cost, risk, risk_reason, status, workspace_id,
       repository_id, workspace_binding_hash, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.id, input.review_case_id, input.assessment_revision, input.summary, JSON.stringify(input.scope),
      input.scope_hash, JSON.stringify(input.rule_hits), JSON.stringify(input.impact_files),
      JSON.stringify(input.test_plan), input.estimated_cost, input.risk, input.risk_reason,
      input.status, input.workspace_id ?? null, input.repository_id ?? null,
      input.workspace_binding_hash ?? null, input.created_at, input.updated_at,
    );
    return input;
  }

  update(input: ProposalRecord): void {
    this.db.prepare(`
      UPDATE proposals SET summary = ?, scope_json = ?, scope_hash = ?, rule_hits_json = ?,
       impact_files_json = ?, test_plan_json = ?, estimated_cost = ?, risk = ?, risk_reason = ?,
       status = ?, workspace_id = ?, repository_id = ?, workspace_binding_hash = ?, updated_at = ? WHERE id = ?
    `).run(
      input.summary, JSON.stringify(input.scope), input.scope_hash, JSON.stringify(input.rule_hits),
      JSON.stringify(input.impact_files), JSON.stringify(input.test_plan), input.estimated_cost,
      input.risk, input.risk_reason, input.status, input.workspace_id ?? null,
      input.repository_id ?? null, input.workspace_binding_hash ?? null, input.updated_at, input.id,
    );
  }

  setStatus(id: string, status: ProposalStatus, updatedAt: string): void {
    this.db.prepare('UPDATE proposals SET status = ?, updated_at = ? WHERE id = ?').run(status, updatedAt, id);
  }

  supersedeOthers(caseId: string, keepId: string, updatedAt: string): void {
    this.db.prepare(`
      UPDATE proposals SET status = 'superseded', updated_at = ?
      WHERE review_case_id = ? AND id != ? AND status IN ('pending_review', 'info_requested')
    `).run(updatedAt, caseId, keepId);
  }

  get(id: string): ProposalRecord | null {
    const row = this.db.prepare('SELECT * FROM proposals WHERE id = ?').get(id) as ProposalRow | undefined;
    return row ? this.map(row) : null;
  }

  latestForCase(caseId: string): ProposalRecord | null {
    const row = this.db.prepare('SELECT * FROM proposals WHERE review_case_id = ? ORDER BY assessment_revision DESC LIMIT 1').get(caseId) as ProposalRow | undefined;
    return row ? this.map(row) : null;
  }

  listForCase(caseId: string): ProposalRecord[] {
    const rows = this.db.prepare('SELECT * FROM proposals WHERE review_case_id = ? ORDER BY assessment_revision DESC').all(caseId) as ProposalRow[];
    return rows.map((row) => this.map(row));
  }

  private map(row: ProposalRow): ProposalRecord {
    return {
      id: row.id,
      review_case_id: row.review_case_id,
      assessment_revision: row.assessment_revision,
      summary: row.summary,
      scope: parseJson<string[]>(row.scope_json, []),
      scope_hash: row.scope_hash,
      rule_hits: parseJson<string[]>(row.rule_hits_json, []),
      impact_files: parseJson<string[]>(row.impact_files_json, []),
      test_plan: parseJson<string[]>(row.test_plan_json, []),
      estimated_cost: row.estimated_cost,
      risk: row.risk,
      risk_reason: row.risk_reason,
      status: row.status,
      workspace_id: row.workspace_id,
      repository_id: row.repository_id,
      workspace_binding_hash: row.workspace_binding_hash,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }
}
