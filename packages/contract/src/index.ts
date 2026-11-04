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

export const SOURCES = ['feishu', 'github', 'gitlab', 'gitea', 'webhook', 'manual'] as const;
export type Source = (typeof SOURCES)[number];

export const PROVIDERS = ['github', 'gitlab', 'gitea', 'bitbucket', 'generic'] as const;
export type RepositoryProvider = (typeof PROVIDERS)[number];

export const WORKSPACE_STATUSES = ['onboarding', 'active', 'disabled', 'error'] as const;
export type WorkspaceStatus = (typeof WORKSPACE_STATUSES)[number];

export const REPOSITORY_STATUSES = ['pending', 'validating', 'ready', 'disabled', 'error'] as const;
export type RepositoryStatus = (typeof REPOSITORY_STATUSES)[number];

export const ROUTING_MODES = ['explicit', 'native', 'thread', 'semantic', 'manual'] as const;
export type RoutingMode = (typeof ROUTING_MODES)[number];

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
  workspace_id?: string | null;
  repository_id?: string | null;
  routing_decision_id?: string | null;
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
  workspace_id?: string | null;
  repository_id?: string | null;
  workspace_binding_hash?: string | null;
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
  workspace_binding_hash?: string | null;
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
  workspace_id?: string | null;
  repository_id?: string | null;
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
  workspace_id?: string | null;
  created_at: string;
}

export interface WorkspaceRecord {
  id: string;
  name: string;
  slug: string;
  description: string;
  description_version: number;
  description_hash: string | null;
  status: WorkspaceStatus;
  created_at: string;
  updated_at: string;
}

export interface RepositoryObservationConfig {
  issues: boolean;
  change_requests: boolean;
  comments: boolean;
  ci: boolean;
}

