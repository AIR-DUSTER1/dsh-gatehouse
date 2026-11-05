import type { Database } from '../db/database.js';

export type UserActionPurpose = 'invite' | 'reset_password';

export interface UserActionTokenRecord {
  id: string;
  user_id: string;
  purpose: UserActionPurpose;
  token_hash: string;
  expires_at: string;
  consumed_at: string | null;
  revoked_at: string | null;
  created_by: string;
  created_at: string;
}

export class UserTokenRepository {
  constructor(private readonly db: Database) {}

  create(input: {
    id: string; userId: string; purpose: UserActionPurpose; tokenHash: string;
    expiresAt: string; createdBy: string; createdAt: string;
  }): void {
    this.db.prepare(`
      UPDATE user_action_tokens SET revoked_at = ?
      WHERE user_id = ? AND purpose = ? AND consumed_at IS NULL AND revoked_at IS NULL
    `).run(input.createdAt, input.userId, input.purpose);
    this.db.prepare(`
      INSERT INTO user_action_tokens(id, user_id, purpose, token_hash, expires_at, consumed_at, revoked_at, created_by, created_at)
      VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, ?)
    `).run(input.id, input.userId, input.purpose, input.tokenHash, input.expiresAt, input.createdBy, input.createdAt);
  }

  findValid(tokenHash: string, purpose: UserActionPurpose, at: string): UserActionTokenRecord | null {
    const row = this.db.prepare(`
      SELECT * FROM user_action_tokens
      WHERE token_hash = ? AND purpose = ? AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at > ?
    `).get(tokenHash, purpose, at) as UserActionTokenRecord | undefined;
    return row ? { ...row } : null;
  }

  consume(id: string, at: string): boolean {
    const result = this.db.prepare(`
      UPDATE user_action_tokens SET consumed_at = ?
      WHERE id = ? AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at > ?
    `).run(at, id, at);
    return Number(result.changes) === 1;
  }
}
