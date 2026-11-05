import type { PermissionCode, PermissionRecord, RoleRecord } from '@gatehouse/contract';
import type { Database } from '../db/database.js';

type RoleRow = {
  id: string; code: string; name: string; description: string; is_system: number; legacy_role: string;
  editable: number; status: 'active' | 'archived'; created_at: string; updated_at: string;
};

type PermissionRow = {
  code: PermissionCode; group_key: string; name: string; description: string; admin_only: number; sort_order: number;
};

export interface RoleCreateRecord {
  id: string;
  code: string;
  name: string;
  description: string;
  permissions: PermissionCode[];
  createdAt: string;
}

export class RoleRepository {
  constructor(private readonly db: Database) {}

  list(): RoleRecord[] {
    const rows = this.db.prepare(`
      SELECT r.*, (SELECT COUNT(*) FROM users u WHERE u.role_id = r.id) AS user_count
      FROM roles r ORDER BY CASE r.code WHEN 'admin' THEN 0 WHEN 'reviewer' THEN 1 WHEN 'viewer' THEN 2 ELSE 3 END, r.name
    `).all() as Array<RoleRow & { user_count: number }>;
    return rows.map((row) => this.mapRole(row));
  }

  findById(id: string): RoleRecord | null {
    const row = this.db.prepare(`
      SELECT r.*, (SELECT COUNT(*) FROM users u WHERE u.role_id = r.id) AS user_count
      FROM roles r WHERE r.id = ?
    `).get(id) as (RoleRow & { user_count: number }) | undefined;
    return row ? this.mapRole(row) : null;
  }

  findByCode(code: string): RoleRecord | null {
    const row = this.db.prepare(`
      SELECT r.*, (SELECT COUNT(*) FROM users u WHERE u.role_id = r.id) AS user_count
      FROM roles r WHERE r.code = ?
    `).get(code) as (RoleRow & { user_count: number }) | undefined;
    return row ? this.mapRole(row) : null;
  }

  permissions(): PermissionRecord[] {
    const rows = this.db.prepare('SELECT * FROM permissions ORDER BY sort_order, code').all() as PermissionRow[];
    return rows.map((row) => ({ ...row, admin_only: row.admin_only === 1 }));
  }

  permissionsForRole(roleId: string, roleCode: string): PermissionCode[] {
    if (roleCode === 'admin') return this.permissions().map((permission) => permission.code);
    const rows = this.db.prepare(`
      SELECT permission_code FROM role_permissions WHERE role_id = ? ORDER BY permission_code
    `).all(roleId) as Array<{ permission_code: PermissionCode }>;
    return rows.map((row) => row.permission_code);
  }

  create(input: RoleCreateRecord): RoleRecord {
    this.db.prepare(`
      INSERT INTO roles(id, code, name, description, is_system, legacy_role, editable, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, 0, 'viewer', 1, 'active', ?, ?)
    `).run(input.id, input.code, input.name, input.description, input.createdAt, input.createdAt);
    this.replacePermissions(input.id, input.permissions, input.createdAt);
    return this.findById(input.id)!;
  }

  update(id: string, input: { name: string; description: string; permissions: PermissionCode[]; updatedAt: string }): RoleRecord {
    this.db.prepare('UPDATE roles SET name = ?, description = ?, updated_at = ? WHERE id = ?')
      .run(input.name, input.description, input.updatedAt, id);
    this.replacePermissions(id, input.permissions, input.updatedAt);
    return this.findById(id)!;
  }

  archive(id: string, updatedAt: string): void {
    this.db.prepare("UPDATE roles SET status = 'archived', updated_at = ? WHERE id = ?").run(updatedAt, id);
  }

  replacePermissions(roleId: string, permissions: PermissionCode[], at: string): void {
    this.db.prepare('DELETE FROM role_permissions WHERE role_id = ?').run(roleId);
    const insert = this.db.prepare('INSERT INTO role_permissions(role_id, permission_code, created_at) VALUES (?, ?, ?)');
    for (const permission of permissions) insert.run(roleId, permission, at);
  }

  private mapRole(row: RoleRow & { user_count: number }): RoleRecord {
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      description: row.description,
      is_system: row.is_system === 1,
      editable: row.editable === 1,
      status: row.status,
      permissions: this.permissionsForRole(row.id, row.code),
      user_count: row.user_count,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }
}
