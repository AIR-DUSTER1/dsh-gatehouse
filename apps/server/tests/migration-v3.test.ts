import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../src/db/database.js';
import { hashPassword } from '../src/auth.js';

const dirs: string[] = [];
afterEach(() => { while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true }); });

describe('user role migration v3', () => {
  it('upgrades a v2 user without losing the account or role mapping', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gatehouse-v3-'));
    dirs.push(dir);
    const path = join(dir, 'legacy.db');
    const legacy = new DatabaseSync(path);
    legacy.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
      INSERT INTO schema_migrations(version, applied_at) VALUES (1, '2026-01-01T00:00:00.000Z'), (2, '2026-01-01T00:00:00.000Z');
      CREATE TABLE users(
        id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('viewer','reviewer','admin')),
        password_hash TEXT NOT NULL, created_at TEXT NOT NULL
      );
      CREATE TABLE audit_events(
        id TEXT PRIMARY KEY, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, action TEXT NOT NULL,
        actor TEXT NOT NULL, before_json TEXT NOT NULL, after_json TEXT NOT NULL, trace_id TEXT NOT NULL,
        workspace_id TEXT, created_at TEXT NOT NULL
      );
    `);
    legacy.prepare('INSERT INTO users(id,email,name,role,password_hash,created_at) VALUES (?,?,?,?,?,?)')
      .run('user_legacy', 'legacy@test.local', '历史复核人', 'reviewer', hashPassword('legacy-password-123'), '2026-01-01T00:00:00.000Z');
    legacy.close();

    const db = openDatabase(path);
    const user = db.prepare('SELECT role, role_id, status, session_version, updated_at FROM users WHERE id = ?')
      .get('user_legacy') as { role: string; role_id: string; status: string; session_version: number; updated_at: string };
    expect(user).toMatchObject({ role: 'reviewer', role_id: 'role_reviewer', status: 'active', session_version: 0 });
    expect(user.updated_at).toBeTruthy();
    expect((db.prepare('SELECT COUNT(*) AS count FROM roles').get() as { count: number }).count).toBe(3);
    expect((db.prepare('SELECT COUNT(*) AS count FROM permissions').get() as { count: number }).count).toBe(16);
    expect((db.prepare('SELECT permission_code FROM role_permissions WHERE role_id = ? ORDER BY permission_code').all('role_reviewer') as Array<{ permission_code: string }>).map((row) => row.permission_code))
      .toContain('review.decide');
    expect((db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get() as { version: number }).version).toBe(3);
    db.close();
  });
});
