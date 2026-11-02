import type { Database } from '../db/database.js';

/** Read-only operational aggregates; kept separate from approval and scheduling. */
export class AnalyticsRepository {
  constructor(private readonly db: Database) {}

  reviewMetrics(): { averageMinutes: number; slaRate: number } {
    const metrics = this.db.prepare(`
      SELECT
        COALESCE(AVG((julianday(d.created_at) - julianday(p.created_at)) * 1440.0), 0) AS average_minutes,
        COALESCE(AVG(CASE WHEN (julianday(d.created_at) - julianday(p.created_at)) * 1440.0 <= 30 THEN 100.0 ELSE 0.0 END), 0) AS sla_rate
      FROM review_decisions d JOIN proposals p ON p.id = d.proposal_id
    `).get() as { average_minutes: number; sla_rate: number };
    return {
      averageMinutes: Math.round(metrics.average_minutes * 10) / 10,
      slaRate: Math.round(metrics.sla_rate * 10) / 10,
    };
  }
}
