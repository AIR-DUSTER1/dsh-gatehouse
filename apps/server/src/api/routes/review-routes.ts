import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { CASE_STATUSES, RISK_LEVELS, SOURCES, decisionInputSchema } from '@gatehouse/contract';
import type { AppContext } from '../../app.js';
import { requestUser } from '../../auth.js';
import { DomainError, NotFoundError } from '../../domain/errors.js';
import { headerValue, traceId } from '../request-context.js';

const queueQuerySchema = z.object({
  status: z.enum(CASE_STATUSES).optional(),
  risk: z.enum(RISK_LEVELS).optional(),
  source: z.enum(SOURCES).optional(),
  search: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().positive().default(1),
  page_size: z.coerce.number().int().positive().max(100).default(20),
});

export async function registerReviewRoutes(app: FastifyInstance, context: AppContext): Promise<void> {
  app.get('/api/review-cases', async (request) => {
    requestUser(request, context.config.sessionSecret);
    const query = queueQuerySchema.parse(request.query);
    const result = context.query.listCases({
      ...(query.status ? { status: query.status } : {}),
      ...(query.risk ? { risk: query.risk } : {}),
      ...(query.source ? { source: query.source } : {}),
      ...(query.search ? { search: query.search } : {}),
      page: query.page,
      pageSize: query.page_size,
    });
    return { items: result.items, total: result.total, page: query.page, page_size: query.page_size };
  });

  app.get('/api/review-cases/:id', async (request) => {
    requestUser(request, context.config.sessionSecret);
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    return context.query.getCaseDetail(id);
  });

  app.get('/api/proposals/:id', async (request) => {
    requestUser(request, context.config.sessionSecret);
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    return context.query.getProposalDetail(id);
  });

  app.post('/api/proposals/:id/decision', async (request) => {
    const user = requestUser(request, context.config.sessionSecret);
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const decision = decisionInputSchema.parse(request.body);
    const key = headerValue(request, 'idempotency-key');
    if (!key) throw new DomainError('IDEMPOTENCY_KEY_REQUIRED', '缺少 Idempotency-Key 请求头', '为本次审批生成唯一幂等键后重试', 400);
    const trace = traceId(request);
    const result = context.approval.decide({ proposalId: id, user, decision, idempotencyKey: key, traceId: trace });
    await context.dispatcher.drain();
    const proposal = context.proposals.get(id);
    if (!proposal) throw new NotFoundError('提案', id);
    const reviewCase = context.cases.getByProposalId(id);
    if (!reviewCase) throw new NotFoundError('复核需求', proposal.review_case_id);
    return {
      replayed: result.replayed,
      decision: result.decision,
      detail: context.query.getCaseDetail(reviewCase.id),
      trace_id: trace,
    };
  });

  app.get('/api/dashboard', async (request) => {
    requestUser(request, context.config.sessionSecret);
    return context.query.dashboard();
  });
}
