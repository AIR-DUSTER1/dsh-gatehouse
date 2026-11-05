import { randomBytes, randomUUID } from 'node:crypto';
import type { User, UserStatus } from '@gatehouse/contract';
import type { AppConfig } from '../config.js';
import type { Database } from '../db/database.js';
import { transaction } from '../db/database.js';
import { generateActionToken, hashActionToken, hashPassword, requirePermission, validateNewPassword, verifyPassword } from '../auth.js';
import type { AuditService } from '../audit/audit-service.js';
import type { AuthEventRepository } from '../repositories/auth-event-repository.js';
import type { RoleRepository } from '../repositories/role-repository.js';
import type { UserRepository, UserListQuery } from '../repositories/user-repository.js';
import type { UserTokenRepository } from '../repositories/user-token-repository.js';
import type { WorkspaceStore } from '../repositories/workspace-repository.js';
import { DomainError, NotFoundError } from './errors.js';
import { newId, nowIso } from './utils.js';

const INVITE_TTL_MS = 72 * 60 * 60 * 1000;
const RESET_TTL_MS = 30 * 60 * 1000;
export interface UserCreateInput { name: string; email: string; roleId: string; workspaceIds: string[] }
export interface UserUpdateInput { name: string; roleId: string; workspaceIds: string[] }
export interface IssuedUserLink { url: string; expires_at: string }

export class UserService {
  constructor(
    private readonly db: Database,
    private readonly users: UserRepository,
    private readonly roles: RoleRepository,
    private readonly tokens: UserTokenRepository,
    private readonly authEvents: AuthEventRepository,
    private readonly audit: AuditService,
    private readonly workspaces: WorkspaceStore,
    private readonly config: Pick<AppConfig, 'webOrigin'>,
  ) {}

  list(user: User, query: UserListQuery): { items: User[]; total: number } {
    requirePermission(user, 'user.manage');
    return this.users.listPage(query);
  }

  detail(user: User, id: string): User {
    requirePermission(user, 'user.manage');
    const target = this.users.findById(id);
    if (!target) throw new NotFoundError('用户', id);
    return target;
  }

  options(user: User): User[] {
    requirePermission(user, 'member.manage');
    return this.users.list().filter((candidate) => candidate.status !== 'disabled');
  }

  create(user: User, input: UserCreateInput, traceId: string, now = new Date()): { user: User; invitation: IssuedUserLink } {
    requirePermission(user, 'user.manage');
    const email = input.email.trim().toLowerCase();
    if (this.users.emailExists(email)) throw new DomainError('DUPLICATE_USER_EMAIL', '该邮箱已存在', '使用其他邮箱后重试', 409);
    const role = this.requireActiveRole(input.roleId);
    const workspaceIds = this.uniqueWorkspaceIds(input.workspaceIds);
    const at = nowIso(now);
    const userId = `user_${randomUUID()}`;
    const placeholderPassword = hashPassword(randomBytes(32).toString('base64url'));
    let created: User | null = null;
    let invitation: IssuedUserLink | null = null;
    transaction(this.db, () => {
      created = this.users.create({ id: userId, email, name: input.name.trim(), roleId: role.id, passwordHash: placeholderPassword, status: 'invited', createdAt: at });
      for (const workspaceId of workspaceIds) this.workspaces.addMember(workspaceId, userId, at);
      invitation = this.issueLink(created, 'invite', user, traceId, now, INVITE_TTL_MS);
      this.audit.record({ entityType: 'user', entityId: userId, action: 'user.created', actor: user.name, actorUserId: user.id,
        before: null, after: { email, name: created.name, role: created.role, status: created.status, workspace_ids: workspaceIds }, traceId, at });
      this.auditWorkspaceChanges(user, userId, [], workspaceIds, traceId, at);
    });
    return { user: created!, invitation: invitation! };
  }
  update(user: User, id: string, input: UserUpdateInput, traceId: string, now = new Date()): User {
    requirePermission(user, 'user.manage');
    const target = this.users.findById(id);
    if (!target) throw new NotFoundError('用户', id);
    const role = this.requireActiveRole(input.roleId);
    if (target.id === user.id && role.code !== 'admin') throw new DomainError('SELF_DEMOTION_FORBIDDEN', '不能撤销自己的管理员角色', '请由另一位管理员操作', 409);
    if (target.status === 'active' && target.role === 'admin' && role.code !== 'admin' && this.users.countActiveAdmins() <= 1) throw new DomainError('LAST_ADMIN_REQUIRED', '系统必须至少保留一个管理员', '先指定另一位管理员', 409);
    const workspaceIds = this.uniqueWorkspaceIds(input.workspaceIds);
    const previousWorkspaces = this.users.getWorkspaceIds(id);
    const at = nowIso(now);
    transaction(this.db, () => {
      this.users.updateProfile(id, { name: input.name.trim(), roleId: role.id, updatedAt: at });
      const previousSet = new Set(previousWorkspaces);
      const nextSet = new Set(workspaceIds);
      for (const workspaceId of previousSet) if (!nextSet.has(workspaceId)) this.workspaces.removeMember(workspaceId, id);
      for (const workspaceId of nextSet) if (!previousSet.has(workspaceId)) this.workspaces.addMember(workspaceId, id, at);
      this.auditWorkspaceChanges(user, id, previousWorkspaces, workspaceIds, traceId, at);
      this.audit.record({ entityType: 'user', entityId: id, action: 'user.profile.updated', actor: user.name, actorUserId: user.id,
        before: { name: target.name, role: target.role, workspace_ids: previousWorkspaces },
        after: { name: input.name.trim(), role: role.code, workspace_ids: workspaceIds }, traceId, at });
    });
    return this.users.findById(id)!;
  }

