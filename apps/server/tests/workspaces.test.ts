import { afterEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { AnalyticsOverview, WorkspaceListItem } from '@gatehouse/contract';
import { MockPluginClient } from '../src/plugin/plugin-client.js';
import { createHarness, createReviewFixture, decideApprove, type TestHarness } from './helpers.js';

const open: TestHarness[] = [];
async function harness(): Promise<TestHarness> {
  const value = await createHarness();
  open.push(value);
  return value;
}
afterEach(async () => { while (open.length) await open.pop()!.app.close(); });

function createSecondWorkspace(h: TestHarness): WorkspaceListItem {
  const admin = h.context.users.list().find((user) => user.role === 'admin')!;
  const workspace = h.context.workspaceService.create({
    name: '账务平台', slug: `ledger-${randomUUID().slice(0, 8)}`, description: '账务与总账工作区',
    repository: {
      provider: 'github', repository_key: 'example/ledger', api_base_url: 'https://api.github.com',
      web_base_url: 'https://github.com/example/ledger', clone_url: 'https://github.com/example/ledger.git',
      default_branch: 'main', credential_ref: '', custom_ca_ref: null,
      observe: { issues: true, change_requests: true, comments: true, ci: true },
    },
  }, admin, 'test-second-workspace');
  const repository = workspace.repositories[0]!;
  h.context.workspaceService.confirmDescription(repository.id, {
    short_description: '账务平台负责总账、凭证、核算和会计期间结账等核心能力。',
    capabilities: ['总账', '凭证', '结账'],
    routing_keywords: ['账务', '总账', '凭证', '结账', '核算'],
    exclusions: ['支付渠道'],
    confidence: 0.95,
    source_fingerprint: `sha256:${'1'.repeat(64)}`,
    generated_at: new Date().toISOString(),
    model: 'test-model',
  }, admin, 'test-second-description');
  return h.context.workspaceService.detail(admin, workspace.id);
}

describe('workspace isolation and analytics', () => {
  it('filters cases by workspace and rejects details without membership', async () => {
    const h = await harness();
    const second = createSecondWorkspace(h);
    const secondFixture = createReviewFixture(h.context, '账务发起人', '账务月结需求', randomUUID(),
      { workspaceId: second.id, repositoryId: second.repositories[0]!.id });
    const denied = await h.app.inject({ method: 'GET', url: `/api/review-cases/${secondFixture.case.id}`,
      headers: { authorization: `Bearer ${h.reviewerToken}` } });
    expect(denied.statusCode).toBe(403);
    const defaultList = await h.app.inject({ method: 'GET', url: `/api/review-cases?workspace_id=${h.workspaceId}&page=1&page_size=20`,
      headers: { authorization: `Bearer ${h.reviewerToken}` } });
    expect(defaultList.json()).toMatchObject({ total: 1, items: [{ workspace_id: h.workspaceId }] });
    h.context.workspaceStore.addMember(second.id, 'user_reviewer', new Date().toISOString());
    const secondList = await h.app.inject({ method: 'GET', url: `/api/review-cases?workspace_id=${second.id}&page=1&page_size=20`,
      headers: { authorization: `Bearer ${h.reviewerToken}` } });
    expect(secondList.json()).toMatchObject({ total: 1, items: [{ workspace_id: second.id }] });
  });

  it('reassigns an approved Proposal, revokes the old Grant and cancels its schedule', async () => {
    const h = await harness();
    const second = createSecondWorkspace(h);
    h.context.workspaceStore.addMember(second.id, 'user_reviewer', new Date().toISOString());
    expect((await decideApprove(h, { scheduleAt: new Date(Date.now() + 3_600_000), expiresAt: new Date(Date.now() + 7_200_000) })).statusCode).toBe(200);
    const response = await h.app.inject({ method: 'POST', url: `/api/proposals/${h.proposalId}/reassign`,
      headers: { authorization: `Bearer ${h.reviewerToken}` },
      payload: { workspace_id: second.id, repository_id: second.repositories[0]!.id, reason: '复核后确认应归属账务仓库' } });
    expect(response.statusCode).toBe(200);
    expect(h.context.proposals.get(h.proposalId)).toMatchObject({ status: 'pending_review', workspace_id: second.id,
      repository_id: second.repositories[0]!.id });
    expect(h.context.grants.getByProposal(h.proposalId)).toMatchObject({ status: 'revoked' });
    expect(h.context.schedules.getByProposal(h.proposalId)).toMatchObject({ status: 'cancelled' });
    expect((h.context.plugin as MockPluginClient).reassignCalls).toBe(1);
    const audit = h.context.db.prepare("SELECT after_json FROM audit_events WHERE action = 'routing.reassigned'").get() as { after_json: string };
    expect(JSON.parse(audit.after_json)).toMatchObject({ workspace_id: second.id, reason: '复核后确认应归属账务仓库' });
  });

  it('rejects reassignment when the reviewer cannot access the source workspace', async () => {
    const h = await harness();
    const second = createSecondWorkspace(h);
    h.context.workspaceStore.addMember(second.id, 'user_reviewer', new Date().toISOString());
    h.context.workspaceStore.removeMember(h.workspaceId, 'user_reviewer');
    const response = await h.app.inject({ method: 'POST', url: `/api/proposals/${h.proposalId}/reassign`,
      headers: { authorization: `Bearer ${h.reviewerToken}` },
      payload: { workspace_id: second.id, repository_id: second.repositories[0]!.id, reason: '不应允许跨源工作区改派' } });
    expect(response.statusCode).toBe(403);
    expect((h.context.plugin as MockPluginClient).reassignCalls).toBe(0);
  });

  it('keeps global analytics totals equal to the sum of workspace rows and restricts the page to admins', async () => {
    const h = await harness();
    const second = createSecondWorkspace(h);
    createReviewFixture(h.context, '账务发起人', '账务统计需求', randomUUID(),
      { workspaceId: second.id, repositoryId: second.repositories[0]!.id });
    const denied = await h.app.inject({ method: 'GET', url: '/api/analytics/overview?range=30d',
      headers: { authorization: `Bearer ${h.reviewerToken}` } });
    expect(denied.statusCode).toBe(403);
    const response = await h.app.inject({ method: 'GET', url: '/api/analytics/overview?range=30d',
      headers: { authorization: `Bearer ${h.adminToken}` } });
    expect(response.statusCode).toBe(200);
    const analytics = response.json() as AnalyticsOverview;
    expect(analytics.workspaces).toHaveLength(2);
    expect(analytics.totals.pending_review).toBe(analytics.workspaces.reduce((sum, row) => sum + row.pending_review, 0));
    expect(analytics.totals.completed).toBe(analytics.workspaces.reduce((sum, row) => sum + row.completed, 0));
    expect(analytics.provider_distribution.reduce((sum, item) => sum + item.count, 0))
      .toBe(analytics.workspaces.reduce((sum, row) => sum + row.repositories.length, 0));
  });
});
