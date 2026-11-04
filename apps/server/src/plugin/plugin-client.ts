import { createHmac, randomUUID } from 'node:crypto';
import type {
  RepositoryDescriptionSuggestion,
  RepositoryDiscovery,
  WorkspaceRepositoryRecord,
} from '@gatehouse/contract';

export interface PluginDecisionRequest {
  proposal_id: string;
  decision: 'approve' | 'reject' | 'request_info';
  reviewer: string;
  comment: string;
  grant_id?: string;
  requirement_hash: string;
  scope_hash: string;
  workspace_binding_hash: string | null;
  schedule_at?: string;
  expires_at?: string;
  trace_id: string;
  idempotency_key: string;
}

export interface PluginExecuteRequest {
  proposal_id: string;
  grant_id: string;
  requirement_hash: string;
  scope_hash: string;
  workspace_binding_hash: string | null;
  execution_id: string;
  trace_id: string;
  idempotency_key: string;
}

export interface PluginExecuteResponse {
  execution_id: string;
  ticket_id?: string;
  pr_url?: string | null;
  /** Local mock only: the adapter has synchronously simulated the finished event. */
  completed?: boolean;
}

export interface PluginScheduleRequest {
  proposal_id: string;
  grant_id: string;
  requirement_hash: string;
  scope_hash: string;
  workspace_binding_hash: string | null;
  schedule_at: string;
  expires_at: string;
  trace_id: string;
  idempotency_key: string;
}

export interface PluginWithdrawRequest {
  proposal_id: string;
  grant_id: string;
  requirement_hash: string;
  scope_hash: string;
  workspace_binding_hash: string | null;
  reason: string;
  trace_id: string;
  idempotency_key: string;
}

export interface PluginClient {
  decide(payload: PluginDecisionRequest): Promise<void>;
  reschedule(payload: PluginScheduleRequest): Promise<void>;
  withdraw(payload: PluginWithdrawRequest): Promise<void>;
  execute(payload: PluginExecuteRequest): Promise<PluginExecuteResponse>;
  validateRepository(payload: PluginRepositoryRequest): Promise<RepositoryDiscovery>;
  describeRepository(payload: PluginRepositoryRequest): Promise<RepositoryDescriptionSuggestion>;
  syncWorkspaces(payload: PluginWorkspaceSyncRequest): Promise<PluginWorkspaceSyncResponse>;
  reassignProposal(payload: PluginReassignRequest): Promise<void>;
}

export interface PluginRepositoryRequest {
  workspace_id: string;
  repository_id: string;
  provider: WorkspaceRepositoryRecord['provider'];
  repository_key: string;
  api_base_url: string | null;
  web_base_url: string;
  clone_url: string;
  default_branch: string;
  credential_ref: string;
  custom_ca_ref: string | null;
  observe: WorkspaceRepositoryRecord['observe'];
  trace_id: string;
  idempotency_key: string;
}

export interface PluginWorkspaceSyncWorkspace extends PluginRepositoryRequest {
  workspace_slug: string;
  workspace_name: string;
  workspace_status: 'onboarding' | 'active' | 'disabled' | 'error';
  description: string;
  description_version: number;
  description_hash: string;
  short_description: string;
  capabilities: string[];
  routing_keywords: string[];
  exclusions: string[];
  confidence: number;
  source_instance_id: string;
}

export interface PluginWorkspaceSyncRequest {
  trace_id: string;
  idempotency_key: string;
  config_version: number;
  config_hash: string;
  workspaces: PluginWorkspaceSyncWorkspace[];
}

export interface PluginWorkspaceSyncResponse {
  applied: number;
  disabled: number;
  config_version: number;
  config_hash: string;
  replayed: boolean;
}

export interface PluginReassignRequest {
  proposal_id: string;
  workspace_id: string;
  repository_id: string | null;
  reason: string;
  trace_id: string;
  idempotency_key: string;
}

/** Adapter contract: all plugin HTTP details stay inside this module. */
export class HttpPluginClient implements PluginClient {
  constructor(
    private readonly baseUrl: string,
    private readonly secret: string,
    private readonly timeoutMs: number,
  ) {}

  async decide(payload: PluginDecisionRequest): Promise<void> {
    await this.post(`/orchestrator/api/proposals/${encodeURIComponent(payload.proposal_id)}/decision`, payload);
  }

  async reschedule(payload: PluginScheduleRequest): Promise<void> {
    await this.post(`/orchestrator/api/proposals/${encodeURIComponent(payload.proposal_id)}/reschedule`, payload);
  }

  async withdraw(payload: PluginWithdrawRequest): Promise<void> {
    await this.post(`/orchestrator/api/proposals/${encodeURIComponent(payload.proposal_id)}/withdraw`, payload);
  }

  async execute(payload: PluginExecuteRequest): Promise<PluginExecuteResponse> {
    const body = await this.post('/orchestrator/api/executions', payload);
    return body as PluginExecuteResponse;
  }

