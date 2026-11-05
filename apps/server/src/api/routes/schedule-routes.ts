import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../../app.js';
import { requestUser } from '../../auth.js';
import { traceId } from '../request-context.js';
import { scheduleChangeInputSchema, scheduleWithdrawInputSchema } from '@gatehouse/contract';
import { DomainError, NotFoundError } from '../../domain/errors.js';

export async function registerScheduleRoutes(app: FastifyInstance, context: AppContext): Promise<void> {
  app.get('/api/schedule', async (request) => {
    const user = requestUser(request, context);
    const { workspace_id: workspaceId } = z.object({ workspace_id: z.string().min(1) }).parse(request.query);
    context.workspaceService.requireAccess(user, workspaceId);
    const items = context.query.listSchedules(workspaceId);
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
    const user = requestUser(request, context);
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    requireScheduleAccess(context, user, id);
    const trace = traceId(request);
    context.scheduleControl.pause(id, user, trace);
    return { schedule: context.schedules.get(id), trace_id: trace };
  });

  app.post('/api/schedule/:id/resume', async (request) => {
    const user = requestUser(request, context);
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    requireScheduleAccess(context, user, id);
    const trace = traceId(request);
    context.scheduleControl.resume(id, user, trace);
    return { schedule: context.schedules.get(id), trace_id: trace };
  });

  app.post('/api/schedule/:id/reschedule', async (request) => {
    const user = requestUser(request, context);
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    requireScheduleAccess(context, user, id);
    const input = scheduleChangeInputSchema.parse(request.body);
    const trace = traceId(request);
    context.scheduleControl.reschedule(id, input, user, trace);
    await context.dispatcher.drain();
    return { schedule: context.schedules.get(id), trace_id: trace };
  });

  app.post('/api/schedule/:id/withdraw', async (request) => {
    const user = requestUser(request, context);
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    requireScheduleAccess(context, user, id);
    const input = scheduleWithdrawInputSchema.parse(request.body);
    const trace = traceId(request);
    context.scheduleControl.withdraw(id, input, user, trace);
    await context.dispatcher.drain();
    return { schedule: context.schedules.get(id), trace_id: trace };
  });

  app.post('/api/schedule/:id/retry-execution', async (request) => {
    const user = requestUser(request, context);
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    requireScheduleAccess(context, user, id);
    const trace = traceId(request);
    context.scheduleControl.retryExecution(id, user, trace);
    await context.dispatcher.drain();
    return { schedule: context.schedules.get(id), trace_id: trace };
  });
}

function requireScheduleAccess(context: AppContext, user: ReturnType<typeof requestUser>, scheduleId: string): void {
  const schedule = context.schedules.get(scheduleId);
  if (!schedule) throw new NotFoundError('排期', scheduleId);
  const proposal = context.proposals.get(schedule.proposal_id);
  if (!proposal) throw new NotFoundError('提案', schedule.proposal_id);
  const reviewCase = context.cases.get(proposal.review_case_id);
  const workspaceId = schedule.workspace_id ?? proposal.workspace_id ?? reviewCase?.workspace_id;
  if (!workspaceId) throw new DomainError('WORKSPACE_REQUIRED', '该排期尚未归属工作区', '完成数据迁移后重试', 409);
  context.workspaceService.requireAccess(user, workspaceId);
}
