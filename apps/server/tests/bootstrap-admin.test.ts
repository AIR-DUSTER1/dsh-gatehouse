import { describe, expect, it } from 'vitest';
import type { User } from '@gatehouse/contract';
import { loadConfig } from '../src/config.js';
import { ensureBootstrapAdmin } from '../src/domain/bootstrap-admin.js';
import type { UserWithPassword } from '../src/repositories/user-repository.js';

function users() {
  const created: UserWithPassword[] = [];
  return {
    created,
    repository: {
      list: (): User[] => created.map(({ password_hash: _password, ...user }) => user),
      create: (user: UserWithPassword): void => { created.push(user); },
    },
  };
}

describe('bootstrap administrator', () => {
  it('refuses an empty database without explicit administrator configuration', () => {
    const store = users();
    const config = loadConfig({ bootstrapAdminEmail: '', bootstrapAdminName: '', bootstrapAdminPassword: '' });
    expect(() => ensureBootstrapAdmin(store.repository, config)).toThrow('BOOTSTRAP_ADMIN_EMAIL');
    expect(store.created).toEqual([]);
  });

  it('creates one configured administrator and never seeds business data', () => {
    const store = users();
    const config = loadConfig({
      bootstrapAdminEmail: 'ADMIN@GATEHOUSE.LOCAL', bootstrapAdminName: 'Gatehouse Admin', bootstrapAdminPassword: 'strong-bootstrap-password',
    });
    ensureBootstrapAdmin(store.repository, config);
    expect(store.created).toHaveLength(1);
    expect(store.created[0]).toMatchObject({ email: 'admin@gatehouse.local', name: 'Gatehouse Admin', role: 'admin' });
    expect(store.created[0]?.password_hash).not.toContain('strong-bootstrap-password');
    ensureBootstrapAdmin(store.repository, loadConfig({ bootstrapAdminEmail: '', bootstrapAdminName: '', bootstrapAdminPassword: '' }));
    expect(store.created).toHaveLength(1);
  });
});
