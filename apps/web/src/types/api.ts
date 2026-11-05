import type {
  AuditEventRecord, DashboardStatistics, ReviewCaseDetail, ReviewCaseRecord, ReviewQueueItem,
  PermissionRecord, RepositoryDescriptionSuggestion, RepositoryDiscovery, RoleRecord, ScheduleListItem, ScheduleRecord, User, WorkspaceListItem,
} from '@gatehouse/contract';

export interface LoginResponse { user: User; token: string; expires_at: string; trace_id: string }
export interface ReviewQueueResponse {
  items: ReviewQueueItem[]; total: number; page: number; page_size: number;
}
export interface DashboardResponse extends DashboardStatistics {}
export interface ScheduleResponse {
  items: ScheduleListItem[];
  metrics: { executing: number; max_concurrency: number; due_today: number; overdue: number; blocked: number };
}
export interface AuditResponse { items: AuditEventRecord[]; total: number; page: number; page_size: number }
export interface SettingsResponse {
  max_concurrency: number; plugin_mode: 'mock' | 'http'; plugin_base_url: string;
  monitored_repository: string | null;
  monitored_repositories: Array<{ workspace_id: string; workspace_name: string; provider: string; repository_key: string; status: string }>;
  session_ttl_seconds: number; pending_outbox: number;
}
export interface DecisionResponse {
  replayed: boolean; decision: { id: string; decision: string; reviewer: string; comment: string; created_at: string };
  detail: ReviewCaseDetail; trace_id: string;
}
export interface ScheduleActionResponse { schedule: ScheduleRecord; trace_id: string }
export interface WorkspacesResponse { items: WorkspaceListItem[] }
export interface WorkspaceResponse { workspace: WorkspaceListItem; trace_id: string }
export interface RepositoryValidationResponse { discovery: RepositoryDiscovery; trace_id: string }
export interface RepositoryDescriptionResponse { suggestion: RepositoryDescriptionSuggestion; trace_id: string }
export interface RepositoryConfirmationResponse { repository: WorkspaceListItem['repositories'][number]; trace_id: string }
export interface WorkspaceSyncResponse {
  sync: { applied: number; disabled: number; config_version: number; config_hash: string; replayed: boolean };
  trace_id: string;
}
export type { ReviewCaseRecord, ReviewCaseDetail };
export interface UserListResponse { items: User[]; total: number; page: number; page_size: number }
export interface UserResponse { user: User; trace_id: string }
export interface UsersOptionsResponse { items: User[] }
export interface InvitationLink { url: string; expires_at: string }
export interface CreateUserResponse { user: User; invitation: InvitationLink; trace_id: string }
export interface RoleListResponse { items: RoleRecord[] }
export interface PermissionListResponse { items: PermissionRecord[] }
export interface RoleResponse { role: RoleRecord; trace_id: string }
