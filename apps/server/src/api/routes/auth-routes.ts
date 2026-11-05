import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../../app.js';
import { DUMMY_PASSWORD_HASH, LoginRateLimiter, issueToken, requestUser, verifyPassword } from '../../auth.js';
import { DomainError } from '../../domain/errors.js';
import { traceId } from '../request-context.js';

const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1).max(128) });
const tokenPasswordSchema = z.object({ token: z.string().min(20), password: z.string().min(1).max(128) });
const changePasswordSchema = z.object({ current_password: z.string().min(1).max(128), new_password: z.string().min(1).max(128) });

export async function registerAuthRoutes(app: FastifyInstance, context: AppContext): Promise<void> {
  const limiter = new LoginRateLimiter();

  app.post('/api/auth/login', async (request) => {
    const body = loginSchema.parse(request.body);
    const normalizedEmail = body.email.toLowerCase();
    const trace = traceId(request);
    const rateKey = `${normalizedEmail}|${request.ip}`;
    limiter.check(rateKey);
    const user = context.users.findByEmail(normalizedEmail);
    const passwordOk = verifyPassword(body.password, user?.password_hash ?? DUMMY_PASSWORD_HASH);
    if (!user || !passwordOk || user.status !== 'active') {
      limiter.fail(rateKey);
      context.userService.recordLoginFailure(user?.id ?? null, trace);
      throw new DomainError('INVALID_CREDENTIALS', '邮箱或密码错误', '检查账号密码后重试', 401);
    }
    limiter.succeed(rateKey);
    context.userService.recordLogin(user.id, trace);
    const session = issueToken(user.id, user.session_version, context.config.sessionSecret, context.config.sessionTtlSeconds);
    const { password_hash: _password, session_version: _sessionVersion, ...safeUser } = user;
    return { user: safeUser, token: session.token, expires_at: session.expiresAt, trace_id: trace };
  });

  app.get('/api/auth/me', async (request) => ({ user: requestUser(request, context), trace_id: traceId(request) }));

  app.post('/api/auth/invitations/accept', async (request) => {
    const body = tokenPasswordSchema.parse(request.body);
    const trace = traceId(request);
    const activated = context.userService.acceptInvite(body.token, body.password, trace);
    const stored = context.users.findByIdWithPassword(activated.id)!;
    const session = issueToken(stored.id, stored.session_version, context.config.sessionSecret, context.config.sessionTtlSeconds);
    const { password_hash: _password, session_version: _sessionVersion, ...user } = stored;
    return { user, token: session.token, expires_at: session.expiresAt, trace_id: trace };
  });

  app.post('/api/auth/password-reset/complete', async (request) => {
    const body = tokenPasswordSchema.parse(request.body);
    const trace = traceId(request);
    context.userService.completePasswordReset(body.token, body.password, trace);
    return { ok: true, trace_id: trace };
  });

  app.post('/api/auth/password/change', async (request) => {
    const user = requestUser(request, context);
    const body = changePasswordSchema.parse(request.body);
    const trace = traceId(request);
    const updated = context.userService.changePassword(user, body.current_password, body.new_password, trace);
    const stored = context.users.findByIdWithPassword(updated.id)!;
    const session = issueToken(stored.id, stored.session_version, context.config.sessionSecret, context.config.sessionTtlSeconds);
    const { password_hash: _password, session_version: _sessionVersion, ...safeUser } = stored;
    return { user: safeUser, token: session.token, expires_at: session.expiresAt, trace_id: trace };
  });
}
