import type {
  AnalyticsOverview,
  AnalyticsWorkspaceRow,
  RepositoryProvider,
  RiskLevel,
  RoutingMode,
  WorkspaceStatus,
} from '@gatehouse/contract';
import type { Database } from '../db/database.js';

type WorkspaceAnalyticsRow = {
  workspace_id: string;
  workspace_name: string;
  workspace_slug: string;
  status: WorkspaceStatus;
  pending_review: number;
  scheduled: number;
  executing: number;
  failed: number;
  completed: number;
  average_review_minutes: number;
  last_activity_at: string | null;
};

/** Read-only operational aggregates; kept separate from approval and scheduling. */
export class AnalyticsRepository {
  constructor(private readonly db: Database) {}

  reviewMetrics(workspaceId?: string): { averageMinutes: number; slaRate: number } {
    const where = workspaceId ? 'WHERE p.workspace_id = ?' : '';
    const params = workspaceId ? [workspaceId] : [];
    const metrics = this.db.prepare(`
      SELECT
        COALESCE(AVG((julianday(d.created_at) - julianday(p.created_at)) * 1440.0), 0) AS average_minutes,
        COALESCE(AVG(CASE WHEN (julianday(d.created_at) - julianday(p.created_at)) * 1440.0 <= 30 THEN 100.0 ELSE 0.0 END), 0) AS sla_rate
      FROM review_decisions d JOIN proposals p ON p.id = d.proposal_id
      ${where}
    `).get(...params) as { average_minutes: number; sla_rate: number };
    return {
      averageMinutes: round1(metrics.average_minutes),
      slaRate: round1(metrics.sla_rate),
    };
  }

  globalOverview(range: '7d' | '30d' | '90d', now = new Date()): AnalyticsOverview {
    const days = range === '7d' ? 7 : range === '30d' ? 30 : 90;
    const since = new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
    const rows = this.workspaceRows(since);
    const workspaceIds = rows.map((row) => row.workspace_id);
    const providerRows = this.db.prepare(`
      SELECT provider, COUNT(*) AS count FROM workspace_repositories
      ${workspaceIds.length ? `WHERE workspace_id IN (${workspaceIds.map(() => '?').join(',')})` : ''}
      GROUP BY provider ORDER BY count DESC, provider ASC
    `).all(...workspaceIds) as Array<{ provider: RepositoryProvider; count: number }>;
    const routingRows = this.db.prepare(`
      SELECT mode, COUNT(*) AS count FROM routing_decisions
      WHERE created_at >= ? ${workspaceIds.length ? `AND workspace_id IN (${workspaceIds.map(() => '?').join(',')})` : ''}
      GROUP BY mode ORDER BY count DESC, mode ASC
    `).all(since, ...workspaceIds) as Array<{ mode: RoutingMode; count: number }>;
    const riskRows = this.db.prepare(`
      SELECT c.risk_level, COUNT(*) AS count FROM review_cases c
      WHERE c.created_at >= ? ${workspaceIds.length ? `AND c.workspace_id IN (${workspaceIds.map(() => '?').join(',')})` : ''}
      GROUP BY c.risk_level
    `).all(since, ...workspaceIds) as Array<{ risk_level: RiskLevel; count: number }>;
    const routingTotals = this.db.prepare(`
      SELECT COUNT(*) AS total,
        COALESCE(SUM(CASE WHEN requires_human = 1 THEN 1 ELSE 0 END), 0) AS human,
        COALESCE(SUM(CASE WHEN overridden_by IS NOT NULL THEN 1 ELSE 0 END), 0) AS overridden
      FROM routing_decisions WHERE created_at >= ?
      ${workspaceIds.length ? `AND workspace_id IN (${workspaceIds.map(() => '?').join(',')})` : ''}
    `).get(since, ...workspaceIds) as { total: number; human: number; overridden: number };
    const waitMinutes = this.scheduleWaitMinutes(since, workspaceIds);
    const riskDistribution: Record<RiskLevel, number> = { low: 0, medium: 0, high: 0, critical: 0 };
    for (const row of riskRows) riskDistribution[row.risk_level] = row.count;

    const totalPending = sum(rows, 'pending_review');
    const totalScheduled = sum(rows, 'scheduled');
    const totalExecuting = sum(rows, 'executing');
    const totalFailed = sum(rows, 'failed');
    const totalCompleted = sum(rows, 'completed');
    const finished = totalCompleted + totalFailed;
    const averageReview = weightedAverage(rows, 'average_review_minutes',
      rows.map((row) => row.pending_review + row.completed + row.failed + row.scheduled + row.executing));

    return {
      range,
      generated_at: now.toISOString(),
      totals: {
        workspaces: rows.length,
        active_workspaces: rows.filter((row) => row.status === 'active').length,
        error_workspaces: rows.filter((row) => row.status === 'error').length,
        pending_review: totalPending,
        scheduled: totalScheduled,
        executing: totalExecuting,
        failed: totalFailed,
        completed: totalCompleted,
        completion_rate: finished === 0 ? 0 : round1((totalCompleted / finished) * 100),
        failure_rate: finished === 0 ? 0 : round1((totalFailed / finished) * 100),
        average_review_minutes: round1(averageReview),
        p95_schedule_wait_minutes: percentile95(waitMinutes),
        human_routing_rate: routingTotals.total === 0 ? 0 : round1((routingTotals.human / routingTotals.total) * 100),
        manual_override_rate: routingTotals.total === 0 ? 0 : round1((routingTotals.overridden / routingTotals.total) * 100),
      },
      workspaces: rows.map((row) => this.workspaceItem(row)),
      trend: this.trend(since, days, now, workspaceIds),
      provider_distribution: providerRows,
      routing_distribution: routingRows,
      risk_distribution: riskDistribution,
      recent_failures: this.recentFailures(workspaceIds, 8),
    };
  }