  disable(user: User, id: string, traceId: string, now = new Date()): User {
    requirePermission(user, 'user.manage');
    const target = this.users.findById(id);
    if (!target) throw new NotFoundError('用户', id);
    if (target.id === user.id) throw new DomainError('SELF_DISABLE_FORBIDDEN', '不能停用自己的账号', '请由另一位管理员操作', 409);
    if (target.role === 'admin' && target.status === 'active' && this.users.countActiveAdmins() <= 1) throw new DomainError('LAST_ADMIN_REQUIRED', '系统必须至少保留一个管理员', '先指定另一位管理员', 409);
    const at = nowIso(now);
    transaction(this.db, () => {
      this.users.setStatus(id, 'disabled', user.id, at);
      this.audit.record({ entityType: 'user', entityId: id, action: 'user.disabled', actor: user.name, actorUserId: user.id,
        before: { status: target.status }, after: { status: 'disabled' }, traceId, at });
    });
    return this.users.findById(id)!;
  }

  enable(user: User, id: string, traceId: string, now = new Date()): User {
    requirePermission(user, 'user.manage');
    const target = this.users.findById(id);
    if (!target) throw new NotFoundError('用户', id);
    if (target.status !== 'disabled') throw new DomainError('USER_NOT_DISABLED', '该用户当前不是停用状态', '刷新用户状态后重试', 409);
    const at = nowIso(now);
    const nextStatus: UserStatus = target.password_changed_at ? 'active' : 'invited';
    transaction(this.db, () => {
      this.users.setStatus(id, nextStatus, user.id, at);
      this.audit.record({ entityType: 'user', entityId: id, action: 'user.enabled', actor: user.name, actorUserId: user.id,
        before: { status: target.status }, after: { status: nextStatus }, traceId, at });
    });
    return this.users.findById(id)!;
  }
  resendInvite(user: User, id: string, traceId: string, now = new Date()): IssuedUserLink {
    requirePermission(user, 'user.manage');
    const target = this.users.findById(id);
    if (!target) throw new NotFoundError('用户', id);
    if (target.status !== 'invited') throw new DomainError('USER_NOT_INVITED', '只有待激活用户需要发送邀请', '使用密码重置或启用账号', 409);
    let issued: IssuedUserLink | null = null;
    transaction(this.db, () => { issued = this.issueLink(target, 'invite', user, traceId, now, INVITE_TTL_MS); });
    return issued!;
  }

  issuePasswordReset(user: User, id: string, traceId: string, now = new Date()): IssuedUserLink {
    requirePermission(user, 'user.manage');
    const target = this.users.findById(id);
    if (!target) throw new NotFoundError('用户', id);
    if (target.status !== 'active') throw new DomainError('USER_NOT_ACTIVE', '只有正常账号可以重置密码', '先启用账号或重新发送邀请', 409);
    let issued: IssuedUserLink | null = null;
    transaction(this.db, () => {
      issued = this.issueLink(target, 'reset_password', user, traceId, now, RESET_TTL_MS);
      this.audit.record({ entityType: 'user', entityId: id, action: 'user.password_reset.issued', actor: user.name, actorUserId: user.id,
        before: null, after: { expires_at: issued.expires_at }, traceId, at: nowIso(now) });
    });
    return issued!;
  }

  acceptInvite(token: string, password: string, traceId: string, now = new Date()): User {
    const at = nowIso(now);
    const tokenRow = this.tokens.findValid(hashActionToken(token), 'invite', at);
    if (!tokenRow) throw new DomainError('INVITE_INVALID_OR_EXPIRED', '邀请链接无效或已过期', '请让管理员重新发送邀请', 400);
    const target = this.users.findById(tokenRow.user_id);
    if (!target || target.status !== 'invited') throw new DomainError('INVITE_INVALID_OR_EXPIRED', '邀请链接无效或已过期', '请让管理员重新发送邀请', 400);
    validateNewPassword(password, target.email);
    transaction(this.db, () => {
      if (!this.tokens.consume(tokenRow.id, at)) throw new DomainError('INVITE_INVALID_OR_EXPIRED', '邀请链接无效或已过期', '请让管理员重新发送邀请', 400);
      this.users.setPassword(target.id, hashPassword(password), at);
      this.authEvents.record({ id: newId('auth'), userId: target.id, eventType: 'auth.invite.accepted', outcome: 'success', traceId, createdAt: at });
      this.audit.record({ entityType: 'user', entityId: target.id, action: 'auth.invite.accepted', actor: target.name, actorUserId: target.id,
        before: { status: 'invited' }, after: { status: 'active' }, traceId, at });
    });
    return this.users.findById(target.id)!;
  }

