import type { Database } from '../db/database.js';

type OutboxRow = {
  id: string; topic: string; aggregate_id: string; idempotency_key: string; payload_json: string;
  status: 'pending' | 'inflight' | 'delivered' | 'dead'; attempts: number; max_attempts: number;
  next_attempt_at: string; last_error: string | null; created_at: string; updated_at: string;
};

export interface OutboxMessage {
  id: string; topic: string; aggregateId: string; idempotencyKey: string; payload: unknown;
  status: OutboxRow['status']; attempts: number; maxAttempts: number; nextAttemptAt: string;
  lastError: string | null; createdAt: string; updatedAt: string;
}

/** Transactional outbox for plugin side effects. A crash leaves a recoverable pending fact. */
export class OutboxRepository {
  constructor(private readonly db: Database) {}

  enqueue(input: {
    id: string; topic: string; aggregateId: string; idempotencyKey: string; payload: unknown;
    maxAttempts: number; createdAt: string;
  }): void {
    this.db.prepare(`
      INSERT OR IGNORE INTO outbox_messages(id, topic, aggregate_id, idempotency_key, payload_json,
        status, attempts, max_attempts, next_attempt_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'pending', 0, ?, ?, ?, ?)
    `).run(input.id, input.topic, input.aggregateId, input.idempotencyKey, JSON.stringify(input.payload),
      input.maxAttempts, input.createdAt, input.createdAt, input.createdAt);
  }

  recoverInflight(now: string): void {
    this.db.prepare("UPDATE outbox_messages SET status = 'pending', updated_at = ? WHERE status = 'inflight'").run(now);
  }

  due(now: string, limit: number): OutboxMessage[] {
    const rows = this.db.prepare(`
      SELECT * FROM outbox_messages
      WHERE status = 'pending' AND next_attempt_at <= ?
      ORDER BY next_attempt_at ASC LIMIT ?
    `).all(now, limit) as OutboxRow[];
    return rows.map((row) => this.map(row));
  }

  markInflight(id: string, at: string): void {
    this.db.prepare("UPDATE outbox_messages SET status = 'inflight', updated_at = ? WHERE id = ?").run(at, id);
  }

  markDelivered(id: string, at: string): void {
    this.db.prepare("UPDATE outbox_messages SET status = 'delivered', last_error = NULL, updated_at = ? WHERE id = ?").run(at, id);
  }

  markFailedAttempt(id: string, error: string, nextAttemptAt: string, at: string): void {
    this.db.prepare('UPDATE outbox_messages SET status = ?, attempts = attempts + 1, last_error = ?, next_attempt_at = ?, updated_at = ? WHERE id = ?')
      .run('pending', error, nextAttemptAt, at, id);
  }

  markDead(id: string, error: string, at: string): void {
    this.db.prepare("UPDATE outbox_messages SET status = 'dead', attempts = attempts + 1, last_error = ?, updated_at = ? WHERE id = ?")
      .run(error, at, id);
  }

  pendingCount(): number {
    const row = this.db.prepare("SELECT COUNT(*) AS count FROM outbox_messages WHERE status IN ('pending', 'inflight')").get() as { count: number };
    return row.count;
  }

  private map(row: OutboxRow): OutboxMessage {
    return {
      id: row.id, topic: row.topic, aggregateId: row.aggregate_id,
      idempotencyKey: row.idempotency_key, payload: JSON.parse(row.payload_json) as unknown,
      status: row.status, attempts: row.attempts, maxAttempts: row.max_attempts,
      nextAttemptAt: row.next_attempt_at, lastError: row.last_error,
      createdAt: row.created_at, updatedAt: row.updated_at,
    };
  }
}
