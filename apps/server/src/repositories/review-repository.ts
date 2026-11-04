import type { ReviewCaseRecord, ReviewQueueItem, Source, RiskLevel, CaseStatus } from '@gatehouse/contract';
import type { Database } from '../db/database.js';
import { parseJson } from '../domain/utils.js';

type CaseRow = {
  id: string; plugin_case_id: string; source: Source; requester: string; title: string;
  requirement_text: string; requirement_hash: string; status: CaseStatus; risk_level: RiskLevel;
  source_context: string; message_url: string | null; workspace_id: string | null; repository_id: string | null;
  routing_decision_id: string | null; created_at: string; updated_at: string;
};

type QueueRow = CaseRow & { latest_proposal_summary: string; latest_rule_hits: string };

export interface CaseQuery {
  status?: CaseStatus | undefined;
  risk?: RiskLevel | undefined;
  source?: Source | undefined;
  workspaceId?: string | undefined;
  search?: string | undefined;
  page: number;
  pageSize: number;
}

/** Persistence boundary for review cases. Business rules live in domain services. */
export class ReviewRepository {
  constructor(private readonly db: Database) {}

  create(input: ReviewCaseRecord): ReviewCaseRecord {
    this.db.prepare(`
      INSERT INTO review_cases
      (id, plugin_case_id, source, requester, title, requirement_text, requirement_hash, status,
       risk_level, source_context, message_url, workspace_id, repository_id, routing_decision_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.id, input.plugin_case_id, input.source, input.requester, input.title,
      input.requirement_text, input.requirement_hash, input.status, input.risk_level,
      input.source_context, input.message_url, input.workspace_id ?? null, input.repository_id ?? null,
      input.routing_decision_id ?? null, input.created_at, input.updated_at,
    );
    return input;
  }

  update(input: ReviewCaseRecord): void {
    this.db.prepare(`
      UPDATE review_cases SET source = ?, requester = ?, title = ?, requirement_text = ?,
        requirement_hash = ?, status = ?, risk_level = ?, source_context = ?, message_url = ?,
        workspace_id = ?, repository_id = ?, routing_decision_id = ?, updated_at = ? WHERE id = ?
    `).run(
      input.source, input.requester, input.title, input.requirement_text, input.requirement_hash,
      input.status, input.risk_level, input.source_context, input.message_url, input.workspace_id ?? null,
      input.repository_id ?? null, input.routing_decision_id ?? null, input.updated_at, input.id,
    );
  }

  setStatus(id: string, status: CaseStatus, updatedAt: string): void {
    this.db.prepare('UPDATE review_cases SET status = ?, updated_at = ? WHERE id = ?').run(status, updatedAt, id);
  }

  get(id: string): ReviewCaseRecord | null {
    const row = this.db.prepare('SELECT * FROM review_cases WHERE id = ?').get(id) as CaseRow | undefined;
    return row ? this.map(row) : null;
  }

  getByPluginCaseId(pluginCaseId: string): ReviewCaseRecord | null {
    const row = this.db.prepare('SELECT * FROM review_cases WHERE plugin_case_id = ?').get(pluginCaseId) as CaseRow | undefined;
    return row ? this.map(row) : null;
  }

  getByProposalId(proposalId: string): ReviewCaseRecord | null {
    const row = this.db.prepare(`
      SELECT c.* FROM review_cases c JOIN proposals p ON p.review_case_id = c.id WHERE p.id = ?
    `).get(proposalId) as CaseRow | undefined;
    return row ? this.map(row) : null;
  }

  list(query: CaseQuery): { items: ReviewQueueItem[]; total: number } {
    const conditions: string[] = [];
    const params: Array<string | number> = [];
    if (query.status) { conditions.push('c.status = ?'); params.push(query.status); }
    if (query.risk) { conditions.push('c.risk_level = ?'); params.push(query.risk); }
    if (query.source) { conditions.push('c.source = ?'); params.push(query.source); }
    if (query.workspaceId) { conditions.push('c.workspace_id = ?'); params.push(query.workspaceId); }
    if (query.search) {
      conditions.push('(c.title LIKE ? OR c.requester LIKE ? OR c.requirement_text LIKE ?)');
      const term = `%${query.search}%`; params.push(term, term, term);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const totalRow = this.db.prepare(`SELECT COUNT(*) AS count FROM review_cases c ${where}`).get(...params) as { count: number };
    const rows = this.db.prepare(`
      SELECT c.*,
        COALESCE((SELECT p.summary FROM proposals p WHERE p.review_case_id = c.id ORDER BY p.assessment_revision DESC LIMIT 1), '') AS latest_proposal_summary,
        COALESCE((SELECT p.rule_hits_json FROM proposals p WHERE p.review_case_id = c.id ORDER BY p.assessment_revision DESC LIMIT 1), '[]') AS latest_rule_hits
      FROM review_cases c ${where}
      ORDER BY CASE c.status
        WHEN 'pending_review' THEN 0 WHEN 'info_requested' THEN 1 WHEN 'failed' THEN 2
        WHEN 'executing' THEN 3 WHEN 'scheduled' THEN 4 WHEN 'approved' THEN 5 ELSE 6 END,
        c.created_at DESC
      LIMIT ? OFFSET ?
    `).all(...params, query.pageSize, (query.page - 1) * query.pageSize) as QueueRow[];
    return {
      total: totalRow.count,
      items: rows.map((row) => ({
        ...this.map(row),
        latest_proposal_summary: row.latest_proposal_summary,
        rule_hits: parseJson<string[]>(row.latest_rule_hits, []),
      })),
    };
  }

  private map(row: CaseRow): ReviewCaseRecord {
    return { ...row };
  }
}