export interface WorkspaceRepositoryRecord {
  id: string;
  workspace_id: string;
  provider: RepositoryProvider;
  repository_key: string;
  api_base_url: string | null;
  web_base_url: string;
  clone_url: string;
  default_branch: string;
  credential_ref: string;
  custom_ca_ref: string | null;
  observe: RepositoryObservationConfig;
  description: string;
  short_description: string;
  capabilities: string[];
  routing_keywords: string[];
  exclusions: string[];
  confidence: number;
  description_version: number;
  description_hash: string;
  source_fingerprint: string | null;
  generated_at: string | null;
  confirmed_by: string | null;
  confirmed_at: string | null;
  status: RepositoryStatus;
  health_state: 'unknown' | 'ready' | 'error';
  health_detail: string;
  health_checked_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface WorkspaceSourceBindingRecord {
  id: string;
  workspace_id: string;
  repository_id: string;
  provider: RepositoryProvider;
  source_instance_id: string;
  config_version: number;
  applied_config_hash: string | null;
  enabled: boolean;
  last_synced_at: string | null;
  health: Record<string, unknown>;
}

export interface RoutingCandidate {
  workspace_id: string;
  repository_id: string | null;
  confidence: number;
  reason: string;
}

export interface RoutingDecisionRecord {
  id: string;
  workspace_id: string | null;
  repository_id: string | null;
  source: Source;
  mode: RoutingMode;
  confidence: number | null;
  reason: string;
  candidates: RoutingCandidate[];
  requires_human: boolean;
  overridden_by: string | null;
  created_at: string;
}

export interface WorkspaceListItem extends WorkspaceRecord {
  repositories: WorkspaceRepositoryRecord[];
  source_bindings: WorkspaceSourceBindingRecord[];
  open_tasks: number;
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
  retryable: boolean;
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

export interface AnalyticsWorkspaceRow {
  workspace_id: string;
  workspace_name: string;
  workspace_slug: string;
  status: WorkspaceStatus;
  repositories: Array<{ id: string; provider: RepositoryProvider; repository_key: string; health_state: string }>;
  pending_review: number;
  scheduled: number;
  executing: number;
  failed: number;
  completed: number;
  completion_rate: number;
  average_review_minutes: number;
  last_activity_at: string | null;
}

export interface AnalyticsOverview {
  range: '7d' | '30d' | '90d';
  generated_at: string;
  totals: {
    workspaces: number;
    active_workspaces: number;
    error_workspaces: number;
    pending_review: number;
    scheduled: number;
    executing: number;
    failed: number;
    completed: number;
    completion_rate: number;
    failure_rate: number;
    average_review_minutes: number;
    p95_schedule_wait_minutes: number;
    human_routing_rate: number;
    manual_override_rate: number;
  };
  workspaces: AnalyticsWorkspaceRow[];
  trend: Array<{ date: string; created: number; completed: number; failed: number }>;
  provider_distribution: Array<{ provider: RepositoryProvider; count: number }>;
  routing_distribution: Array<{ mode: RoutingMode; count: number }>;
  risk_distribution: Record<RiskLevel, number>;
  recent_failures: Array<{
    workspace_id: string;
    workspace_name: string;
    case_id: string;
    title: string;
    failed_at: string;
    reason: string;
  }>;
}

export interface PluginEventEnvelope {
  version: '1.0' | '2.0';
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
  workspace_id: z.string().min(1).nullable().optional(),
  repository_id: z.string().min(1).nullable().optional(),
  routing_decision_id: z.string().min(1).nullable().optional(),
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
  workspace_id: z.string().min(1).nullable().optional(),
  repository_id: z.string().min(1).nullable().optional(),
  workspace_binding_hash: hashSchema.nullable().optional(),
  created_at: isoDateSchema,
  updated_at: isoDateSchema,
});

export const proposalCreatedDataSchema = z.object({
  case: reviewCaseSchema,
  proposal: proposalInputSchema,
});

export const routingCandidateSchema = z.object({
  workspace_id: z.string().min(1),
  repository_id: z.string().min(1).nullable(),
  confidence: z.number().min(0).max(1),
  reason: z.string().min(1),
});

export const routingDecisionSchema = z.object({
  id: z.string().min(1),
  workspace_id: z.string().min(1).nullable(),
  repository_id: z.string().min(1).nullable(),
  source: z.enum(SOURCES),
  mode: z.enum(ROUTING_MODES),
  confidence: z.number().min(0).max(1).nullable(),
  reason: z.string().min(1),
  candidates: z.array(routingCandidateSchema),
  requires_human: z.boolean(),
  overridden_by: z.string().min(1).nullable().optional(),
  created_at: isoDateSchema,
});

export const proposalCreatedDataV2Schema = proposalCreatedDataSchema.extend({
  workspace_id: z.string().min(1).nullable(),
  repository_id: z.string().min(1).nullable(),
  workspace_binding_hash: hashSchema.nullable(),
  routing_decision: routingDecisionSchema,
});

export const executionDataSchema = z.object({
  proposal_id: z.string().min(1),
  execution_id: z.string().min(1),
  pr_url: z.string().url().nullable().optional(),
  error: z.string().optional(),
});

export const pluginEventSchema = z.object({
  version: z.union([z.literal('1.0'), z.literal('2.0')]),
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
    comment: z.string().trim().max(2000, '审批意见不能超过 2000 个字符').default(''),
    schedule_at: isoDateSchema,
    expires_at: isoDateSchema,
    timezone: z.string().min(1).default('Asia/Shanghai'),
    risk_confirmed: z.literal(true),
  }),
  z.object({
    decision: z.literal('reject'),
    comment: z.string().trim().max(2000, '审批意见不能超过 2000 个字符').default(''),
    risk_confirmed: z.literal(true),
  }),
  z.object({
    decision: z.literal('request_info'),
    comment: z.string().trim().max(2000, '审批意见不能超过 2000 个字符').default(''),
    risk_confirmed: z.literal(true),
  }),
]);
export type DecisionInput = z.infer<typeof decisionInputSchema>;

export const scheduleChangeInputSchema = z.object({
  schedule_at: isoDateSchema,
  expires_at: isoDateSchema,
  timezone: z.string().min(1).default('Asia/Shanghai'),
  reason: z.string().trim().max(500).default(''),
});
export type ScheduleChangeInput = z.infer<typeof scheduleChangeInputSchema>;

export const scheduleWithdrawInputSchema = z.object({
  reason: z.string().trim().max(500).default(''),
});
export type ScheduleWithdrawInput = z.infer<typeof scheduleWithdrawInputSchema>;

