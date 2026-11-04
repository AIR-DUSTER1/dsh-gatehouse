import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../../app.js';
import { requestUser, requireRole } from '../../auth.js';
import { traceId } from '../request-context.js';

const settingsSchema = z.object({ max_concurrency: z.number().int().min(1).max(20) });

export async function registerSettingsRoutes(app: FastifyInstance, context: AppContext): Promise<void> {
  app.get('/api/settings', async (request) => {
    const user = requestUser(request, context.config.sessionSecret);
    const maxConcurrency = Number.parseInt(context.settings.get('max_concurrency') ?? '', 10) || context.config.scheduleMaxConcurrency;
    const workspaces = context.workspaceService.list(user);
    const monitoredRepositories = workspaces.flatMap((workspace) => workspace.repositories.map((repository) => ({
      workspace_id: workspace.id, workspace_name: workspace.name, provider: repository.provider,
      repository_key: repository.repository_key, status: repository.status,
    })));
    return {
      max_concurrency: maxConcurrency,
      plugin_mode: context.config.pluginMode,
      plugin_base_url: context.config.pluginMode === 'http' ? context.config.pluginBaseUrl : '本地 mock adapter',
      monitored_repository: monitoredRepositories[0]?.repository_key ?? null,
      monitored_repositories: monitoredRepositories,
      session_ttl_seconds: context.config.sessionTtlSeconds,
      users: context.users.list(),
      pending_outbox: context.outbox.pendingCount(),
    };
  });

  app.put('/api/settings', async (request) => {
    const user = requestUser(request, context.config.sessionSecret);
    requireRole(user, ['admin']);
    const body = settingsSchema.parse(request.body);
    const trace = traceId(request);
    const at = new Date().toISOString();
    const before = context.settings.get('max_concurrency');
    context.settings.set('max_concurrency', String(body.max_concurrency), at);
    context.audit.record({
      entityType: 'system', entityId: 'settings', action: 'settings.updated', actor: user.name,
      before: { max_concurrency: before }, after: { max_concurrency: body.max_concurrency }, traceId: trace, at,
    });
    return { ok: true, max_concurrency: body.max_concurrency, trace_id: trace };
  });
}
