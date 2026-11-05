import type { Database } from '../db/database.js';

export class AuthEventRepository {
  constructor(private readonly db: Database) {}

  record(input: {
    id: string; userId: string | null; eventType: string; outcome: 'success' | 'failure';
    reasonCode?: string | null; traceId: string; createdAt: string;
  }): void {
    this.db.prepare(`
      INSERT INTO auth_events(id, user_id, event_type, outcome, reason_code, trace_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(input.id, input.userId, input.eventType, input.outcome, input.reasonCode ?? null, input.traceId, input.createdAt);
  }
}
