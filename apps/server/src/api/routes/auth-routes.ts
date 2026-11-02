import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../../app.js';
import { issueToken, requestUser, verifyPassword } from '../../auth.js';
import { DomainError } from '../../domain/errors.js';
import { traceId } from '../request-context.js';

const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });

export async function registerAuthRoutes(app: FastifyInstance, context: AppContext): Promise<void> {
  app.post('/api/auth/login', async (request) => {
    const body = loginSchema.parse(request.body);
    const user = context.users.findByEmail(body.email.toLowerCase());
    if (!user || !verifyPassword(body.password, user.password_hash)) {
      throw new DomainError('INVALID_CREDENTIALS', '邮箱或密码错误', '检查账号密码后重试', 401);
    }
    const { password_hash: _ignored, ...safeUser } = user;
    const session = issueToken(safeUser, context.config.sessionSecret, context.config.sessionTtlSeconds);
    return { user: safeUser, token: session.token, expires_at: session.expiresAt, trace_id: traceId(request) };
  });

  app.get('/api/auth/me', async (request) => ({ user: requestUser(request, context.config.sessionSecret), trace_id: traceId(request) }));
  app.get('/api/users', async (request) => {
    requestUser(request, context.config.sessionSecret);
    return { items: context.users.list() };
  });
}
