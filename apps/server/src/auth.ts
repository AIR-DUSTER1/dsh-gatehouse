import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import type { Role, User } from '@gatehouse/contract';
import { DomainError } from './domain/errors.js';

interface TokenPayload extends User { exp: number; iat: number }

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const candidate = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

function sign(value: string, secret: string): string {
  return createHmac('sha256', secret).update(value).digest('base64url');
}

export function issueToken(user: User, secret: string, ttlSeconds: number): { token: string; expiresAt: string } {
  const now = Math.floor(Date.now() / 1000);
  const payload: TokenPayload = { ...user, iat: now, exp: now + ttlSeconds };
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return { token: `${encoded}.${sign(encoded, secret)}`, expiresAt: new Date(payload.exp * 1000).toISOString() };
}

export function verifyToken(token: string, secret: string): User {
  const [encoded, signature] = token.split('.');
  if (!encoded || !signature) throw new DomainError('UNAUTHORIZED', '登录凭证无效', '请重新登录', 401);
  const expected = Buffer.from(sign(encoded, secret));
  const received = Buffer.from(signature);
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
    throw new DomainError('UNAUTHORIZED', '登录凭证签名无效', '请重新登录', 401);
  }
  const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as TokenPayload;
  if (payload.exp <= Math.floor(Date.now() / 1000)) {
    throw new DomainError('SESSION_EXPIRED', '登录已过期', '请重新登录', 401);
  }
  return { id: payload.id, name: payload.name, email: payload.email, role: payload.role };
}

export function requestUser(request: FastifyRequest, secret: string): User {
  const authorization = request.headers.authorization;
  if (!authorization?.startsWith('Bearer ')) {
    throw new DomainError('UNAUTHORIZED', '请先登录', '使用账号登录后重试', 401);
  }
  return verifyToken(authorization.slice('Bearer '.length), secret);
}

export function requireRole(user: User, roles: Role[]): void {
  if (!roles.includes(user.role)) {
    throw new DomainError('FORBIDDEN', '当前角色无权执行该操作', `需要 ${roles.join(' / ')} 角色`, 403);
  }
}
