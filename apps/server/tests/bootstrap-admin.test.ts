import { describe, expect, it } from 'vitest';
import type { RoleRecord, User } from '@gatehouse/contract';
import { loadConfig } from '../src/config.js';
import { ensureBootstrapAdmin } from '../src/domain/bootstrap-admin.js';
import type { UserCreateInput } from '../src/repositories/user-repository.js';

const adminRole = { id: 'role_admin', code: 'admin', name: '管理员', description: '', is_system: true, editable: false,
  status: 'active', permissions: [], user_count: 0, created_at: '', updated_at: '' } as RoleRecord;

function users() {
  const created: UserCreateInput[] = [];
  return {
    created,
    repository: {
      list: (): User[] => created.map((user) => ({ id: user.id, name: user.name, email: user.email, role: 'admin',
        role_id: user.roleId, role_name: '管理员', status: 'active', permissions: [], workspace_ids: [],
        last_login_at: null, password_changed_at: null, created_at: user.createdAt ?? '', updated_at: user.createdAt ?? '' })),
      create: (user: UserCreateInput): User => {
        created.push(user);
        return {} as User;
      },
    },
  };
}

describe('bootstrap administrator', () => {
  it('refuses an empty database without explicit administrator configuration', () => {
    const store = users();
    const config = loadConfig({ bootstrapAdminEmail: '', bootstrapAdminName: '', bootstrapAdminPassword: '' });
    expect(() => ensureBootstrapAdmin(store.repository, { findByCode: () => adminRole }, config)).toThrow('BOOTSTRAP_ADMIN_EMAIL');
    expect(store.created).toEqual([]);
  });

  it('creates one configured administrator and never seeds business data', () => {
    const store = users();
    const config = loadConfig({ bootstrapAdminEmail: 'ADMIN@GATEHOUSE.LOCAL', bootstrapAdminName: 'Gatehouse Admin', bootstrapAdminPassword: 'strong-bootstrap-password' });
    ensureBootstrapAdmin(store.repository, { findByCode: () => adminRole }, config);
    expect(store.created).toHaveLength(1);
    expect(store.created[0]).toMatchObject({ email: 'admin@gatehouse.local', name: 'Gatehouse Admin', roleId: adminRole.id, status: 'active' });
    expect(store.created[0]?.passwordHash).not.toContain('strong-bootstrap-password');
    ensureBootstrapAdmin(store.repository, { findByCode: () => adminRole }, loadConfig({ bootstrapAdminEmail: '', bootstrapAdminName: '', bootstrapAdminPassword: '' }));
    expect(store.created).toHaveLength(1);
  });
});
