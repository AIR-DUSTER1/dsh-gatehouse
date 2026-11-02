import { createHmac, randomUUID } from 'node:crypto';

export interface PluginDecisionRequest {
  proposal_id: string;
  decision: 'approve' | 'reject' | 'request_info';
  reviewer: string;
  comment: string;
  requirement_hash: string;
  scope_hash: string;
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

export interface PluginClient {
  decide(payload: PluginDecisionRequest): Promise<void>;
  execute(payload: PluginExecuteRequest): Promise<PluginExecuteResponse>;
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

  async execute(payload: PluginExecuteRequest): Promise<PluginExecuteResponse> {
    const body = await this.post('/orchestrator/api/executions', payload);
    return body as PluginExecuteResponse;
  }

  private async post(path: string, payload: unknown): Promise<unknown> {
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
      signal: AbortSignal.timeout(this.timeoutMs),
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
  private readonly executions = new Map<string, PluginExecuteResponse>();
  public executionCalls = 0;
  public failExecution = false;

  async decide(payload: PluginDecisionRequest): Promise<void> {
    const existing = this.decisions.get(payload.idempotency_key);
    if (existing) return existing;
    const promise = Promise.resolve();
    this.decisions.set(payload.idempotency_key, promise);
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
}
