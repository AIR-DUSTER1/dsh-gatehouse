import type { AuditEventRecord } from '@gatehouse/contract';
import type { Database } from '../db/database.js';
import { parseJson } from '../domain/utils.js';

type AuditRow = {
  id: string; entity_type: string; entity_id: string; action: string; actor: string;
  before_json: string; after_json: string; trace_id: string; created_at: string;
};

export interface AuditQuery {
  entityType?: string | undefined;
  entityId?: string | undefined;
  action?: string | undefined;
  page: number;
  pageSize: number;
}

/** Append-only audit persistence. No update/delete API is exported. */
export class AuditRepository {
  constructor(private readonly db: Database) {}

  append(input: AuditEventRecord): void {
    this.db.prepare(`
      INSERT INTO audit_events(id, entity_type, entity_id, action, actor, before_json, after_json, trace_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(input.id, input.entity_type, input.entity_id, input.action, input.actor,
      JSON.stringify(input.before), JSON.stringify(input.after), input.trace_id, input.created_at);
  }

  list(query: AuditQuery): { items: AuditEventRecord[]; total: number } {
    const conditions: string[] = [];
    const params: Array<string | number> = [];
    if (query.entityType) { conditions.push('entity_type = ?'); params.push(query.entityType); }
    if (query.entityId) { conditions.push('entity_id = ?'); params.push(query.entityId); }
    if (query.action) { conditions.push('action LIKE ?'); params.push(`%${query.action}%`); }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const row = this.db.prepare(`SELECT COUNT(*) AS count FROM audit_events ${where}`).get(...params) as { count: number };
    const rows = this.db.prepare(`SELECT * FROM audit_events ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
      .all(...params, query.pageSize, (query.page - 1) * query.pageSize) as AuditRow[];
    return { total: row.count, items: rows.map((item) => this.map(item)) };
  }

  forEntity(entityType: string, entityId: string): AuditEventRecord[] {
    const rows = this.db.prepare('SELECT * FROM audit_events WHERE entity_type = ? AND entity_id = ? ORDER BY created_at ASC')
      .all(entityType, entityId) as AuditRow[];
    return rows.map((item) => this.map(item));
  }

  recent(limit = 8): AuditEventRecord[] {
    const rows = this.db.prepare('SELECT * FROM audit_events ORDER BY created_at DESC LIMIT ?').all(limit) as AuditRow[];
    return rows.map((item) => this.map(item));
  }

  private map(row: AuditRow): AuditEventRecord {
    return {
      id: row.id, entity_type: row.entity_type, entity_id: row.entity_id, action: row.action,
      actor: row.actor, before: parseJson<unknown>(row.before_json, null),
      after: parseJson<unknown>(row.after_json, null), trace_id: row.trace_id, created_at: row.created_at,
    };
  }
}
