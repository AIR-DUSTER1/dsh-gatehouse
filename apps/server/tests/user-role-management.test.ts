import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { User } from '@gatehouse/contract';
import { createHarness, type TestHarness } from './helpers.js';

let h: TestHarness;
beforeEach(async () => { h = await createHarness(); });
afterEach(async () => { await h.app.close(); });

function tokenFromUrl(url: string): string {
  const token = new URL(url).hash.replace(/^#token=/, '');
  if (!token) throw new Error('invite URL did not contain a token');
  return decodeURIComponent(token);
}

async function createInvited(email = 'new.user@test.local') {
  const viewerRole = h.context.roles.findByCode('viewer')!;
  const response = await h.app.inject({
    method: 'POST', url: '/api/users', headers: { authorization: `Bearer ${h.adminToken}` },
    payload: { name: '新成员', email, role_id: viewerRole.id, workspace_ids: [h.workspaceId] },
  });
  expect(response.statusCode).toBe(200);
  return response.json() as { user: User; invitation: { url: string; expires_at: string } };
}

describe('managed users and roles', () => {
  it('creates an invited user and activates it through a one-time token', async () => {
    const created = await createInvited();
    expect(created.user).toMatchObject({ email: 'new.user@test.local', status: 'invited', role: 'viewer' });
    const rawToken = tokenFromUrl(created.invitation.url);
    const tokenRow = h.context.db.prepare('SELECT token_hash FROM user_action_tokens WHERE user_id = ?').get(created.user.id) as { token_hash: string };
    expect(tokenRow.token_hash).not.toContain(rawToken);
    expect(tokenRow.token_hash).toMatch(/^sha256:[a-f0-9]{64}$/);

    const accepted = await h.app.inject({ method: 'POST', url: '/api/auth/invitations/accept', payload: { token: rawToken, password: 'strong-password-123' } });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json()).toMatchObject({ user: { id: created.user.id, status: 'active', role: 'viewer' } });
    const acceptedBody = accepted.json() as { token: string; user: User };
    expect(acceptedBody.user.permissions).toContain('workspace.read');
    expect(acceptedBody.user.permissions).not.toContain('review.decide');

    const replay = await h.app.inject({ method: 'POST', url: '/api/auth/invitations/accept', payload: { token: rawToken, password: 'strong-password-123' } });
    expect(replay.statusCode).toBe(400);
    const me = await h.app.inject({ method: 'GET', url: '/api/auth/me', headers: { authorization: `Bearer ${acceptedBody.token}` } });
    expect(me.statusCode).toBe(200);
  });

  it('keeps account directory and settings permissions separated', async () => {
    const denied = await h.app.inject({ method: 'GET', url: '/api/users', headers: { authorization: `Bearer ${h.reviewerToken}` } });
    expect(denied.statusCode).toBe(403);
    const settings = await h.app.inject({ method: 'GET', url: '/api/settings', headers: { authorization: `Bearer ${h.reviewerToken}` } });
    expect(settings.statusCode).toBe(200);
    expect(settings.json()).not.toHaveProperty('users');
    const options = await h.app.inject({ method: 'GET', url: '/api/users/options', headers: { authorization: `Bearer ${h.reviewerToken}` } });
    expect(options.statusCode).toBe(403);
  });

  it('invalidates an active session immediately when the account is disabled', async () => {
    const created = await createInvited('disabled.user@test.local');
    const accepted = await h.app.inject({ method: 'POST', url: '/api/auth/invitations/accept', payload: { token: tokenFromUrl(created.invitation.url), password: 'strong-password-123' } });
    const sessionToken = (accepted.json() as { token: string }).token;
    const disabled = await h.app.inject({ method: 'POST', url: `/api/users/${created.user.id}/disable`, headers: { authorization: `Bearer ${h.adminToken}` }, payload: {} });
    expect(disabled.statusCode).toBe(200);
    const expired = await h.app.inject({ method: 'GET', url: '/api/auth/me', headers: { authorization: `Bearer ${sessionToken}` } });
    expect(expired.statusCode).toBe(401);
    const login = await h.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'disabled.user@test.local', password: 'strong-password-123' } });
    expect(login.statusCode).toBe(401);
  });

  it('updates role permissions without trusting stale JWT role data', async () => {
    const reviewerRole = h.context.roles.findByCode('reviewer')!;
    const response = await h.app.inject({ method: 'PATCH', url: `/api/roles/${reviewerRole.id}`, headers: { authorization: `Bearer ${h.adminToken}` }, payload: { name: '复核人', description: '可复核', permissions: ['workspace.read', 'review.read'] } });
    expect(response.statusCode).toBe(200);
    const denied = await h.app.inject({ method: 'POST', url: `/api/proposals/${h.proposalId}/decision`, headers: { authorization: `Bearer ${h.reviewerToken}`, 'idempotency-key': crypto.randomUUID() }, payload: { decision: 'reject', comment: '不应获批', risk_confirmed: true } });
    expect(denied.statusCode).toBe(403);
  });

  it('protects administrator role and self-management boundaries', async () => {
    const me = await h.app.inject({ method: 'GET', url: '/api/auth/me', headers: { authorization: `Bearer ${h.adminToken}` } });
    const admin = (me.json() as { user: User }).user;
    const disable = await h.app.inject({ method: 'POST', url: `/api/users/${admin.id}/disable`, headers: { authorization: `Bearer ${h.adminToken}` }, payload: {} });
    expect(disable.statusCode).toBe(409);
    expect(disable.json()).toMatchObject({ error: { code: 'SELF_DISABLE_FORBIDDEN' } });
    const viewerRole = h.context.roles.findByCode('viewer')!;
    const demote = await h.app.inject({ method: 'PATCH', url: `/api/users/${admin.id}`, headers: { authorization: `Bearer ${h.adminToken}` }, payload: { name: admin.name, role_id: viewerRole.id, workspace_ids: [] } });
    expect(demote.statusCode).toBe(409);
    expect(demote.json()).toMatchObject({ error: { code: 'SELF_DEMOTION_FORBIDDEN' } });
    const adminRole = h.context.roles.findByCode('admin')!;
    const editAdmin = await h.app.inject({ method: 'PATCH', url: `/api/roles/${adminRole.id}`, headers: { authorization: `Bearer ${h.adminToken}` }, payload: { name: '管理员', permissions: ['workspace.read'] } });
    expect(editAdmin.statusCode).toBe(409);
  });

  it('resets a password, consumes the token once and invalidates the existing session', async () => {
    const created = await createInvited('reset.user@test.local');
    const accepted = await h.app.inject({ method: 'POST', url: '/api/auth/invitations/accept', payload: { token: tokenFromUrl(created.invitation.url), password: 'strong-password-123' } });
    const oldSession = (accepted.json() as { token: string }).token;
    const reset = await h.app.inject({ method: 'POST', url: `/api/users/${created.user.id}/password-reset`, headers: { authorization: `Bearer ${h.adminToken}` }, payload: {} });
    expect(reset.statusCode).toBe(200);
    const resetUrl = (reset.json() as { reset: { url: string } }).reset.url;
    const completed = await h.app.inject({ method: 'POST', url: '/api/auth/password-reset/complete', payload: { token: tokenFromUrl(resetUrl), password: 'reset-password-456' } });
    expect(completed.statusCode).toBe(200);
    expect((await h.app.inject({ method: 'GET', url: '/api/auth/me', headers: { authorization: `Bearer ${oldSession}` } })).statusCode).toBe(401);
    expect((await h.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'reset.user@test.local', password: 'strong-password-123' } })).statusCode).toBe(401);
    expect((await h.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'reset.user@test.local', password: 'reset-password-456' } })).statusCode).toBe(200);
  });

  it('creates a custom role and returns its effective permissions on users', async () => {
    const role = await h.app.inject({ method: 'POST', url: '/api/roles', headers: { authorization: `Bearer ${h.adminToken}` },
      payload: { code: 'release-reviewer', name: '发布复核人', description: '负责发布复核', permissions: ['workspace.read', 'review.read', 'review.decide'] } });
    expect(role.statusCode).toBe(200);
    const createdRole = (role.json() as { role: { id: string } }).role;
    const created = await h.app.inject({ method: 'POST', url: '/api/users', headers: { authorization: `Bearer ${h.adminToken}` },
      payload: { name: '发布成员', email: 'release.user@test.local', role_id: createdRole.id, workspace_ids: [h.workspaceId] } });
    expect(created.statusCode).toBe(200);
    const listed = await h.app.inject({ method: 'GET', url: '/api/users?search=release.user@test.local&page=1&page_size=20', headers: { authorization: `Bearer ${h.adminToken}` } });
    expect(listed.json()).toMatchObject({ items: [{ role: 'release-reviewer', role_name: '发布复核人', permissions: expect.arrayContaining(['review.decide']) }] });
  });
  it('rejects custom roles that include administrator-only permissions', async () => {
    const response = await h.app.inject({ method: 'POST', url: '/api/roles', headers: { authorization: `Bearer ${h.adminToken}` }, payload: { code: 'super-role', name: '越权角色', permissions: ['workspace.read', 'workspace.manage'] } });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ error: { code: 'RESERVED_PERMISSION_FORBIDDEN' } });
  });
});
