import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../../app.js';
import { requestUser } from '../../auth.js';
import { traceId } from '../request-context.js';

export async function registerScheduleRoutes(app: FastifyInstance, context: AppContext): Promise<void> {
  app.get('/api/schedule', async (request) => {
    requestUser(request, context.config.sessionSecret);
    const items = context.query.listSchedules();
    const maxConcurrency = Number.parseInt(context.settings.get('max_concurrency') ?? '', 10) || context.config.scheduleMaxConcurrency;
    return {
      items,
      metrics: {
        executing: items.filter((item) => item.status === 'executing').length,
        max_concurrency: maxConcurrency,
        due_today: items.filter((item) => item.status === 'scheduled' && item.schedule_at.slice(0, 10) === new Date().toISOString().slice(0, 10)).length,
        overdue: items.filter((item) => item.status === 'scheduled' && Date.parse(item.schedule_at) < Date.now()).length,
        blocked: items.filter((item) => item.status === 'failed').length,
      },
    };
  });

  app.post('/api/schedule/:id/pause', async (request) => {
    const user = requestUser(request, context.config.sessionSecret);
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const trace = traceId(request);
    context.scheduleControl.pause(id, user, trace);
    return { schedule: context.schedules.get(id), trace_id: trace };
  });

  app.post('/api/schedule/:id/resume', async (request) => {
    const user = requestUser(request, context.config.sessionSecret);
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const trace = traceId(request);
    context.scheduleControl.resume(id, user, trace);
    return { schedule: context.schedules.get(id), trace_id: trace };
  });
}
