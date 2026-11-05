import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { USER_STATUSES } from '@gatehouse/contract';
import type { AppContext } from '../../app.js';
import { requestUser } from '../../auth.js';
import { traceId } from '../request-context.js';

const querySchema = z.object({
  search: z.string().trim().max(120).optional(),
  status: z.enum(USER_STATUSES).optional(),
  role_id: z.string().min(1).optional(),
  page: z.coerce.number().int().positive().default(1),
  page_size: z.coerce.number().int().positive().max(100).default(20),
});
const createSchema = z.object({
  name: z.string().trim().min(1).max(80), email: z.string().email().max(200),
  role_id: z.string().min(1), workspace_ids: z.array(z.string().min(1)).max(100).default([]),
});
const updateSchema = z.object({
  name: z.string().trim().min(1).max(80), role_id: z.string().min(1),
  workspace_ids: z.array(z.string().min(1)).max(100),
});
const idSchema = z.object({ id: z.string().min(1) });

export async function registerUserRoutes(app: FastifyInstance, context: AppContext): Promise<void> {
  app.get('/api/users/options', async (request) => {
    const user = requestUser(request, context);
    return { items: context.userService.options(user), trace_id: traceId(request) };
  });

  app.get('/api/users', async (request) => {
    const user = requestUser(request, context);
    const query = querySchema.parse(request.query);
    const result = context.userService.list(user, {
      search: query.search, status: query.status, roleId: query.role_id, page: query.page, pageSize: query.page_size,
    });
    return { ...result, page: query.page, page_size: query.page_size, trace_id: traceId(request) };
  });

  app.post('/api/users', async (request) => {
    const user = requestUser(request, context);
    const body = createSchema.parse(request.body);
    const result = context.userService.create(user, {
      name: body.name, email: body.email, roleId: body.role_id, workspaceIds: body.workspace_ids,
    }, traceId(request));
    return { ...result, trace_id: traceId(request) };
  });

  app.get('/api/users/:id', async (request) => {
    const user = requestUser(request, context);
    const { id } = idSchema.parse(request.params);
    return { user: context.userService.detail(user, id), trace_id: traceId(request) };
  });

  app.patch('/api/users/:id', async (request) => {
    const user = requestUser(request, context);
    const { id } = idSchema.parse(request.params);
    const body = updateSchema.parse(request.body);
    return {
      user: context.userService.update(user, id, { name: body.name, roleId: body.role_id, workspaceIds: body.workspace_ids }, traceId(request)),
      trace_id: traceId(request),
    };
  });

  app.put('/api/users/:id/workspaces', async (request) => {
    const user = requestUser(request, context);
    const { id } = idSchema.parse(request.params);
    const body = z.object({ workspace_ids: z.array(z.string().min(1)).max(100) }).parse(request.body);
    const target = context.userService.detail(user, id);
    return {
      user: context.userService.update(user, id, { name: target.name, roleId: target.role_id, workspaceIds: body.workspace_ids }, traceId(request)),
      trace_id: traceId(request),
    };
  });

  app.post('/api/users/:id/disable', async (request) => {
    const user = requestUser(request, context);
    const { id } = idSchema.parse(request.params);
    return { user: context.userService.disable(user, id, traceId(request)), trace_id: traceId(request) };
  });

  app.post('/api/users/:id/enable', async (request) => {
    const user = requestUser(request, context);
    const { id } = idSchema.parse(request.params);
    return { user: context.userService.enable(user, id, traceId(request)), trace_id: traceId(request) };
  });

  app.post('/api/users/:id/invitations', async (request) => {
    const user = requestUser(request, context);
    const { id } = idSchema.parse(request.params);
    return { invitation: context.userService.resendInvite(user, id, traceId(request)), trace_id: traceId(request) };
  });

  app.post('/api/users/:id/password-reset', async (request) => {
    const user = requestUser(request, context);
    const { id } = idSchema.parse(request.params);
    return { reset: context.userService.issuePasswordReset(user, id, traceId(request)), trace_id: traceId(request) };
  });
}