  private workspaceRows(since: string): WorkspaceAnalyticsRow[] {
    return this.db.prepare(`
      SELECT w.id AS workspace_id, w.name AS workspace_name, w.slug AS workspace_slug, w.status,
        (SELECT COUNT(*) FROM review_cases c WHERE c.workspace_id = w.id AND c.status IN ('pending_review', 'info_requested') AND c.created_at >= ?) AS pending_review,
        (SELECT COUNT(*) FROM schedules s WHERE s.workspace_id = w.id AND s.status = 'scheduled' AND s.created_at >= ?) AS scheduled,
        (SELECT COUNT(*) FROM schedules s WHERE s.workspace_id = w.id AND s.status = 'executing' AND s.created_at >= ?) AS executing,
        (SELECT COUNT(*) FROM schedules s WHERE s.workspace_id = w.id AND s.status = 'failed' AND s.updated_at >= ?) AS failed,
        (SELECT COUNT(*) FROM schedules s WHERE s.workspace_id = w.id AND s.status = 'completed' AND s.updated_at >= ?) AS completed,
        COALESCE((SELECT AVG((julianday(d.created_at) - julianday(p.created_at)) * 1440.0)
          FROM review_decisions d JOIN proposals p ON p.id = d.proposal_id
          WHERE p.workspace_id = w.id AND d.created_at >= ?), 0) AS average_review_minutes,
        (SELECT MAX(a.created_at) FROM audit_events a WHERE a.workspace_id = w.id) AS last_activity_at
      FROM workspaces w
      ORDER BY w.created_at ASC
    `).all(since, since, since, since, since, since) as WorkspaceAnalyticsRow[];
  }

  private workspaceItem(row: WorkspaceAnalyticsRow): AnalyticsWorkspaceRow {
    const repositories = this.db.prepare(`
      SELECT id, provider, repository_key, health_state FROM workspace_repositories
      WHERE workspace_id = ? ORDER BY created_at ASC
    `).all(row.workspace_id) as AnalyticsWorkspaceRow['repositories'];
    const finished = row.completed + row.failed;
    return {
      workspace_id: row.workspace_id,
      workspace_name: row.workspace_name,
      workspace_slug: row.workspace_slug,
      status: row.status,
      repositories,
      pending_review: row.pending_review,
      scheduled: row.scheduled,
      executing: row.executing,
      failed: row.failed,
      completed: row.completed,
      completion_rate: finished === 0 ? 0 : round1((row.completed / finished) * 100),
      average_review_minutes: round1(row.average_review_minutes),
      last_activity_at: row.last_activity_at,
    };
  }

