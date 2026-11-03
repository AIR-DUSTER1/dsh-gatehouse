import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createPluginSignature } from '@gatehouse/contract/signature';
import type { PluginEventEnvelope } from '@gatehouse/contract';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHarness, createReviewFixture, decideApprove, type TestHarness } from './helpers.js';
import { MockPluginClient } from '../src/plugin/plugin-client.js';
import { createApplication } from '../src/app.js';
import type { PluginClient, PluginDecisionRequest, PluginExecuteRequest } from '../src/plugin/plugin-client.js';

const open: TestHarness[] = [];
afterEach(async () => { while (open.length) await open.pop()!.app.close(); });

describe('persistent scheduler', () => {
  it('does not execute before due time and executes exactly once after due time', async () => {
    const h = await createHarness(); open.push(h);
    const scheduleAt = new Date(Date.now() + 60 * 60_000);
    const expiresAt = new Date(Date.now() + 2 * 60 * 60_000);
    expect((await decideApprove(h, { scheduleAt, expiresAt })).statusCode).toBe(200);

    const before = await h.context.scheduler.runOnce(new Date(scheduleAt.getTime() - 60_000));
    expect(before.claimed).toBe(0);
    expect((h.context.plugin as MockPluginClient).executionCalls).toBe(0);

    const due = await h.context.scheduler.runOnce(new Date(scheduleAt.getTime() + 60_000));
    expect(due.claimed).toBe(1);
    expect((h.context.plugin as MockPluginClient).executionCalls).toBe(1);
    const schedule = h.context.schedules.getByProposal(h.proposalId);
    expect(schedule?.status).toBe('completed');
    expect(schedule?.pr_url).toContain('/pull/');

    const again = await h.context.scheduler.runOnce(new Date(scheduleAt.getTime() + 120_000));
    expect(again.claimed).toBe(0);
    expect((h.context.plugin as MockPluginClient).executionCalls).toBe(1);
  });

  it('does not execute a paused schedule and resumes it successfully', async () => {
    const h = await createHarness(); open.push(h);
    const scheduleAt = new Date(Date.now() + 60 * 60_000);
    expect((await decideApprove(h, { scheduleAt, expiresAt: new Date(Date.now() + 2 * 60 * 60_000) })).statusCode).toBe(200);
    const schedule = h.context.schedules.getByProposal(h.proposalId)!;
    const paused = await h.app.inject({ method: 'POST', url: `/api/schedule/${schedule.id}/pause`, headers: { authorization: `Bearer ${h.reviewerToken}` } });
    expect(paused.statusCode).toBe(200);
    const afterPause = await h.context.scheduler.runOnce(new Date(scheduleAt.getTime() + 60_000));
    expect(afterPause.claimed).toBe(0);

    const resumed = await h.app.inject({ method: 'POST', url: `/api/schedule/${schedule.id}/resume`, headers: { authorization: `Bearer ${h.reviewerToken}` } });
    expect(resumed.statusCode).toBe(200);
    const afterResume = await h.context.scheduler.runOnce(new Date(scheduleAt.getTime() + 120_000));
    expect(afterResume.claimed).toBe(1);
    expect((h.context.plugin as MockPluginClient).executionCalls).toBe(1);
  });

  it('refuses to execute an expired ApprovalGrant', async () => {
    const h = await createHarness(); open.push(h);
    const scheduleAt = new Date(Date.now() + 10 * 60_000);
    const expiresAt = new Date(Date.now() + 20 * 60_000);
    expect((await decideApprove(h, { scheduleAt, expiresAt })).statusCode).toBe(200);
    const result = await h.context.scheduler.runOnce(new Date(expiresAt.getTime() + 60_000));
    expect(result.claimed).toBe(0);
    expect((h.context.plugin as MockPluginClient).executionCalls).toBe(0);
    expect(h.context.schedules.getByProposal(h.proposalId)?.status).toBe('failed');
    expect(h.context.grants.getByProposal(h.proposalId)?.status).toBe('expired');
  });

  it('reschedules an approved Grant and waits for the new start time', async () => {
    const h = await createHarness(); open.push(h);
    const scheduleAt = new Date(Date.now() + 60 * 60_000);
    expect((await decideApprove(h, { scheduleAt, expiresAt: new Date(Date.now() + 2 * 60 * 60_000) })).statusCode).toBe(200);
    const schedule = h.context.schedules.getByProposal(h.proposalId)!;
    const changedAt = new Date(Date.now() + 3 * 60 * 60_000);
    const changedExpiry = new Date(Date.now() + 4 * 60 * 60_000);
    const changed = await h.app.inject({
      method: 'POST', url: `/api/schedule/${schedule.id}/reschedule`,
      headers: { authorization: `Bearer ${h.reviewerToken}` },
      payload: { schedule_at: changedAt.toISOString(), expires_at: changedExpiry.toISOString(), timezone: 'Asia/Shanghai', reason: '调整窗口' },
    });
    expect(changed.statusCode).toBe(200);
    expect(h.context.schedules.getByProposal(h.proposalId)).toMatchObject({ schedule_at: changedAt.toISOString(), status: 'scheduled' });
    expect(h.context.grants.getByProposal(h.proposalId)).toMatchObject({ schedule_at: changedAt.toISOString(), status: 'active' });
    expect(h.context.schedules.getByProposal(h.proposalId)?.approval_synced_at).toBeTruthy();

    expect((await h.context.scheduler.runOnce(new Date(scheduleAt.getTime() + 60_000))).claimed).toBe(0);
    expect((await h.context.scheduler.runOnce(new Date(changedAt.getTime() + 60_000))).claimed).toBe(1);
  });

  it('withdraws a schedule, revokes its Grant and permits reapproval', async () => {
    const h = await createHarness(); open.push(h);
    const scheduleAt = new Date(Date.now() + 60 * 60_000);
    expect((await decideApprove(h, { scheduleAt, expiresAt: new Date(Date.now() + 2 * 60 * 60_000) })).statusCode).toBe(200);
    const schedule = h.context.schedules.getByProposal(h.proposalId)!;
    const withdrawn = await h.app.inject({
      method: 'POST', url: `/api/schedule/${schedule.id}/withdraw`,
      headers: { authorization: `Bearer ${h.reviewerToken}` }, payload: { reason: '需要重新评估' },
    });
    expect(withdrawn.statusCode).toBe(200);
    expect(h.context.schedules.getByProposal(h.proposalId)).toMatchObject({ status: 'cancelled', last_error: '需要重新评估' });
    expect(h.context.grants.getByProposal(h.proposalId)?.status).toBe('revoked');
    expect(h.context.proposals.get(h.proposalId)?.status).toBe('pending_review');
    expect((await h.context.scheduler.runOnce(new Date(scheduleAt.getTime() + 60_000))).claimed).toBe(0);

    const renewedAt = new Date(Date.now() + 3 * 60 * 60_000);
    const renewed = await decideApprove(h, { scheduleAt: renewedAt, expiresAt: new Date(Date.now() + 4 * 60 * 60_000) });
    expect(renewed.statusCode).toBe(200);
    expect(h.context.grants.getByProposal(h.proposalId)?.status).toBe('active');
    expect(h.context.schedules.getByProposal(h.proposalId)).toMatchObject({ id: schedule.id, status: 'scheduled', schedule_at: renewedAt.toISOString() });
  });

  it('recovers a persisted schedule after a console restart', async () => {
    const temp = mkdtempSync(join(tmpdir(), 'gatehouse-test-'));
    const dbPath = join(temp, 'console.db');
    try {
      const first = await createHarness(dbPath); open.push(first);
      const scheduleAt = new Date(Date.now() + 60 * 60_000);
      expect((await decideApprove(first, { scheduleAt, expiresAt: new Date(Date.now() + 2 * 60 * 60_000) })).statusCode).toBe(200);
      await first.app.close();
      open.splice(open.indexOf(first), 1);

      const { app, context } = await createApplication({
        config: {
          databasePath: dbPath, pluginMode: 'mock', sessionSecret: 'test-session-secret-with-enough-length',
          pluginEventSecret: 'test-event-secret-with-enough-length', pluginSharedSecret: 'test-plugin-secret-with-enough-length',
          schedulePollMs: 60_000, scheduleMaxConcurrency: 2, pluginMaxAttempts: 3,
        },
      });
      const second: TestHarness = { app, context, reviewerToken: '', viewerToken: '', caseId: '', proposalId: 'proposal_' + first.proposalId.split('_').slice(1).join('_'), login: async () => '' };
      open.push(second);
      const run = await context.scheduler.runOnce(new Date(scheduleAt.getTime() + 60_000));
      expect(run.claimed).toBe(1);
      expect((context.plugin as MockPluginClient).executionCalls).toBe(1);
      expect(context.schedules.getByProposal(first.proposalId)?.status).toBe('completed');
    } finally {
      while (open.length) await open.pop()!.app.close();
      rmSync(temp, { recursive: true, force: true });
    }
  });

  it('keeps a failed decision in the outbox and retries it without losing the schedule', async () => {
    let failOnce = true;
    const flaky: PluginClient = {
      async decide(_payload: PluginDecisionRequest) {
        if (failOnce) { failOnce = false; throw new Error('network unavailable'); }
      },
      async reschedule() {},
      async withdraw() {},
      async execute(_payload: PluginExecuteRequest) { return { execution_id: 'exec', pr_url: null }; },
    };
    const { app, context } = await createApplication({
      config: {
        databasePath: ':memory:', pluginMode: 'mock',
        bootstrapAdminEmail: 'admin@test.local', bootstrapAdminName: '管理员', bootstrapAdminPassword: 'test-admin-password-123',
        sessionSecret: 'test-session-secret-with-enough-length', pluginEventSecret: 'test-event-secret-with-enough-length',
        pluginSharedSecret: 'test-plugin-secret-with-enough-length', schedulePollMs: 60_000, scheduleMaxConcurrency: 2, pluginMaxAttempts: 3,
      },
      plugin: flaky,
    });
    const fixture = createReviewFixture(context, '陈晓', '验证 outbox 重试');
    const now = new Date();
    context.approval.decide({
      proposalId: fixture.proposal.id,
      user: { id: 'reviewer', email: 'reviewer@test.local', name: '复核人甲', role: 'reviewer' },
      idempotencyKey: 'outbox-retry-key',
      traceId: 'outbox-retry-trace',
      now,
      decision: {
        decision: 'approve', comment: '批准并重试同步', risk_confirmed: true, timezone: 'Asia/Shanghai',
        schedule_at: new Date(now.getTime() + 3_600_000).toISOString(),
        expires_at: new Date(now.getTime() + 7_200_000).toISOString(),
      },
    });
    const first = await context.dispatcher.drain(now);
    expect(first.retried).toBe(1);
    expect(context.schedules.getByProposal(fixture.proposal.id)?.approval_synced_at).toBeNull();
    expect(context.outbox.pendingCount()).toBe(1);

    const second = await context.dispatcher.drain(new Date(now.getTime() + 2_000));
    expect(second.delivered).toBe(1);
    expect(context.schedules.getByProposal(fixture.proposal.id)?.approval_synced_at).toBeTruthy();
    expect(context.outbox.pendingCount()).toBe(0);
    await app.close();
  });

  it('waits for execution.finished after an asynchronous executor dispatch', async () => {
    const plugin: PluginClient = {
      async decide() {},
      async reschedule() {},
      async withdraw() {},
      async execute(payload: PluginExecuteRequest) { return { execution_id: payload.execution_id, ticket_id: 'ticket-1' } },
    };
    const { app, context } = await createApplication({
      config: {
        databasePath: ':memory:', pluginMode: 'mock',
        bootstrapAdminEmail: 'admin@test.local', bootstrapAdminName: '管理员', bootstrapAdminPassword: 'test-admin-password-123',
        sessionSecret: 'test-session-secret-with-enough-length', pluginEventSecret: 'test-event-secret-with-enough-length',
        pluginSharedSecret: 'test-plugin-secret-with-enough-length', schedulePollMs: 60_000, scheduleMaxConcurrency: 2, pluginMaxAttempts: 3,
      },
      plugin,
    });
    const fixture = createReviewFixture(context, '陈晓', '验证异步执行回执');
    const now = new Date();
    context.approval.decide({
      proposalId: fixture.proposal.id,
      user: { id: 'reviewer', email: 'reviewer@test.local', name: '复核人甲', role: 'reviewer' },
      idempotencyKey: 'async-execution-approval', traceId: 'async-trace', now,
      decision: {
        decision: 'approve', comment: '批准异步执行', risk_confirmed: true, timezone: 'Asia/Shanghai',
        schedule_at: new Date(now.getTime() + 3_600_000).toISOString(),
        expires_at: new Date(now.getTime() + 7_200_000).toISOString(),
      },
    })
    await context.dispatcher.drain(now)
    const run = await context.scheduler.runOnce(new Date(now.getTime() + 3_660_000));
    expect(run.claimed).toBe(1);
    const schedule = context.schedules.getByProposal(fixture.proposal.id)!
    expect(schedule.status).toBe('executing')
    expect(context.proposals.get(fixture.proposal.id)?.status).toBe('executing')

    const event: PluginEventEnvelope = {
      version: '1.0', event_id: 'evt-execution-finished', event_type: 'execution.finished',
      occurred_at: new Date(now.getTime() + 3_700_000).toISOString(), trace_id: 'async-trace',
      data: { proposal_id: fixture.proposal.id, execution_id: schedule.execution_id, pr_url: 'https://example.test/pull/1' },
    }
    const timestamp = String(Date.now())
    const nonce = randomUUID()
    const signature = createPluginSignature('test-event-secret-with-enough-length', timestamp, nonce, event)
    const response = await app.inject({ method: 'POST', url: '/api/plugin/events',
      headers: { 'x-timestamp': timestamp, 'x-nonce': nonce, 'x-signature': signature }, payload: event })
    expect(response.statusCode).toBe(200)
    expect(context.schedules.getByProposal(fixture.proposal.id)?.status).toBe('completed')
    expect(context.cases.get(fixture.case.id)?.status).toBe('completed')
    await app.close()
  })
});

