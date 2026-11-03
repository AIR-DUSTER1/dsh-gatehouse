import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { describe, expect, it } from 'vitest';
import {
  decisionInputSchema,
  pluginDecisionRequestSchema,
  pluginEventSchema,
  proposalInputSchema,
  scheduleChangeInputSchema,
  scheduleWithdrawInputSchema,
} from '../src/index.js';

const schemaDir = fileURLToPath(new URL('../schemas/', import.meta.url));
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
for (const file of readdirSync(schemaDir).filter((name) => name.endsWith('.json'))) {
  ajv.addSchema(JSON.parse(readFileSync(join(schemaDir, file), 'utf8')));
}

const hash = `sha256:${'a'.repeat(64)}`;
const proposal = {
  id: 'proposal-1', review_case_id: 'case-1', assessment_revision: 1,
  summary: '实现人工复核闭环', scope: ['新增审批 API'], scope_hash: hash,
  rule_hits: ['touches-api'], impact_files: ['apps/server/src/app.ts'],
  test_plan: ['通过契约测试'], estimated_cost: '约 2 小时', risk: 'medium',
  risk_reason: '涉及审批状态', status: 'pending_review',
  created_at: '2026-11-02T02:00:00.000Z', updated_at: '2026-11-02T02:00:00.000Z',
};

describe('JSON schemas', () => {
  it('validates the proposal contract with both Zod and JSON Schema', () => {
    expect(proposalInputSchema.safeParse(proposal).success).toBe(true);
    const validate = ajv.getSchema('https://dsh.local/schemas/proposal.schema.json')!;
    expect(validate(proposal)).toBe(true);
  });

  it('validates approve decision', () => {
    const value = {
      decision: 'approve', comment: '范围明确', schedule_at: '2026-11-03T02:00:00.000Z',
      expires_at: '2026-11-04T02:00:00.000Z', timezone: 'Asia/Shanghai', risk_confirmed: true,
    };
    expect(decisionInputSchema.safeParse(value).success).toBe(true);
    const validate = ajv.getSchema('https://dsh.local/schemas/decision.schema.json')!;
    expect(validate(value)).toBe(true);
  });

  it('accepts decisions without a review comment', () => {
    const values = [
      {
        decision: 'approve', schedule_at: '2026-11-03T02:00:00.000Z', expires_at: '2026-11-04T02:00:00.000Z',
        timezone: 'Asia/Shanghai', risk_confirmed: true,
      },
      { decision: 'reject', risk_confirmed: true },
      { decision: 'request_info', risk_confirmed: true },
    ];
    const validate = ajv.getSchema('https://dsh.local/schemas/decision.schema.json')!;
    for (const value of values) {
      expect(decisionInputSchema.parse(value).comment).toBe('');
      expect(validate(value)).toBe(true);
    }
    expect(pluginDecisionRequestSchema.parse({
      proposal_id: 'proposal-1', decision: 'approve', reviewer: '演示复核人', requirement_hash: hash,
      grant_id: 'grant-1', scope_hash: hash, schedule_at: '2026-11-03T02:00:00.000Z', expires_at: '2026-11-04T02:00:00.000Z',
      trace_id: 'trace-1', idempotency_key: 'idem-1',
    }).comment).toBe('');
  });

  it('validates schedule changes and withdrawals with both contract formats', () => {
    const change = { schedule_at: '2026-11-03T10:00:00.000Z', expires_at: '2026-11-03T12:00:00.000Z',
      timezone: 'Asia/Shanghai', reason: '调整开发窗口' };
    expect(scheduleChangeInputSchema.safeParse(change).success).toBe(true);
    expect(ajv.getSchema('https://dsh.local/schemas/schedule-change.schema.json')!(change)).toBe(true);
    const withdraw = { reason: '重新评估范围' };
    expect(scheduleWithdrawInputSchema.safeParse(withdraw).success).toBe(true);
    expect(ajv.getSchema('https://dsh.local/schemas/schedule-withdraw.schema.json')!(withdraw)).toBe(true);
  });

  it('validates the plugin event envelope and decision command', () => {
    const event = {
      version: '1.0', event_id: 'evt-1', event_type: 'proposal.created',
      occurred_at: '2026-11-02T02:00:00.000Z', trace_id: 'trace-1', data: { case: {}, proposal: {} },
    };
    expect(pluginEventSchema.safeParse(event).success).toBe(true);
    expect(ajv.getSchema('https://dsh.local/schemas/plugin-event.schema.json')!(event)).toBe(true);
    expect(pluginDecisionRequestSchema.safeParse({
      proposal_id: 'proposal-1', decision: 'approve', reviewer: '复核人', comment: '可以执行', grant_id: 'grant-1', requirement_hash: hash,
      scope_hash: hash, schedule_at: '2026-11-03T02:00:00.000Z',
      expires_at: '2026-11-04T02:00:00.000Z', trace_id: 'trace-1', idempotency_key: 'idem-1',
    }).success).toBe(true);
  });

  it('rejects malformed hashes', () => {
    expect(proposalInputSchema.safeParse({ ...proposal, scope_hash: 'sha256:not-valid' }).success).toBe(false);
  });
});