  private trend(since: string, days: number, now: Date, workspaceIds: string[]) {
    const workspace = workspaceIds.length ? `AND workspace_id IN (${workspaceIds.map(() => '?').join(',')})` : '';
    const created = this.db.prepare(`
      SELECT substr(created_at, 1, 10) AS date, COUNT(*) AS count FROM review_cases
      WHERE created_at >= ? ${workspace} GROUP BY substr(created_at, 1, 10)
    `).all(since, ...workspaceIds) as Array<{ date: string; count: number }>;
    const completed = this.db.prepare(`
      SELECT substr(updated_at, 1, 10) AS date, COUNT(*) AS count FROM schedules
      WHERE status = 'completed' AND updated_at >= ? ${workspace} GROUP BY substr(updated_at, 1, 10)
    `).all(since, ...workspaceIds) as Array<{ date: string; count: number }>;
    const failed = this.db.prepare(`
      SELECT substr(updated_at, 1, 10) AS date, COUNT(*) AS count FROM schedules
      WHERE status = 'failed' AND updated_at >= ? ${workspace} GROUP BY substr(updated_at, 1, 10)
    `).all(since, ...workspaceIds) as Array<{ date: string; count: number }>;
    const byDate = (rows: Array<{ date: string; count: number }>) => new Map(rows.map((row) => [row.date, row.count]));
    const createdMap = byDate(created), completedMap = byDate(completed), failedMap = byDate(failed);
    return Array.from({ length: days }, (_, index) => {
      const at = new Date(now.getTime() - (days - index - 1) * 24 * 60 * 60 * 1000);
      const date = at.toISOString().slice(0, 10);
      return { date, created: createdMap.get(date) ?? 0, completed: completedMap.get(date) ?? 0, failed: failedMap.get(date) ?? 0 };
    });
  }

  private scheduleWaitMinutes(since: string, workspaceIds: string[]): number[] {
    const rows = this.db.prepare(`
      SELECT MAX(0, (julianday(updated_at) - julianday(created_at)) * 1440.0) AS minutes
      FROM schedules WHERE updated_at >= ? AND status IN ('executing', 'completed', 'failed')
      ${workspaceIds.length ? `AND workspace_id IN (${workspaceIds.map(() => '?').join(',')})` : ''}
    `).all(since, ...workspaceIds) as Array<{ minutes: number }>;
    return rows.map((row) => row.minutes).filter(Number.isFinite);
  }

  private recentFailures(workspaceIds: string[], limit: number): AnalyticsOverview['recent_failures'] {
    const rows = this.db.prepare(`
      SELECT COALESCE(s.workspace_id, c.workspace_id, '') AS workspace_id,
        COALESCE(w.name, '未归属工作区') AS workspace_name,
        c.id AS case_id, c.title, s.updated_at AS failed_at, COALESCE(s.last_error, '执行失败') AS reason
      FROM schedules s JOIN proposals p ON p.id = s.proposal_id JOIN review_cases c ON c.id = p.review_case_id
      LEFT JOIN workspaces w ON w.id = COALESCE(s.workspace_id, c.workspace_id)
      WHERE s.status = 'failed' ${workspaceIds.length ? `AND COALESCE(s.workspace_id, c.workspace_id) IN (${workspaceIds.map(() => '?').join(',')})` : ''}
      ORDER BY s.updated_at DESC LIMIT ?
    `).all(...workspaceIds, limit) as AnalyticsOverview['recent_failures'];
    return rows;
  }
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function sum(rows: WorkspaceAnalyticsRow[], key: keyof WorkspaceAnalyticsRow): number {
  return rows.reduce((total, row) => total + Number(row[key] ?? 0), 0);
}

function weightedAverage(rows: WorkspaceAnalyticsRow[], key: keyof WorkspaceAnalyticsRow, weights: number[]): number {
  const denominator = weights.reduce((total, value) => total + value, 0);
  return denominator === 0 ? 0 : rows.reduce((total, row, index) => total + Number(row[key] ?? 0) * (weights[index] ?? 0), 0) / denominator;
}

function percentile95(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return round1(sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)] ?? 0);
}