  completePasswordReset(token: string, password: string, traceId: string, now = new Date()): void {
    const at = nowIso(now);
    const tokenRow = this.tokens.findValid(hashActionToken(token), 'reset_password', at);
    if (!tokenRow) throw new DomainError('RESET_TOKEN_INVALID_OR_EXPIRED', '重置链接无效或已过期', '请让管理员重新签发', 400);
    const target = this.users.findById(tokenRow.user_id);
    if (!target || target.status !== 'active') throw new DomainError('RESET_TOKEN_INVALID_OR_EXPIRED', '重置链接无效或已过期', '请让管理员重新签发', 400);
    validateNewPassword(password, target.email);
    transaction(this.db, () => {
      if (!this.tokens.consume(tokenRow.id, at)) throw new DomainError('RESET_TOKEN_INVALID_OR_EXPIRED', '重置链接无效或已过期', '请让管理员重新签发', 400);
      this.users.setPassword(target.id, hashPassword(password), at);
      this.authEvents.record({ id: newId('auth'), userId: target.id, eventType: 'auth.password.reset', outcome: 'success', traceId, createdAt: at });
      this.audit.record({ entityType: 'user', entityId: target.id, action: 'auth.password.reset', actor: target.name, actorUserId: target.id,
        before: null, after: { password_changed_at: at }, traceId, at });
    });
  }
  changePassword(user: User, currentPassword: string, newPassword: string, traceId: string, now = new Date()): User {
    const stored = this.users.findByIdWithPassword(user.id);
    if (!stored || !verifyPassword(currentPassword, stored.password_hash)) throw new DomainError('CURRENT_PASSWORD_INVALID', '当前密码不正确', '重新输入当前密码', 400);
    validateNewPassword(newPassword, user.email);
    const at = nowIso(now);
    transaction(this.db, () => {
      this.users.setPassword(user.id, hashPassword(newPassword), at);
      this.authEvents.record({ id: newId('auth'), userId: user.id, eventType: 'auth.password.changed', outcome: 'success', traceId, createdAt: at });
      this.audit.record({ entityType: 'user', entityId: user.id, action: 'auth.password.changed', actor: user.name, actorUserId: user.id,
        before: null, after: { password_changed_at: at }, traceId, at });
    });
    return this.users.findById(user.id)!;
  }

  recordLogin(userId: string, traceId: string, at = nowIso(new Date())): void {
    this.users.recordLogin(userId, at);
    this.authEvents.record({ id: newId('auth'), userId, eventType: 'auth.login.succeeded', outcome: 'success', traceId, createdAt: at });
  }

  recordLoginFailure(userId: string | null, traceId: string, at = nowIso(new Date())): void {
    this.authEvents.record({ id: newId('auth'), userId, eventType: 'auth.login.failed', outcome: 'failure', reasonCode: 'INVALID_CREDENTIALS', traceId, createdAt: at });
  }

  private issueLink(target: User, purpose: 'invite' | 'reset_password', actor: User, traceId: string, now: Date, ttlMs: number): IssuedUserLink {
    const token = generateActionToken();
    const at = nowIso(now);
    const expiresAt = new Date(now.getTime() + ttlMs).toISOString();
    this.tokens.create({ id: newId('user_token'), userId: target.id, purpose, tokenHash: token.hash, expiresAt, createdBy: actor.id, createdAt: at });
    const path = purpose === 'invite' ? '/accept-invite' : '/reset-password';
    const url = `${this.config.webOrigin.replace(/\/$/, '')}${path}#token=${encodeURIComponent(token.token)}`;
    if (purpose === 'invite') {
      this.audit.record({ entityType: 'user', entityId: target.id, action: 'user.invitation.issued', actor: actor.name, actorUserId: actor.id,
        before: null, after: { expires_at: expiresAt }, traceId, at });
    }
    return { url, expires_at: expiresAt };
  }

  private requireActiveRole(roleId: string) {
    const role = this.roles.findById(roleId);
    if (!role || role.status !== 'active') throw new DomainError('ROLE_NOT_FOUND', '角色不存在或已停用', '刷新角色列表后重新选择', 404);
    return role;
  }

  private uniqueWorkspaceIds(workspaceIds: string[]): string[] {
    const unique = [...new Set(workspaceIds)];
    for (const workspaceId of unique) if (!this.workspaces.get(workspaceId)) throw new NotFoundError('工作区', workspaceId);
    return unique;
  }

  private auditWorkspaceChanges(actor: User, userId: string, before: string[], after: string[], traceId: string, at: string): void {
    if (before.length === after.length && before.every((id) => after.includes(id))) return;
    this.audit.record({ entityType: 'user', entityId: userId, action: 'user.workspaces.updated', actor: actor.name, actorUserId: actor.id,
      before: { workspace_ids: before }, after: { workspace_ids: after }, traceId, at });
  }
}
