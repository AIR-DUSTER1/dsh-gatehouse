import type { RiskLevel, ScheduleListItem, ScheduleRecord, ScheduleStatus } from '@gatehouse/contract';
import type { Database } from '../db/database.js';

type ScheduleRow = {
  id: string; proposal_id: string; grant_id: string; schedule_at: string; expires_at: string;
  status: ScheduleStatus; approval_synced_at: string | null; attempts: number; max_attempts: number;
  last_error: string | null; execution_id: string | null; pr_url: string | null;
  created_at: string; updated_at: string;
};

type ScheduleListRow = ScheduleRow & {
  review_case_id: string; title: string; requester: string; risk_level: RiskLevel; proposal_summary: string;
};

export class ScheduleRepository {
  constructor(private readonly db: Database) {}

  create(input: ScheduleRecord): void {
    this.db.prepare(`
      INSERT INTO schedules(id, proposal_id, grant_id, schedule_at, expires_at, status, approval_synced_at,
        attempts, max_attempts, last_error, execution_id, pr_url, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(input.id, input.proposal_id, input.grant_id, input.schedule_at, input.expires_at,
      input.status, input.approval_synced_at, input.attempts, input.max_attempts, input.last_error,
      input.execution_id, input.pr_url, input.created_at, input.updated_at);
  }

  get(id: string): ScheduleRecord | null {
    const row = this.db.prepare('SELECT * FROM schedules WHERE id = ?').get(id) as ScheduleRow | undefined;
    return row ? { ...row } : null;
  }

  getByProposal(proposalId: string): ScheduleRecord | null {
    const row = this.db.prepare('SELECT * FROM schedules WHERE proposal_id = ?').get(proposalId) as ScheduleRow | undefined;
    return row ? { ...row } : null;
  }

  list(status?: ScheduleStatus): ScheduleListItem[] {
    const where = status ? 'WHERE s.status = ?' : '';
    const params = status ? [status] : [];
    return this.db.prepare(`
      SELECT s.*, c.id AS review_case_id, c.title, c.requester, c.risk_level, p.summary AS proposal_summary
      FROM schedules s
      JOIN proposals p ON p.id = s.proposal_id
      JOIN review_cases c ON c.id = p.review_case_id
      ${where}
      ORDER BY s.schedule_at ASC
    `).all(...params) as ScheduleListRow[];
  }

  due(now: string, limit: number): ScheduleRecord[] {
    return this.db.prepare(`
      SELECT * FROM schedules
      WHERE status = 'scheduled' AND approval_synced_at IS NOT NULL AND schedule_at <= ?
      ORDER BY schedule_at ASC LIMIT ?
    `).all(now, limit) as ScheduleRow[];
  }

  countExecuting(): number {
    const row = this.db.prepare("SELECT COUNT(*) AS count FROM schedules WHERE status = 'executing'").get() as { count: number };
    return row.count;
  }

  markApprovalSynced(proposalId: string, at: string): void {
    this.db.prepare('UPDATE schedules SET approval_synced_at = ?, updated_at = ? WHERE proposal_id = ? AND approval_synced_at IS NULL')
      .run(at, at, proposalId);
  }

  markExecuting(id: string, executionId: string, at: string): void {
    this.db.prepare(`
      UPDATE schedules SET status = 'executing', execution_id = ?, attempts = attempts + 1,
        last_error = NULL, updated_at = ? WHERE id = ?
    `).run(executionId, at, id);
  }

  retry(id: string, error: string, at: string): void {
    this.db.prepare("UPDATE schedules SET status = 'scheduled', last_error = ?, updated_at = ? WHERE id = ?").run(error, at, id);
  }

  complete(id: string, prUrl: string | null, at: string): void {
    this.db.prepare("UPDATE schedules SET status = 'completed', pr_url = ?, last_error = NULL, updated_at = ? WHERE id = ?")
      .run(prUrl, at, id);
  }

  fail(id: string, error: string, at: string): void {
    this.db.prepare("UPDATE schedules SET status = 'failed', last_error = ?, updated_at = ? WHERE id = ?").run(error, at, id);
  }

  recordError(id: string, error: string, at: string): void {
    this.db.prepare('UPDATE schedules SET last_error = ?, updated_at = ? WHERE id = ?').run(error, at, id);
  }

  cancel(id: string, error: string, at: string): void {
    this.db.prepare("UPDATE schedules SET status = 'cancelled', last_error = ?, updated_at = ? WHERE id = ?").run(error, at, id);
  }

  setStatus(id: string, status: ScheduleStatus, at: string): void {
    this.db.prepare('UPDATE schedules SET status = ?, updated_at = ? WHERE id = ?').run(status, at, id);
  }
}

