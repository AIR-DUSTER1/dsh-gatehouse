import type { Database } from '../db/database.js';

type EventRow = {
  event_id: string; event_type: string; nonce: string; payload_json: string; trace_id: string;
  status: string; error: string | null; received_at: string; processed_at: string | null;
};

export class PluginEventRepository {
  constructor(private readonly db: Database) {}

  get(eventId: string): EventRow | null {
    return (this.db.prepare('SELECT * FROM plugin_events WHERE event_id = ?').get(eventId) as EventRow | undefined) ?? null;
  }

  getByNonce(nonce: string): EventRow | null {
    return (this.db.prepare('SELECT * FROM plugin_events WHERE nonce = ?').get(nonce) as EventRow | undefined) ?? null;
  }

  begin(eventId: string, eventType: string, nonce: string, payload: unknown, traceId: string, at: string): void {
    this.db.prepare(`
      INSERT INTO plugin_events(event_id, event_type, nonce, payload_json, trace_id, status, received_at)
      VALUES (?, ?, ?, ?, ?, 'processing', ?)
    `).run(eventId, eventType, nonce, JSON.stringify(payload), traceId, at);
  }

  complete(eventId: string, at: string): void {
    this.db.prepare("UPDATE plugin_events SET status = 'processed', processed_at = ?, error = NULL WHERE event_id = ?").run(at, eventId);
  }

  fail(eventId: string, error: string): void {
    this.db.prepare("UPDATE plugin_events SET status = 'failed', error = ? WHERE event_id = ?").run(error, eventId);
  }
}
