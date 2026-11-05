import { randomUUID } from 'node:crypto';
import type { AppConfig } from '../config.js';
import { hashPassword } from '../auth.js';
import type { RoleRepository } from '../repositories/role-repository.js';
import type { UserRepository } from '../repositories/user-repository.js';

/** Create the one configured administrator when the database has no users. */
export function ensureBootstrapAdmin(
  users: Pick<UserRepository, 'list' | 'create'>,
  roles: Pick<RoleRepository, 'findByCode'>,
  config: AppConfig,
): void {
  if (users.list().length > 0) return;
  const email = config.bootstrapAdminEmail.trim().toLowerCase();
  const name = config.bootstrapAdminName.trim();
  const password = config.bootstrapAdminPassword;
  if (!email || !name || !password) {
    throw new Error('No users exist. Set BOOTSTRAP_ADMIN_EMAIL, BOOTSTRAP_ADMIN_NAME and BOOTSTRAP_ADMIN_PASSWORD before first startup.');
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('BOOTSTRAP_ADMIN_EMAIL must be a valid email address.');
  if (password.length < 12) throw new Error('BOOTSTRAP_ADMIN_PASSWORD must contain at least 12 characters.');
  const adminRole = roles.findByCode('admin');
  if (!adminRole) throw new Error('Admin role is missing. Run the database migration before startup.');
  users.create({
    id: `user_${randomUUID()}`,
    email,
    name,
    roleId: adminRole.id,
    passwordHash: hashPassword(password),
    status: 'active',
  });
}
