import type { Role, User, UserStatus } from '@gatehouse/contract';
import type { Database } from '../db/database.js';
import type { RoleRepository } from './role-repository.js';

type AccountRow = {
  id: string;
  email: string;
  name: string;
  role: Role;
  role_id: string;
  role_code: string;
  role_name: string;
  status: UserStatus;
  password_hash: string;
  session_version: number;
  password_changed_at: string | null;
  last_login_at: string | null;
  disabled_at: string | null;
  disabled_by: string | null;
  created_at: string;
  updated_at: string;
};

export interface UserWithPassword extends User {
  password_hash: string;
  session_version: number;
}

export interface UserCreateInput {
  id: string;
  email: string;
  name: string;
  roleId: string;
  passwordHash: string;
  status?: UserStatus;
  createdAt?: string;
}

export interface UserListQuery {
  search?: string | undefined;
  status?: UserStatus | undefined;
  roleId?: string | undefined;
  page: number;
  pageSize: number;
}

export class UserRepository {
  constructor(private readonly db: Database, private readonly roles: RoleRepository) {}

  create(input: UserCreateInput): User {
    const role = this.db.prepare('SELECT code, legacy_role, status FROM roles WHERE id = ?')
      .get(input.roleId) as { code: string; legacy_role: Role; status: 'active' | 'archived' } | undefined;
    if (!role || role.status !== 'active') throw new Error(`Active role ${input.roleId} does not exist.`);
    const at = input.createdAt ?? new Date().toISOString();
    const status = input.status ?? 'active';
    this.db.prepare(`
      INSERT INTO users(id, email, name, role, role_id, status, password_hash, password_changed_at,
        last_login_at, session_version, created_at, updated_at, disabled_at, disabled_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, 0, ?, ?, NULL, NULL)
    `).run(input.id, input.email.toLowerCase(), input.name, role.legacy_role, input.roleId, status,
      input.passwordHash, status === 'active' ? at : null, at, at);
    return this.findById(input.id)!;
  }

  findByEmail(email: string): UserWithPassword | null {
    const row = this.accountBy('lower(u.email) = ?', email.toLowerCase());
    return row ? this.mapWithPassword(row) : null;
  }

  findById(id: string): User | null {
    const row = this.accountBy('u.id = ?', id);
    return row ? this.mapUser(row) : null;
  }

  findByIdWithPassword(id: string): UserWithPassword | null {
    const row = this.accountBy('u.id = ?', id);
    return row ? this.mapWithPassword(row) : null;
  }

  list(): User[] {
    return this.listAccounts().map((row) => this.mapUser(row));
  }

  listPage(query: UserListQuery): { items: User[]; total: number } {
    const conditions: string[] = [];
    const params: Array<string | number> = [];
    if (query.search) {
      conditions.push('(lower(u.name) LIKE ? OR lower(u.email) LIKE ?)');
      const term = `%${query.search.toLowerCase()}%`;
      params.push(term, term);
    }
    if (query.status) { conditions.push('u.status = ?'); params.push(query.status); }
    if (query.roleId) { conditions.push('u.role_id = ?'); params.push(query.roleId); }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const total = (this.db.prepare(`SELECT COUNT(*) AS count FROM users u ${where}`).get(...params) as { count: number }).count;
    const rows = this.db.prepare(`
      SELECT u.*, r.code AS role_code, r.name AS role_name
      FROM users u JOIN roles r ON r.id = u.role_id
      ${where} ORDER BY u.created_at DESC, u.name ASC LIMIT ? OFFSET ?
    `).all(...params, query.pageSize, (query.page - 1) * query.pageSize) as AccountRow[];
    return { items: rows.map((row) => this.mapUser(row)), total };
  }

  emailExists(email: string, excludeId?: string): boolean {
    const row = excludeId
      ? this.db.prepare('SELECT 1 FROM users WHERE lower(email) = ? AND id <> ?').get(email.toLowerCase(), excludeId)
      : this.db.prepare('SELECT 1 FROM users WHERE lower(email) = ?').get(email.toLowerCase());
    return Boolean(row);
  }

  updateProfile(id: string, input: { name: string; roleId: string; updatedAt: string }): void {
    const role = this.db.prepare('SELECT legacy_role, status FROM roles WHERE id = ?')
      .get(input.roleId) as { legacy_role: Role; status: 'active' | 'archived' } | undefined;
    if (!role || role.status !== 'active') throw new Error(`Active role ${input.roleId} does not exist.`);
    this.db.prepare('UPDATE users SET name = ?, role_id = ?, role = ?, updated_at = ? WHERE id = ?')
      .run(input.name, input.roleId, role.legacy_role, input.updatedAt, id);
  }

  setRole(id: string, roleId: string, updatedAt: string): void {
    const current = this.findById(id);
    if (!current) return;
    this.updateProfile(id, { name: current.name, roleId, updatedAt });
  }

  setStatus(id: string, status: UserStatus, actorId: string | null, at: string): void {
    this.db.prepare(`
      UPDATE users SET status = ?, disabled_at = ?, disabled_by = ?, session_version = session_version + 1,
        updated_at = ? WHERE id = ?
    `).run(status, status === 'disabled' ? at : null, status === 'disabled' ? actorId : null, at, id);
  }

  setPassword(id: string, passwordHash: string, at: string): void {
    this.db.prepare(`
      UPDATE users SET password_hash = ?, status = 'active', password_changed_at = ?, disabled_at = NULL,
        disabled_by = NULL, session_version = session_version + 1, updated_at = ? WHERE id = ?
    `).run(passwordHash, at, at, id);
  }

  recordLogin(id: string, at: string): void {
    this.db.prepare('UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ?').run(at, at, id);
  }

  countActiveAdmins(): number {
    return (this.db.prepare(`
      SELECT COUNT(*) AS count FROM users u JOIN roles r ON r.id = u.role_id
      WHERE r.code = 'admin' AND u.status = 'active'
    `).get() as { count: number }).count;
  }

  getWorkspaceIds(userId: string): string[] {
    return (this.db.prepare('SELECT workspace_id FROM workspace_memberships WHERE user_id = ? ORDER BY workspace_id')
      .all(userId) as Array<{ workspace_id: string }>).map((row) => row.workspace_id);
  }

  private listAccounts(): AccountRow[] {
    return this.db.prepare(`
      SELECT u.*, r.code AS role_code, r.name AS role_name
      FROM users u JOIN roles r ON r.id = u.role_id ORDER BY u.name
    `).all() as AccountRow[];
  }

  private accountBy(where: string, value: string): AccountRow | null {
    const row = this.db.prepare(`
      SELECT u.*, r.code AS role_code, r.name AS role_name
      FROM users u JOIN roles r ON r.id = u.role_id WHERE ${where}
    `).get(value) as AccountRow | undefined;
    return row ? { ...row } : null;
  }

  private mapUser(row: AccountRow): User {
    return {
      id: row.id,
      name: row.name,
      email: row.email,
      role: row.role_code,
      role_id: row.role_id,
      role_name: row.role_name,
      status: row.status,
      permissions: this.roles.permissionsForRole(row.role_id, row.role_code),
      workspace_ids: this.getWorkspaceIds(row.id),
      last_login_at: row.last_login_at,
      password_changed_at: row.password_changed_at,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }

  private mapWithPassword(row: AccountRow): UserWithPassword {
    return { ...this.mapUser(row), password_hash: row.password_hash, session_version: row.session_version };
  }
}
