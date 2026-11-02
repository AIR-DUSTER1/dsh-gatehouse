import { afterEach, describe, expect, it } from 'vitest';
import { randomUUID, createHash } from 'node:crypto';
import { createPluginSignature } from '@gatehouse/contract/signature';
import type { PluginEventEnvelope } from '@gatehouse/contract';
import { createHarness, createReviewFixture, decideApprove, type TestHarness } from './helpers.js';

const open: TestHarness[] = [];
async function harness(): Promise<TestHarness> {
  const value = await createHarness();
  open.push(value);
  return value;
}
afterEach(async () => {
  while (open.length) await open.pop()!.app.close();
});

function pluginEvent(eventId: string, suffix: string, requester = '事件提出人'): PluginEventEnvelope {
  const now = new Date().toISOString();
  const requirement = `插件事件需求 ${suffix}`;
  const scope = ['实现事件投影', '验证幂等'];
  const hash = (value: unknown) => `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
  return {
    version: '1.0', event_id: eventId, event_type: 'proposal.created', occurred_at: now, trace_id: `trace-${suffix}`,
    data: {
      case: {
        id: `case_${suffix}`, plugin_case_id: `plugin_${suffix}`, source: 'github', requester,
        title: `事件提案 ${suffix}`, requirement_text: requirement, requirement_hash: hash(requirement),
        status: 'pending_review', risk_level: 'high', source_context: 'GitHub Issue #88', message_url: null,
        created_at: now, updated_at: now,
      },
      proposal: {
        id: `proposal_${suffix}`, review_case_id: `case_${suffix}`, assessment_revision: 1,
        summary: '事件投影生成的提案', scope, scope_hash: hash(scope), rule_hits: ['touches-api'],
        impact_files: ['apps/server/src/app.ts'], test_plan: ['事件入库测试'], estimated_cost: '约 1 小时',
        risk: 'high', risk_reason: '需要确保幂等。', status: 'pending_review', created_at: now, updated_at: now,
      },
    },
  };
}

describe('console API', () => {
  it('rejects viewer decisions and self approval', async () => {
    const h = await harness();
    const viewer = await h.app.inject({
      method: 'POST', url: `/api/proposals/${h.proposalId}/decision`,
      headers: { authorization: `Bearer ${h.viewerToken}`, 'idempotency-key': randomUUID() },
      payload: { decision: 'reject', comment: '不批准', risk_confirmed: true },
    });
    expect(viewer.statusCode).toBe(403);

    const own = createReviewFixture(h.context, '复核人甲', '本人提交的需求');
    const self = await h.app.inject({
      method: 'POST', url: `/api/proposals/${own.proposal.id}/decision`,
      headers: { authorization: `Bearer ${h.reviewerToken}`, 'idempotency-key': randomUUID() },
      payload: {
        decision: 'approve', comment: '自己批准', risk_confirmed: true,
        schedule_at: new Date(Date.now() + 3_600_000).toISOString(),
        expires_at: new Date(Date.now() + 7_200_000).toISOString(), timezone: 'Asia/Shanghai',
      },
    });
    expect(self.statusCode).toBe(403);
    expect(self.json()).toMatchObject({ error: { code: 'SELF_APPROVAL_FORBIDDEN' } });
  });

  it('verifies HMAC, ingests a proposal and deduplicates event id', async () => {
    const h = await harness();
    const body = pluginEvent('evt_created_1', 'evt1');
    const timestamp = String(Date.now());
    const nonce = randomUUID();
    const signature = createPluginSignature('test-event-secret-with-enough-length', timestamp, nonce, body);
    const first = await h.app.inject({ method: 'POST', url: '/api/plugin/events', headers: { 'x-timestamp': timestamp, 'x-nonce': nonce, 'x-signature': signature }, payload: body });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({ duplicate: false, status: 'processed' });

    const secondNonce = randomUUID();
    const secondSignature = createPluginSignature('test-event-secret-with-enough-length', timestamp, secondNonce, body);
    const second = await h.app.inject({ method: 'POST', url: '/api/plugin/events', headers: { 'x-timestamp': timestamp, 'x-nonce': secondNonce, 'x-signature': secondSignature }, payload: body });
    expect(second.statusCode).toBe(200);
    expect(second.json()).toMatchObject({ duplicate: true });

    const list = await h.app.inject({ method: 'GET', url: '/api/review-cases?page=1&page_size=20', headers: { authorization: `Bearer ${h.reviewerToken}` } });
    expect((list.json() as { items: Array<{ id: string }> }).items.some((item) => item.id === 'case_evt1')).toBe(true);

    const invalid = await h.app.inject({ method: 'POST', url: '/api/plugin/events', headers: { 'x-timestamp': timestamp, 'x-nonce': randomUUID(), 'x-signature': '00'.repeat(32) }, payload: pluginEvent('evt_bad', 'bad') });
    expect(invalid.statusCode).toBe(401);
  });

  it('returns a replay for the same approval idempotency key and rejects key reuse with a changed body', async () => {
    const h = await harness();
    const scheduleAt = new Date(Date.now() + 3_600_000);
    const expiresAt = new Date(Date.now() + 7_200_000);
    const key = 'approval-test-key';
    const first = await decideApprove(h, { scheduleAt, expiresAt, idempotencyKey: key });
    expect(first.statusCode).toBe(200);
    const second = await decideApprove(h, { scheduleAt, expiresAt, idempotencyKey: key });
    expect(second.statusCode).toBe(200);
    expect(second.body.replayed).toBe(true);

    const conflict = await h.app.inject({
      method: 'POST', url: `/api/proposals/${h.proposalId}/decision`,
      headers: { authorization: `Bearer ${h.reviewerToken}`, 'idempotency-key': key },
      payload: { decision: 'reject', comment: '内容不同', risk_confirmed: true },
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json()).toMatchObject({ error: { code: 'IDEMPOTENCY_CONFLICT' } });
  });


  it('enforces admin-only system settings', async () => {
    const h = await harness();
    const reviewer = await h.app.inject({
      method: 'PUT', url: '/api/settings', headers: { authorization: `Bearer ${h.reviewerToken}` },
      payload: { max_concurrency: 3 },
    });
    expect(reviewer.statusCode).toBe(403);

    const adminToken = await h.login('admin@test.local');
    const admin = await h.app.inject({
      method: 'PUT', url: '/api/settings', headers: { authorization: `Bearer ${adminToken}` },
      payload: { max_concurrency: 3 },
    });
    expect(admin.statusCode).toBe(200);
    expect(h.context.settings.get('max_concurrency')).toBe('3');
  });

  it('invalidates an active approval when proposal scope changes', async () => {
    const h = await harness();
    const scheduleAt = new Date(Date.now() + 3_600_000);
    expect((await decideApprove(h, { scheduleAt, expiresAt: new Date(Date.now() + 7_200_000) })).statusCode).toBe(200);
    const reviewCase = h.context.cases.get(h.caseId)!;
    const proposal = h.context.proposals.get(h.proposalId)!;
    const changedScope = [...proposal.scope, '新增未经审批的执行范围'];
    const changedRequirement = `${reviewCase.requirement_text}（需求已变化）`;
    const hash = (value: unknown) => `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
    const body: PluginEventEnvelope = {
      version: '1.0', event_id: 'evt_scope_changed', event_type: 'proposal.updated',
      occurred_at: new Date().toISOString(), trace_id: 'trace-scope-changed',
      data: {
        case: { ...reviewCase, requirement_text: changedRequirement, requirement_hash: hash(changedRequirement), updated_at: new Date().toISOString() },
        proposal: { ...proposal, scope: changedScope, scope_hash: hash(changedScope), updated_at: new Date().toISOString() },
      },
    };
    const timestamp = String(Date.now());
    const nonce = randomUUID();
    const signature = createPluginSignature('test-event-secret-with-enough-length', timestamp, nonce, body);
    const response = await h.app.inject({
      method: 'POST', url: '/api/plugin/events',
      headers: { 'x-timestamp': timestamp, 'x-nonce': nonce, 'x-signature': signature }, payload: body,
    });
    expect(response.statusCode).toBe(200);
    expect(h.context.grants.getByProposal(h.proposalId)?.status).toBe('revoked');
    expect(h.context.schedules.getByProposal(h.proposalId)?.status).toBe('cancelled');
    expect(h.context.proposals.get(h.proposalId)?.status).toBe('pending_review');
    expect(h.context.cases.get(h.caseId)?.status).toBe('pending_review');
  });

  it('keeps audit events append-only at the database layer', async () => {
    const h = await harness();
    const row = h.context.auditRepository.recent(1)[0];
    expect(row).toBeTruthy();
    expect(() => h.context.db.prepare("UPDATE audit_events SET actor = 'tampered' WHERE id = ?").run(row!.id)).toThrow(/append-only/);
    expect(() => h.context.db.prepare('DELETE FROM audit_events WHERE id = ?').run(row!.id)).toThrow(/append-only/);
  });
});
