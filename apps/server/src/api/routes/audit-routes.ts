import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../../app.js';
import { requestUser } from '../../auth.js';

const auditQuerySchema = z.object({
  entity_type: z.string().trim().max(100).optional(),
  entity_id: z.string().trim().max(200).optional(),
  action: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().positive().default(1),
  page_size: z.coerce.number().int().positive().max(100).default(30),
});

export async function registerAuditRoutes(app: FastifyInstance, context: AppContext): Promise<void> {
  app.get('/api/audit', async (request) => {
    requestUser(request, context.config.sessionSecret);
    const query = auditQuerySchema.parse(request.query);
    const result = context.query.listAudit({
      ...(query.entity_type ? { entityType: query.entity_type } : {}),
      ...(query.entity_id ? { entityId: query.entity_id } : {}),
      ...(query.action ? { action: query.action } : {}),
      page: query.page,
      pageSize: query.page_size,
    });
    return { items: result.items, total: result.total, page: query.page, page_size: query.page_size };
  });
}
