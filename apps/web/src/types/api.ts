import type {
  AuditEventRecord, DashboardStatistics, ReviewCaseDetail, ReviewCaseRecord, ReviewQueueItem,
  ScheduleListItem, ScheduleRecord, User,
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
  session_ttl_seconds: number; users: User[]; pending_outbox: number;
}
export interface DecisionResponse {
  replayed: boolean; decision: { id: string; decision: string; reviewer: string; comment: string; created_at: string };
  detail: ReviewCaseDetail; trace_id: string;
}
export interface ScheduleActionResponse { schedule: ScheduleRecord; trace_id: string }
export type { ReviewCaseRecord, ReviewCaseDetail };