  async validateRepository(payload: PluginRepositoryRequest): Promise<RepositoryDiscovery> {
    return await this.post('/orchestrator/api/workspaces/validate', payload, Math.max(this.timeoutMs, 20_000)) as RepositoryDiscovery;
  }

  async describeRepository(payload: PluginRepositoryRequest): Promise<RepositoryDescriptionSuggestion> {
    return await this.post('/orchestrator/api/workspaces/describe', payload, Math.max(this.timeoutMs, 60_000)) as RepositoryDescriptionSuggestion;
  }

  async syncWorkspaces(payload: PluginWorkspaceSyncRequest): Promise<PluginWorkspaceSyncResponse> {
    return await this.post('/orchestrator/api/workspaces/sync', payload, Math.max(this.timeoutMs, 20_000)) as PluginWorkspaceSyncResponse;
  }

  async reassignProposal(payload: PluginReassignRequest): Promise<void> {
    await this.post('/orchestrator/api/workspaces/reassign-proposal', payload, Math.max(this.timeoutMs, 20_000));
  }

  private async post(path: string, payload: unknown, timeoutMs = this.timeoutMs): Promise<unknown> {
    const body = JSON.stringify(payload);
    const timestamp = String(Date.now());
    const nonce = randomUUID();
    const signature = createHmac('sha256', this.secret).update(`${timestamp}.${nonce}.${body}`).digest('hex');
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-timestamp': timestamp,
        'x-nonce': nonce,
        'x-signature': signature,
      },
      body,
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`plugin ${response.status}: ${text.slice(0, 300)}`);
    }
    return response.status === 204 ? null : response.json();
  }
}

/** Deterministic local adapter used by first-run demo and automated tests. */
export class MockPluginClient implements PluginClient {
  private readonly decisions = new Map<string, Promise<void>>();
  private readonly scheduleChanges = new Map<string, Promise<void>>();
  private readonly withdrawals = new Map<string, Promise<void>>();
  private readonly executions = new Map<string, PluginExecuteResponse>();
  public executionCalls = 0;
  public reassignCalls = 0;
  public failExecution = false;

  async decide(payload: PluginDecisionRequest): Promise<void> {
    const existing = this.decisions.get(payload.idempotency_key);
    if (existing) return existing;
    const promise = Promise.resolve();
    this.decisions.set(payload.idempotency_key, promise);
    return promise;
  }

  async reschedule(payload: PluginScheduleRequest): Promise<void> {
    const existing = this.scheduleChanges.get(payload.idempotency_key);
    if (existing) return existing;
    const promise = Promise.resolve();
    this.scheduleChanges.set(payload.idempotency_key, promise);
    return promise;
  }

  async withdraw(payload: PluginWithdrawRequest): Promise<void> {
    const existing = this.withdrawals.get(payload.idempotency_key);
    if (existing) return existing;
    const promise = Promise.resolve();
    this.withdrawals.set(payload.idempotency_key, promise);
    return promise;
  }

  async execute(payload: PluginExecuteRequest): Promise<PluginExecuteResponse> {
    this.executionCalls += 1;
    if (this.failExecution) throw new Error('模拟插件执行失败');
    const existing = this.executions.get(payload.idempotency_key);
    if (existing) return existing;
    const result: PluginExecuteResponse = {
      execution_id: payload.execution_id,
      completed: true,
      pr_url: `https://github.com/example/dsh-superagent/pull/${Math.floor(Math.random() * 900 + 100)}`,
    };
    this.executions.set(payload.idempotency_key, result);
    return result;
  }

  async validateRepository(payload: PluginRepositoryRequest): Promise<RepositoryDiscovery> {
    return {
      provider: payload.provider,
      repository_key: payload.repository_key,
      web_url: payload.web_base_url,
      default_branch: payload.default_branch,
      language: 'TypeScript',
      topics: ['gatehouse', 'workflow'],
      readme_excerpt: `${payload.repository_key} 的本地模拟仓库说明`,
      source_fingerprint: `sha256:${'0'.repeat(64)}`,
      permissions: { read: true, push: true, change_requests: true },
    };
  }

  async describeRepository(payload: PluginRepositoryRequest): Promise<RepositoryDescriptionSuggestion> {
    return {
      short_description: `${payload.repository_key} 负责代码托管、变更协作与交付流程，本描述由本地模拟插件生成，仅用于自动化测试。`,
      capabilities: ['代码托管', '变更评审', '交付协作'],
      routing_keywords: ['仓库', payload.repository_key.split('/').at(-1) ?? payload.repository_key, '代码'],
      exclusions: [],
      confidence: 0.92,
      source_fingerprint: `sha256:${'0'.repeat(64)}`,
      generated_at: new Date().toISOString(),
      model: 'mock-model',
    };
  }

  async syncWorkspaces(payload: PluginWorkspaceSyncRequest): Promise<PluginWorkspaceSyncResponse> {
    return { applied: payload.workspaces.length, disabled: 0, config_version: payload.config_version,
      config_hash: payload.config_hash, replayed: false };
  }

  async reassignProposal(_payload: PluginReassignRequest): Promise<void> { this.reassignCalls += 1; }
}
