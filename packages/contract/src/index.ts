import { z } from 'zod';

/** Stable business states. Storage uses UTC; presentation formats in the user's timezone. */
export const PROPOSAL_STATUSES = [
  'pending_review',
  'info_requested',
  'approved',
  'rejected',
  'superseded',
  'scheduled',
  'executing',
  'completed',
  'failed',
] as const;
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];

export const CASE_STATUSES = PROPOSAL_STATUSES;
export type CaseStatus = ProposalStatus;

export const SCHEDULE_STATUSES = [
  'scheduled',
  'paused',
  'executing',
  'completed',
  'failed',
  'cancelled',
] as const;
export type ScheduleStatus = (typeof SCHEDULE_STATUSES)[number];

export const RISK_LEVELS = ['low', 'medium', 'high', 'critical'] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

export const SOURCES = ['feishu', 'github'] as const;
export type Source = (typeof SOURCES)[number];

export const DECISIONS = ['approve', 'reject', 'request_info'] as const;
export type DecisionType = (typeof DECISIONS)[number];

export const ROLES = ['viewer', 'reviewer', 'admin'] as const;
export type Role = (typeof ROLES)[number];

export const HASH_PATTERN = /^sha256:[a-f0-9]{64}$/;
export const hashSchema = z.string().regex(HASH_PATTERN, 'must be a sha256:<64 lowercase hex> value');
export const isoDateSchema = z.iso.datetime({ offset: true });

export interface User {
  id: string;
  name: string;
  role: Role;
  email: string;
}

export interface SessionUser extends User {
  token: string;
  expires_at: string;
}

