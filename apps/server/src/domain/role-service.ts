import type { PermissionCode, RoleRecord, User } from '@gatehouse/contract';
import type { Database } from '../db/database.js';
import { transaction } from '../db/database.js';
import { requirePermission } from '../auth.js';
import type { AuditService } from '../audit/audit-service.js';
import { DomainError, NotFoundError } from './errors.js';
import { newId, nowIso } from './utils.js';
import type { RoleRepository } from '../repositories/role-repository.js';

const ROLE_CODE_PATTERN = /^[a-z][a-z0-9_-]{2,31}$/;
const PERMISSION_DEPENDENCIES: Partial<Record<PermissionCode, PermissionCode[]>> = {
  'workspace.manage': ['workspace.read'],
  'member.manage': ['workspace.read'],
  'repository.manage': ['workspace.read'],
  'review.decide': ['review.read'],
  'review.reassign': ['review.read'],
  'schedule.control': ['schedule.read'],
  'settings.manage': ['settings.read'],
};

export interface RoleCreateInput {
  code: string;
  name: string;
  description?: string | undefined;
  permissions: PermissionCode[];
}

export interface RoleUpdateInput {
  name: string;
  description?: string | undefined;
  permissions: PermissionCode[];
}

export class RoleService {
  constructor(
    private readonly db: Database,
    private readonly roles: RoleRepository,
    private readonly audit: AuditService,
  ) {}

  list(user: User): RoleRecord[] {
    requirePermission(user, 'role.manage');
    return this.roles.list();
  }

  permissions(user: User) {
    requirePermission(user, 'role.manage');
    return this.roles.permissions();
  }

  create(input: RoleCreateInput, user: User, traceId: string, now = new Date()): RoleRecord {
    requirePermission(user, 'role.manage');
    if (!ROLE_CODE_PATTERN.test(input.code)) {
      throw new DomainError('INVALID_ROLE_CODE', '角色代码格式不正确', '使用 3-32 位小写字母、数字、下划线或短横线', 400);
    }
    if (this.roles.findByCode(input.code)) {
      throw new DomainError('ROLE_CODE_EXISTS', '角色代码已存在', '使用其他角色代码后重试', 409);
    }
    const permissions = this.validatePermissions(input.code, input.permissions);
    const at = nowIso(now);
    let created: RoleRecord | null = null;
    transaction(this.db, () => {
      created = this.roles.create({
        id: newId('role'), code: input.code, name: input.name.trim(), description: input.description?.trim() ?? '',
        permissions, createdAt: at,
      });
      this.audit.record({
        entityType: 'role', entityId: created.id, action: 'role.created', actor: user.name, actorUserId: user.id,
        before: null, after: { code: created.code, name: created.name, permissions: created.permissions },
        traceId, at,
      });
    });
    return created!;
  }

  update(id: string, input: RoleUpdateInput, user: User, traceId: string, now = new Date()): RoleRecord {
    requirePermission(user, 'role.manage');
    const role = this.roles.findById(id);
    if (!role) throw new NotFoundError('角色', id);
    if (role.code === 'admin' || !role.editable) {
      throw new DomainError('SYSTEM_ROLE_IMMUTABLE', '管理员角色不可编辑', '如需调整权限，请创建自定义角色', 409);
    }
    const permissions = this.validatePermissions(role.code, input.permissions);
    const at = nowIso(now);
    let updated: RoleRecord | null = null;
    transaction(this.db, () => {
      updated = this.roles.update(id, {
        name: input.name.trim(), description: input.description?.trim() ?? '', permissions, updatedAt: at,
      });
      this.audit.record({
        entityType: 'role', entityId: id, action: 'role.permissions.updated', actor: user.name, actorUserId: user.id,
        before: { name: role.name, description: role.description, permissions: role.permissions },
        after: { name: updated.name, description: updated.description, permissions: updated.permissions },
        traceId, at,
      });
    });
    return updated!;
  }

  archive(id: string, user: User, traceId: string, now = new Date()): RoleRecord {
    requirePermission(user, 'role.manage');
    const role = this.roles.findById(id);
    if (!role) throw new NotFoundError('角色', id);
    if (role.is_system || role.code === 'admin') {
      throw new DomainError('SYSTEM_ROLE_IMMUTABLE', '内置角色不可停用', '请创建自定义角色替代', 409);
    }
    if (role.user_count > 0) {
      throw new DomainError('ROLE_IN_USE', '该角色仍有关联用户', '先为这些用户分配其他角色', 409);
    }
    const at = nowIso(now);
    transaction(this.db, () => {
      this.roles.archive(id, at);
      this.audit.record({
        entityType: 'role', entityId: id, action: 'role.archived', actor: user.name, actorUserId: user.id,
        before: { status: role.status }, after: { status: 'archived' }, traceId, at,
      });
    });
    return this.roles.findById(id)!;
  }

  private validatePermissions(roleCode: string, input: PermissionCode[]): PermissionCode[] {
    const permissions = [...new Set(input)];
    const catalog = new Map(this.roles.permissions().map((permission) => [permission.code, permission]));
    for (const code of permissions) {
      if (!catalog.has(code)) {
        throw new DomainError('UNKNOWN_PERMISSION', `未知权限 ${code}`, '刷新权限目录后重新选择', 400);
      }
    }
    if (roleCode !== 'admin') {
      const forbidden = permissions.filter((code) => catalog.get(code)?.admin_only);
      if (forbidden.length > 0) {
        throw new DomainError('RESERVED_PERMISSION_FORBIDDEN', '自定义角色不能包含管理员保留权限', `移除权限：${forbidden.join(', ')}`, 403);
      }
    }
    for (const code of permissions) {
      for (const dependency of PERMISSION_DEPENDENCIES[code] ?? []) {
        if (!permissions.includes(dependency)) {
          throw new DomainError('PERMISSION_DEPENDENCY_MISSING', `权限 ${code} 依赖 ${dependency}`, '补齐依赖权限后重试', 400);
        }
      }
    }
    return permissions.sort();
  }
}
