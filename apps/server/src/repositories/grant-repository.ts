import type { ApprovalGrantRecord } from '@gatehouse/contract';
import type { Database } from '../db/database.js';

type GrantRow = {
  id: string; proposal_id: string; reviewer: string; requirement_hash: string; scope_hash: string;
  approved_at: string; schedule_at: string; expires_at: string; consumed_at: string | null;
  status: ApprovalGrantRecord['status'];
};

/** Approval grants are persisted facts; their status transitions are conditional updates. */
export class GrantRepository {
  constructor(private readonly db: Database) {}

  create(input: ApprovalGrantRecord): void {
    this.db.prepare(`
      INSERT INTO approval_grants(id, proposal_id, reviewer, requirement_hash, scope_hash, approved_at,
        schedule_at, expires_at, consumed_at, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(input.id, input.proposal_id, input.reviewer, input.requirement_hash, input.scope_hash,
      input.approved_at, input.schedule_at, input.expires_at, input.consumed_at, input.status);
  }

  getByProposal(proposalId: string): ApprovalGrantRecord | null {
    const row = this.db.prepare('SELECT * FROM approval_grants WHERE proposal_id = ?').get(proposalId) as GrantRow | undefined;
    return row ? { ...row } : null;
  }

  get(id: string): ApprovalGrantRecord | null {
    const row = this.db.prepare('SELECT * FROM approval_grants WHERE id = ?').get(id) as GrantRow | undefined;
    return row ? { ...row } : null;
  }

  consume(id: string, consumedAt: string): boolean {
    const result = this.db.prepare(`
      UPDATE approval_grants SET status = 'consumed', consumed_at = ?
      WHERE id = ? AND status = 'active' AND consumed_at IS NULL
    `).run(consumedAt, id);
    return Number(result.changes) === 1;
  }

  revoke(id: string): boolean {
    const result = this.db.prepare("UPDATE approval_grants SET status = 'revoked' WHERE id = ? AND status = 'active'").run(id);
    return Number(result.changes) === 1;
  }

  expire(id: string): boolean {
    const result = this.db.prepare("UPDATE approval_grants SET status = 'expired' WHERE id = ? AND status = 'active'").run(id);
    return Number(result.changes) === 1;
  }

  findByProposalWithHash(proposalId: string, requirementHash: string, scopeHash: string): ApprovalGrantRecord | null {
    const grant = this.getByProposal(proposalId);
    if (!grant) return null;
    if (grant.requirement_hash !== requirementHash || grant.scope_hash !== scopeHash) return null;
    return grant;
  }
}