export interface ReviewCaseRecord {
  id: string;
  plugin_case_id: string;
  source: Source;
  requester: string;
  title: string;
  requirement_text: string;
  requirement_hash: string;
  status: CaseStatus;
  risk_level: RiskLevel;
  source_context: string;
  message_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProposalRecord {
  id: string;
  review_case_id: string;
  assessment_revision: number;
  summary: string;
  scope: string[];
  scope_hash: string;
  rule_hits: string[];
  impact_files: string[];
  test_plan: string[];
  estimated_cost: string;
  risk: RiskLevel;
  risk_reason: string;
  status: ProposalStatus;
  created_at: string;
  updated_at: string;
}

export interface ReviewDecisionRecord {
  id: string;
  proposal_id: string;
  decision: DecisionType;
  reviewer: string;
  comment: string;
  created_at: string;
}

export interface ApprovalGrantRecord {
  id: string;
  proposal_id: string;
  reviewer: string;
  requirement_hash: string;
  scope_hash: string;
  approved_at: string;
  schedule_at: string;
  expires_at: string;
  consumed_at: string | null;
  status: 'active' | 'consumed' | 'revoked' | 'expired';
}

export interface ScheduleRecord {
  id: string;
  proposal_id: string;
  grant_id: string;
  schedule_at: string;
  expires_at: string;
  status: ScheduleStatus;
  approval_synced_at: string | null;
  attempts: number;
  max_attempts: number;
  last_error: string | null;
  execution_id: string | null;
  pr_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface AuditEventRecord {
  id: string;
  entity_type: string;
  entity_id: string;
  action: string;
  actor: string;
  before: unknown;
  after: unknown;
  trace_id: string;
  created_at: string;
}

export interface ReviewCaseDetail {
  review_case: ReviewCaseRecord;
  proposals: ProposalRecord[];
  decisions: ReviewDecisionRecord[];
  grant: ApprovalGrantRecord | null;
  schedule: ScheduleRecord | null;
  audit_events: AuditEventRecord[];
}

export interface ReviewQueueItem extends ReviewCaseRecord {
  latest_proposal_summary: string;
  rule_hits: string[];
}

export interface ScheduleListItem extends ScheduleRecord {
  review_case_id: string;
  title: string;
  requester: string;
  risk_level: RiskLevel;
  proposal_summary: string;
}

export interface QueueSummary {
  total: number;
  by_status: Record<string, number>;
  high_risk: number;
}

export interface DashboardStatistics {
  total_cases: number;
  pending_review: number;
  high_risk: number;
  average_review_minutes: number;
  execution_success_rate: number;
  approved_sla_rate: number;
  risk_distribution: Record<RiskLevel, number>;
  rule_hits: Array<{ rule: string; count: number }>;
  recent_activity: AuditEventRecord[];
}

export interface PluginEventEnvelope {
  version: '1.0';
  event_id: string;
  event_type:
    | 'proposal.created'
    | 'proposal.updated'
    | 'proposal.superseded'
    | 'execution.started'
    | 'execution.finished'
    | 'execution.failed';
  occurred_at: string;
  trace_id: string;
  data: Record<string, unknown>;
}

export const reviewCaseSchema = z.object({
  id: z.string().min(1),
  plugin_case_id: z.string().min(1),
  source: z.enum(SOURCES),
  requester: z.string().min(1),
  title: z.string().min(1),
  requirement_text: z.string().min(1),
  requirement_hash: hashSchema,
  status: z.enum(CASE_STATUSES),
  risk_level: z.enum(RISK_LEVELS),
  source_context: z.string().default(''),
  message_url: z.string().url().nullable().default(null),
  created_at: isoDateSchema,
  updated_at: isoDateSchema,
});

export const proposalInputSchema = z.object({
  id: z.string().min(1),
  review_case_id: z.string().min(1),
  assessment_revision: z.number().int().positive(),
  summary: z.string().min(1),
  scope: z.array(z.string().min(1)).min(1),
  scope_hash: hashSchema,
  rule_hits: z.array(z.string()),
  impact_files: z.array(z.string()),
  test_plan: z.array(z.string().min(1)).min(1),
  estimated_cost: z.string().min(1),
  risk: z.enum(RISK_LEVELS),
  risk_reason: z.string().min(1),
  status: z.enum(PROPOSAL_STATUSES),
  created_at: isoDateSchema,
  updated_at: isoDateSchema,
});

export const proposalCreatedDataSchema = z.object({
  case: reviewCaseSchema,
  proposal: proposalInputSchema,
});

export const executionDataSchema = z.object({
  proposal_id: z.string().min(1),
  execution_id: z.string().min(1),
  pr_url: z.string().url().nullable().optional(),
  error: z.string().optional(),
});

export const pluginEventSchema = z.object({
  version: z.literal('1.0'),
  event_id: z.string().min(1),
  event_type: z.enum([
    'proposal.created',
    'proposal.updated',
    'proposal.superseded',
    'execution.started',
    'execution.finished',
    'execution.failed',
  ]),
  occurred_at: isoDateSchema,
  trace_id: z.string().min(1),
  data: z.record(z.string(), z.unknown()),
});

export const decisionInputSchema = z.discriminatedUnion('decision', [
  z.object({
    decision: z.literal('approve'),
    comment: z.string().trim().min(2, '审批意见至少 2 个字符'),
    schedule_at: isoDateSchema,
    expires_at: isoDateSchema,
    timezone: z.string().min(1).default('Asia/Shanghai'),
    risk_confirmed: z.literal(true),
  }),
  z.object({
    decision: z.literal('reject'),
    comment: z.string().trim().min(2, '驳回原因至少 2 个字符'),
    risk_confirmed: z.literal(true),
  }),
  z.object({
    decision: z.literal('request_info'),
    comment: z.string().trim().min(2, '补充说明至少 2 个字符'),
    risk_confirmed: z.literal(true),
  }),
]);
export type DecisionInput = z.infer<typeof decisionInputSchema>;

export const approvalGrantSchema = z.object({
  id: z.string().min(1),
  proposal_id: z.string().min(1),
  reviewer: z.string().min(1),
  requirement_hash: hashSchema,
  scope_hash: hashSchema,
  approved_at: isoDateSchema,
  schedule_at: isoDateSchema,
  expires_at: isoDateSchema,
  consumed_at: isoDateSchema.nullable(),
  status: z.enum(['active', 'consumed', 'revoked', 'expired']),
});

export const pluginDecisionRequestSchema = z.object({
  proposal_id: z.string().min(1),
  decision: z.enum(DECISIONS),
  reviewer: z.string().min(1),
  comment: z.string().min(1),
  requirement_hash: hashSchema,
  scope_hash: hashSchema,
  schedule_at: isoDateSchema.optional(),
  expires_at: isoDateSchema.optional(),
  trace_id: z.string().min(1),
  idempotency_key: z.string().min(1),
});

export const pluginExecuteRequestSchema = z.object({
  proposal_id: z.string().min(1),
  grant_id: z.string().min(1),
  requirement_hash: hashSchema,
  scope_hash: hashSchema,
  execution_id: z.string().min(1),
  trace_id: z.string().min(1),
  idempotency_key: z.string().min(1),
});

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    action: string;
    trace_id: string;
  };
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
}

