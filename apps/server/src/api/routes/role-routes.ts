import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { PERMISSIONS } from '@gatehouse/contract';
import type { AppContext } from '../../app.js';
import { requestUser } from '../../auth.js';
import { traceId } from '../request-context.js';

const roleCreateSchema = z.object({
  code: z.string().min(3).max(32),
  name: z.string().trim().min(1).max(80),
  description: z.string().max(300).optional(),
  permissions: z.array(z.enum(PERMISSIONS)).min(1).max(PERMISSIONS.length),
});
const roleUpdateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().max(300).optional(),
  permissions: z.array(z.enum(PERMISSIONS)).min(1).max(PERMISSIONS.length),
});
const idSchema = z.object({ id: z.string().min(1) });

export async function registerRoleRoutes(app: FastifyInstance, context: AppContext): Promise<void> {
  app.get('/api/roles', async (request) => {
    const user = requestUser(request, context);
    return { items: context.roleService.list(user), trace_id: traceId(request) };
  });

  app.get('/api/permissions', async (request) => {
    const user = requestUser(request, context);
    return { items: context.roleService.permissions(user), trace_id: traceId(request) };
  });

  app.post('/api/roles', async (request) => {
    const user = requestUser(request, context);
    const body = roleCreateSchema.parse(request.body);
    return {
      role: context.roleService.create({ code: body.code, name: body.name, description: body.description, permissions: body.permissions }, user, traceId(request)),
      trace_id: traceId(request),
    };
  });

  app.patch('/api/roles/:id', async (request) => {
    const user = requestUser(request, context);
    const { id } = idSchema.parse(request.params);
    const body = roleUpdateSchema.parse(request.body);
    return {
      role: context.roleService.update(id, { name: body.name, description: body.description, permissions: body.permissions }, user, traceId(request)),
      trace_id: traceId(request),
    };
  });

  app.post('/api/roles/:id/archive', async (request) => {
    const user = requestUser(request, context);
    const { id } = idSchema.parse(request.params);
    return { role: context.roleService.archive(id, user, traceId(request)), trace_id: traceId(request) };
  });
}
