import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import {
  repositoryConfigInputSchema,
  repositoryDescriptionInputSchema,
  routingReassignInputSchema,
  workspaceCreateInputSchema,
  workspaceUpdateInputSchema,
} from '@gatehouse/contract';
import type { AppContext } from '../../app.js';
import { requestUser, requireRole } from '../../auth.js';
import { DomainError, NotFoundError } from '../../domain/errors.js';
import { traceId } from '../request-context.js';

const descriptionConfirmationSchema = repositoryDescriptionInputSchema.extend({
  source_fingerprint: z.string().regex(/^sha256:[a-f0-9]{64}$/).optional(),
  generated_at: z.iso.datetime({ offset: true }).optional(),
  model: z.string().min(1).max(200).optional(),
});

export async function registerWorkspaceRoutes(app: FastifyInstance, context: AppContext): Promise<void> {
  app.get('/api/workspaces', async (request) => {
    const user = requestUser(request, context.config.sessionSecret);
    return { items: context.workspaceService.list(user) };
  });

  app.post('/api/workspaces', async (request) => {
    const user = requestUser(request, context.config.sessionSecret);
    const input = workspaceCreateInputSchema.parse(request.body);
    const trace = traceId(request);
    return { workspace: context.workspaceService.create(input, user, trace), trace_id: trace };
  });

  app.get('/api/workspaces/:id', async (request) => {
    const user = requestUser(request, context.config.sessionSecret);
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    return { workspace: context.workspaceService.detail(user, id) };
  });

  app.put('/api/workspaces/:id', async (request) => {
    const user = requestUser(request, context.config.sessionSecret);
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const input = workspaceUpdateInputSchema.parse(request.body);
    const trace = traceId(request);
    return { workspace: context.workspaceService.update(id, {
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.description === undefined ? {} : { description: input.description }),
    }, user, trace), trace_id: trace };
  });

  app.post('/api/workspaces/:id/disable', async (request) => {
    const user = requestUser(request, context.config.sessionSecret);
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const trace = traceId(request);
    return { workspace: await context.workspaceService.disable(id, user, trace), trace_id: trace };
  });

  app.post('/api/workspaces/:id/repositories', async (request) => {
    const user = requestUser(request, context.config.sessionSecret);
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const input = repositoryConfigInputSchema.parse(request.body);
    const trace = traceId(request);
    return { repository: context.workspaceService.addRepository(id, input, user, trace), trace_id: trace };
  });

  app.post('/api/repositories/:id/validate', async (request) => {
    const user = requestUser(request, context.config.sessionSecret);
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const trace = traceId(request);
    return { discovery: await context.workspaceService.validateRepository(id, user, trace), trace_id: trace };
  });

  app.post('/api/repositories/:id/describe', async (request) => {
    const user = requestUser(request, context.config.sessionSecret);
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const trace = traceId(request);
    return { suggestion: await context.workspaceService.describeRepository(id, user, trace), trace_id: trace };
  });

  app.put('/api/repositories/:id/description', async (request) => {
    const user = requestUser(request, context.config.sessionSecret);
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const input = descriptionConfirmationSchema.parse(request.body);
    const trace = traceId(request);
    return { repository: context.workspaceService.confirmDescription(id, input, user, trace), trace_id: trace };
  });

  app.post('/api/workspaces/sync', async (request) => {
    const user = requestUser(request, context.config.sessionSecret);
    const trace = traceId(request);
    return { sync: await context.workspaceService.syncWorkspaces(user, trace), trace_id: trace };
  });

  app.get('/api/workspaces/:id/health', async (request) => {
    const user = requestUser(request, context.config.sessionSecret);
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const workspace = context.workspaceService.detail(user, id);
    return { workspace_id: id, status: workspace.status, repositories: workspace.repositories.map((repository) => ({
      id: repository.id, provider: repository.provider, repository_key: repository.repository_key,
      status: repository.status, health_state: repository.health_state, health_detail: repository.health_detail,
      health_checked_at: repository.health_checked_at,
    })), bindings: workspace.source_bindings };
  });

  app.get('/api/workspaces/:id/members', async (request) => {
    const user = requestUser(request, context.config.sessionSecret);
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const memberIds = new Set(context.workspaceService.members(id, user).map((member) => member.user_id));
    return { items: context.users.list().filter((candidate) => memberIds.has(candidate.id)) };
  });

  app.put('/api/workspaces/:id/members/:userId', async (request) => {
    const user = requestUser(request, context.config.sessionSecret);
    requireRole(user, ['admin']);
    const { id, userId } = z.object({ id: z.string().min(1), userId: z.string().min(1) }).parse(request.params);
    if (!context.users.list().some((candidate) => candidate.id === userId)) throw new NotFoundError('用户', userId);
    const trace = traceId(request);
    context.workspaceService.addMember(id, userId, user, trace);
    return { ok: true, trace_id: trace };
  });

  app.delete('/api/workspaces/:id/members/:userId', async (request) => {
    const user = requestUser(request, context.config.sessionSecret);
    requireRole(user, ['admin']);
    const { id, userId } = z.object({ id: z.string().min(1), userId: z.string().min(1) }).parse(request.params);
    if (user.id === userId) throw new DomainError('CANNOT_REMOVE_SELF', '不能移除自己的工作区成员权限', '请由另一位管理员操作', 409);
    const trace = traceId(request);
    context.workspaceService.removeMember(id, userId, user, trace);
    return { ok: true, trace_id: trace };
  });

  app.post('/api/proposals/:id/reassign', async (request) => {
    const user = requestUser(request, context.config.sessionSecret);
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const input = routingReassignInputSchema.parse(request.body);
    const trace = traceId(request);
    await context.workspaceService.reassignProposal(id, input, user, trace);
    return { ok: true, detail: context.query.getProposalDetail(id), trace_id: trace };
  });
}
