import { randomUUID, createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { ReviewCaseRecord, ProposalRecord } from '@gatehouse/contract';
import { createApplication, type AppContext } from '../src/app.js';
import { hashPassword } from '../src/auth.js';

export interface TestHarness {
  app: FastifyInstance;
  context: AppContext;
  reviewerToken: string;
  viewerToken: string;
  caseId: string;
  proposalId: string;
  login: (email: string, password?: string) => Promise<string>;
}

function hash(value: unknown): string {
  return `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
}

export async function createHarness(databasePath = ':memory:'): Promise<TestHarness> {
  const { app, context } = await createApplication({
    config: {
      databasePath,
      demoSeed: false,
      pluginMode: 'mock',
      sessionSecret: 'test-session-secret-with-enough-length',
      pluginEventSecret: 'test-event-secret-with-enough-length',
      pluginSharedSecret: 'test-plugin-secret-with-enough-length',
      schedulePollMs: 60_000,
      scheduleMaxConcurrency: 2,
      pluginMaxAttempts: 3,
    },
  });
  const now = new Date().toISOString();
  for (const user of [
    { id: 'user_reviewer', email: 'reviewer@test.local', name: '复核人甲', role: 'reviewer' as const, password: 'test123' },
    { id: 'user_viewer', email: 'viewer@test.local', name: '只读成员', role: 'viewer' as const, password: 'test123' },
    { id: 'user_admin', email: 'admin@test.local', name: '管理员', role: 'admin' as const, password: 'test123' },
  ]) {
    context.users.create({ id: user.id, email: user.email, name: user.name, role: user.role, password_hash: hashPassword(user.password) });
  }

  const fixture = createReviewFixture(context, '陈晓', '测试需求：实现审批闭环');
  const login = async (email: string, password = 'test123') => {
    const response = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password } });
    if (response.statusCode !== 200) throw new Error(`login failed: ${response.body}`);
    return (response.json() as { token: string }).token;
  };
  return {
    app, context, reviewerToken: await login('reviewer@test.local'), viewerToken: await login('viewer@test.local'),
    caseId: fixture.case.id, proposalId: fixture.proposal.id, login,
  };
}

export function createReviewFixture(context: AppContext, requester: string, title: string, suffix = randomUUID()): { case: ReviewCaseRecord; proposal: ProposalRecord } {
  const now = new Date().toISOString();
  const scope = [`实现 ${title}`, '补充自动化测试'];
  const requirement = `${title}：这是用于自动化验证的完整需求文本。`;
  const reviewCase: ReviewCaseRecord = {
    id: `case_${suffix}`, plugin_case_id: `plugin_case_${suffix}`, source: 'feishu', requester, title,
    requirement_text: requirement, requirement_hash: hash(requirement), status: 'pending_review', risk_level: 'medium',
    source_context: '自动化测试事件', message_url: null, created_at: now, updated_at: now,
  };
  const proposal: ProposalRecord = {
    id: `proposal_${suffix}`, review_case_id: reviewCase.id, assessment_revision: 1, summary: `建议按两个步骤完成 ${title}`,
    scope, scope_hash: hash(scope), rule_hits: ['touches-api'], impact_files: ['apps/server/src/app.ts'],
    test_plan: ['接口测试通过', '权限测试通过'], estimated_cost: '约 2 小时', risk: 'medium',
    risk_reason: '涉及审批状态流转。', status: 'pending_review', created_at: now, updated_at: now,
  };
  context.cases.create(reviewCase);
  context.proposals.create(proposal);
  context.audit.record({
    entityType: 'review_case', entityId: reviewCase.id, action: 'proposal.created', actor: 'dsh-superagent',
    before: null, after: { proposal_id: proposal.id }, traceId: `fixture-${suffix}`, at: now,
  });
  return { case: reviewCase, proposal };
}

export async function decideApprove(
  harness: TestHarness,
  options: { scheduleAt: Date; expiresAt: Date; proposalId?: string; idempotencyKey?: string },
): Promise<{ statusCode: number; body: Record<string, unknown> }> {
  const response = await harness.app.inject({
    method: 'POST', url: `/api/proposals/${options.proposalId ?? harness.proposalId}/decision`,
    headers: { authorization: `Bearer ${harness.reviewerToken}`, 'idempotency-key': options.idempotencyKey ?? randomUUID() },
    payload: {
      decision: 'approve', comment: '范围明确，批准执行', schedule_at: options.scheduleAt.toISOString(),
      expires_at: options.expiresAt.toISOString(), timezone: 'Asia/Shanghai', risk_confirmed: true,
    },
  });
  return { statusCode: response.statusCode, body: response.json() as Record<string, unknown> };
}
