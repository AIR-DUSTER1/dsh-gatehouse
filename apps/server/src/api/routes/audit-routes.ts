import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../../app.js';
import { requestUser } from '../../auth.js';

const auditQuerySchema = z.object({
  workspace_id: z.string().min(1),
  entity_type: z.string().trim().max(100).optional(),
  entity_id: z.string().trim().max(200).optional(),
  action: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().positive().default(1),
  page_size: z.coerce.number().int().positive().max(100).default(30),
});

export async function registerAuditRoutes(app: FastifyInstance, context: AppContext): Promise<void> {
  app.get('/api/audit', async (request) => {
    const user = requestUser(request, context);
    const query = auditQuerySchema.parse(request.query);
    context.workspaceService.requireAccess(user, query.workspace_id);
    const result = context.query.listAudit({
      workspaceId: query.workspace_id,
      ...(query.entity_type ? { entityType: query.entity_type } : {}),
      ...(query.entity_id ? { entityId: query.entity_id } : {}),
      ...(query.action ? { action: query.action } : {}),
      page: query.page,
      pageSize: query.page_size,
    });
    return { items: result.items, total: result.total, page: query.page, page_size: query.page_size };
  });
}
