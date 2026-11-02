import type { DecisionType, ReviewDecisionRecord } from '@gatehouse/contract';
import type { Database } from '../db/database.js';

type DecisionRow = {
  id: string; proposal_id: string; decision: DecisionType; reviewer: string; comment: string;
  idempotency_key: string; request_hash: string; created_at: string;
};

export class DecisionRepository {
  constructor(private readonly db: Database) {}

  create(input: ReviewDecisionRecord & { idempotency_key: string; request_hash: string }): void {
    this.db.prepare(`
      INSERT INTO review_decisions(id, proposal_id, decision, reviewer, comment, idempotency_key, request_hash, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(input.id, input.proposal_id, input.decision, input.reviewer, input.comment,
      input.idempotency_key, input.request_hash, input.created_at);
  }

  findByIdempotencyKey(key: string): (ReviewDecisionRecord & { idempotency_key: string; request_hash: string }) | null {
    const row = this.db.prepare('SELECT * FROM review_decisions WHERE idempotency_key = ?').get(key) as DecisionRow | undefined;
    if (!row) return null;
    return {
      id: row.id, proposal_id: row.proposal_id, decision: row.decision, reviewer: row.reviewer,
      comment: row.comment, created_at: row.created_at, idempotency_key: row.idempotency_key,
      request_hash: row.request_hash,
    };
  }

  listForProposal(proposalId: string): ReviewDecisionRecord[] {
    return this.db.prepare('SELECT id, proposal_id, decision, reviewer, comment, created_at FROM review_decisions WHERE proposal_id = ? ORDER BY created_at DESC')
      .all(proposalId) as unknown as ReviewDecisionRecord[];
  }
}
