import type { AuditEventRecord } from '@gatehouse/contract';
import type { AuditRepository } from '../repositories/audit-repository.js';
import { newId, nowIso } from '../domain/utils.js';

export interface AuditInput {
  entityType: string;
  entityId: string;
  action: string;
  actor: string;
  actorUserId?: string | null;
  before?: unknown;
  after?: unknown;
  traceId: string;
  at?: string;
  workspaceId?: string | null;
}

/** Records business facts only; it never decides whether an action is allowed. */
export class AuditService {
  constructor(private readonly repository: AuditRepository) {}

  record(input: AuditInput): AuditEventRecord {
    const event: AuditEventRecord = {
      id: newId('audit'),
      entity_type: input.entityType,
      entity_id: input.entityId,
      action: input.action,
      actor: input.actor,
      actor_user_id: input.actorUserId ?? null,
      before: input.before ?? null,
      after: input.after ?? null,
      trace_id: input.traceId,
      workspace_id: input.workspaceId ?? null,
      created_at: input.at ?? nowIso(),
    };
    this.repository.append(event);
    return event;
  }
}
