import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import type { PermissionCode, User } from '@gatehouse/contract';
import type { AppConfig } from './config.js';
import { DomainError } from './domain/errors.js';
import type { UserRepository } from './repositories/user-repository.js';

interface TokenPayload {
  sub: string;
  sv: number;
  iat: number;
  exp: number;
}

export interface SessionIdentity {
  userId: string;
  sessionVersion: number;
  expiresAt: number;
}

interface AuthContext {
  config: Pick<AppConfig, 'sessionSecret'>;
  users: Pick<UserRepository, 'findByIdWithPassword'>;
}

export const DUMMY_PASSWORD_HASH = hashPassword('dummy-password-value-not-used');

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  try {
    const candidate = scryptSync(password, salt, 64);
    const expected = Buffer.from(hash, 'hex');
    return candidate.length === expected.length && timingSafeEqual(candidate, expected);
  } catch {
    return false;
  }
}

export function validateNewPassword(password: string, email?: string): void {
  if (password.length < 12) {
    throw new DomainError('PASSWORD_TOO_SHORT', '密码至少需要 12 个字符', '使用更长的密码后重试', 400);
  }
  if (password.length > 128) {
    throw new DomainError('PASSWORD_TOO_LONG', '密码不能超过 128 个字符', '缩短密码后重试', 400);
  }
  if (!password.trim()) {
    throw new DomainError('PASSWORD_INVALID', '密码不能只包含空格', '输入有效密码后重试', 400);
  }
  if (email && password.toLowerCase() === email.toLowerCase()) {
    throw new DomainError('PASSWORD_INVALID', '密码不能与邮箱相同', '使用独立的强密码', 400);
  }
}

export function generateActionToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashActionToken(token) };
}

export function hashActionToken(token: string): string {
  return `sha256:${createHash('sha256').update(token).digest('hex')}`;
}

function sign(value: string, secret: string): string {
  return createHmac('sha256', secret).update(value).digest('base64url');
}

export function issueToken(userId: string, sessionVersion: number, secret: string, ttlSeconds: number): { token: string; expiresAt: string } {
  const now = Math.floor(Date.now() / 1000);
  const payload: TokenPayload = { sub: userId, sv: sessionVersion, iat: now, exp: now + ttlSeconds };
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return { token: `${encoded}.${sign(encoded, secret)}`, expiresAt: new Date(payload.exp * 1000).toISOString() };
}

export function verifyToken(token: string, secret: string): SessionIdentity {
  const [encoded, signature] = token.split('.');
  if (!encoded || !signature) throw new DomainError('UNAUTHORIZED', '登录凭证无效', '请重新登录', 401);
  const expected = Buffer.from(sign(encoded, secret));
  const received = Buffer.from(signature);
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
    throw new DomainError('UNAUTHORIZED', '登录凭证签名无效', '请重新登录', 401);
  }
  let payload: TokenPayload;
  try {
    payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as TokenPayload;
  } catch {
    throw new DomainError('UNAUTHORIZED', '登录凭证无效', '请重新登录', 401);
  }
  if (!payload.sub || !Number.isInteger(payload.sv) || payload.exp <= Math.floor(Date.now() / 1000)) {
    throw new DomainError('SESSION_EXPIRED', '登录已过期', '请重新登录', 401);
  }
  return { userId: payload.sub, sessionVersion: payload.sv, expiresAt: payload.exp };
}

export function requestUser(request: FastifyRequest, context: AuthContext): User {
  const authorization = request.headers.authorization;
  if (!authorization?.startsWith('Bearer ')) {
    throw new DomainError('UNAUTHORIZED', '请先登录', '使用账号登录后重试', 401);
  }
  const identity = verifyToken(authorization.slice('Bearer '.length), context.config.sessionSecret);
  const stored = context.users.findByIdWithPassword(identity.userId);
  if (!stored || stored.status !== 'active' || stored.session_version !== identity.sessionVersion) {
    throw new DomainError('ACCOUNT_DISABLED', '账号不可用或会话已失效', '请重新登录', 401);
  }
  const { password_hash: _password, session_version: _sessionVersion, ...user } = stored;
  return user;
}

export function hasPermission(user: Pick<User, 'permissions'>, permission: PermissionCode): boolean {
  return user.permissions.includes(permission);
}

export function requirePermission(user: Pick<User, 'permissions'>, permission: PermissionCode): void {
  if (!hasPermission(user, permission)) {
    throw new DomainError('FORBIDDEN', '当前账号无权执行该操作', `需要 ${permission} 权限`, 403);
  }
}

export class LoginRateLimiter {
  private readonly attempts = new Map<string, { count: number; resetAt: number }>();

  check(key: string, now = Date.now()): void {
    const entry = this.attempts.get(key);
    if (!entry) return;
    if (entry.resetAt <= now) { this.attempts.delete(key); return; }
    if (entry.count >= 5) {
      throw new DomainError('LOGIN_RATE_LIMITED', '登录尝试过于频繁', '请 15 分钟后重试', 429);
    }
  }

  fail(key: string, now = Date.now()): void {
    const entry = this.attempts.get(key);
    if (!entry || entry.resetAt <= now) {
      this.attempts.set(key, { count: 1, resetAt: now + 15 * 60_000 });
      return;
    }
    entry.count += 1;
  }

  succeed(key: string): void {
    this.attempts.delete(key);
  }
}
