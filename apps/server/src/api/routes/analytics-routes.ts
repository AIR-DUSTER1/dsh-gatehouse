import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../../app.js';
import { requestUser, requirePermission } from '../../auth.js';

const analyticsQuerySchema = z.object({ range: z.enum(['7d', '30d', '90d']).default('30d') });

export async function registerAnalyticsRoutes(app: FastifyInstance, context: AppContext): Promise<void> {
  app.get('/api/analytics/overview', async (request) => {
    const user = requestUser(request, context);
    requirePermission(user, 'analytics.global');
    const { range } = analyticsQuerySchema.parse(request.query);
    return context.analytics.globalOverview(range);
  });
}