export const approvalGrantSchema = z.object({
  id: z.string().min(1),
  proposal_id: z.string().min(1),
  reviewer: z.string().min(1),
  requirement_hash: hashSchema,
  scope_hash: hashSchema,
  workspace_binding_hash: hashSchema.nullable().optional(),
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
  comment: z.string().trim().max(2000).default(''),
  grant_id: z.string().min(1).optional(),
  requirement_hash: hashSchema,
  scope_hash: hashSchema,
  workspace_binding_hash: hashSchema.nullable(),
  schedule_at: isoDateSchema.optional(),
  expires_at: isoDateSchema.optional(),
  trace_id: z.string().min(1),
  idempotency_key: z.string().min(1),
}).superRefine((value, context) => {
  if (value.decision === 'approve' && !value.grant_id) {
    context.addIssue({ code: 'custom', path: ['grant_id'], message: '批准请求必须携带 Grant ID' });
  }
});

export const pluginExecuteRequestSchema = z.object({
  proposal_id: z.string().min(1),
  grant_id: z.string().min(1),
  requirement_hash: hashSchema,
  scope_hash: hashSchema,
  workspace_binding_hash: hashSchema.nullable(),
  execution_id: z.string().min(1),
  trace_id: z.string().min(1),
  idempotency_key: z.string().min(1),
});

export const observationConfigSchema = z.object({
  issues: z.boolean().default(true),
  change_requests: z.boolean().default(true),
  comments: z.boolean().default(true),
  ci: z.boolean().default(true),
});

export const repositoryConfigInputSchema = z.object({
  provider: z.enum(PROVIDERS),
  repository_key: z.string().trim().min(1).max(300),
  api_base_url: z.string().url().nullable().default(null),
  web_base_url: z.string().url(),
  clone_url: z.string().trim().min(1).max(1000),
  default_branch: z.string().trim().min(1).max(200).default('main'),
  credential_ref: z.string().trim().max(300).default(''),
  custom_ca_ref: z.string().trim().max(500).nullable().default(null),
  observe: observationConfigSchema.default({ issues: true, change_requests: true, comments: true, ci: true }),
});
export type RepositoryConfigInput = z.infer<typeof repositoryConfigInputSchema>;

export const workspaceCreateInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  slug: z.string().trim().min(1).max(80).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, '仅允许小写字母、数字和连字符'),
  description: z.string().trim().max(1000).default(''),
  repository: repositoryConfigInputSchema.optional(),
});
export type WorkspaceCreateInput = z.infer<typeof workspaceCreateInputSchema>;

export const workspaceUpdateInputSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(1000).optional(),
});
export type WorkspaceUpdateInput = z.infer<typeof workspaceUpdateInputSchema>;

export const repositoryUpdateInputSchema = repositoryConfigInputSchema.partial().omit({ provider: true, repository_key: true });
export type RepositoryUpdateInput = z.infer<typeof repositoryUpdateInputSchema>;

export const repositoryDescriptionInputSchema = z.object({
  short_description: z.string().trim().min(20).max(1200),
  capabilities: z.array(z.string().trim().min(1).max(160)).min(1).max(20),
  routing_keywords: z.array(z.string().trim().min(1).max(60)).min(3).max(20),
  exclusions: z.array(z.string().trim().min(1).max(160)).max(20).default([]),
  confidence: z.number().min(0).max(1),
});
export type RepositoryDescriptionInput = z.infer<typeof repositoryDescriptionInputSchema>;

export const repositoryDiscoverySchema = z.object({
  provider: z.enum(PROVIDERS),
  repository_key: z.string().min(1),
  web_url: z.string().url(),
  default_branch: z.string().min(1),
  language: z.string().nullable(),
  topics: z.array(z.string()),
  readme_excerpt: z.string(),
  source_fingerprint: hashSchema,
  permissions: z.object({ read: z.boolean(), push: z.boolean(), change_requests: z.boolean() }),
});
export type RepositoryDiscovery = z.infer<typeof repositoryDiscoverySchema>;

export const repositoryDescriptionSuggestionSchema = repositoryDescriptionInputSchema.extend({
  source_fingerprint: hashSchema,
  generated_at: isoDateSchema,
  model: z.string().min(1),
});
export type RepositoryDescriptionSuggestion = z.infer<typeof repositoryDescriptionSuggestionSchema>;

export const routingReassignInputSchema = z.object({
  workspace_id: z.string().min(1),
  repository_id: z.string().min(1).nullable().default(null),
  reason: z.string().trim().min(1).max(500),
});
export type RoutingReassignInput = z.infer<typeof routingReassignInputSchema>;

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

