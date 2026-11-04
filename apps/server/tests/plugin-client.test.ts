import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { verifyPluginSignature } from '@gatehouse/contract/signature';
import { HttpPluginClient } from '../src/plugin/plugin-client.js';

const servers: ReturnType<typeof createServer>[] = [];
afterEach(async () => {
  while (servers.length) {
    const server = servers.pop()!;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

function read(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk: string) => { body += chunk; });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

async function pluginServer(secret: string): Promise<{ url: string; paths: string[]; validSignatures: boolean[] }> {
  const paths: string[] = [];
  const validSignatures: boolean[] = [];
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const body = await read(req);
    paths.push(String(req.url));
    const parsed = JSON.parse(body) as unknown;
    validSignatures.push(verifyPluginSignature(secret, String(req.headers['x-timestamp']), String(req.headers['x-nonce']),
      parsed, String(req.headers['x-signature'])));
    res.writeHead(200, { 'content-type': 'application/json' });
    const response = req.url?.endsWith('/workspaces/sync')
      ? { applied: 1, disabled: 0, config_version: 2, config_hash: `sha256:${'b'.repeat(64)}`, replayed: false }
      : req.url?.endsWith('/workspaces/validate')
        ? { provider: 'github', repository_key: 'owner/repo', web_url: 'https://github.com/owner/repo', default_branch: 'main',
            language: 'TypeScript', topics: ['test'], readme_excerpt: 'readme', source_fingerprint: `sha256:${'c'.repeat(64)}`,
            permissions: { read: true, push: true, change_requests: true } }
        : req.url?.endsWith('/workspaces/describe')
          ? { short_description: '负责测试和交付的仓库描述，长度足够通过契约校验。', capabilities: ['测试'],
              routing_keywords: ['测试', '交付', '仓库'], exclusions: [], confidence: 0.9,
              source_fingerprint: `sha256:${'c'.repeat(64)}`, generated_at: new Date().toISOString(), model: 'test/model' }
          : { execution_id: 'exec-1', pr_url: 'https://example.test/pr/1' };
    res.end(JSON.stringify(response));
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('server address unavailable');
  return { url: `http://127.0.0.1:${address.port}`, paths, validSignatures };
}

describe('HttpPluginClient', () => {
  it('signs decision and execution requests with HMAC and uses versioned routes', async () => {
    const secret = 'plugin-integration-test-secret';
    const remote = await pluginServer(secret);
    const client = new HttpPluginClient(remote.url, secret, 2_000);
    const hash = `sha256:${'a'.repeat(64)}`;
    await client.decide({
      proposal_id: 'proposal-1', decision: 'approve', reviewer: '复核人甲', comment: '批准',
      requirement_hash: hash, scope_hash: hash, workspace_binding_hash: hash,
      schedule_at: new Date(Date.now() + 3_600_000).toISOString(),
      expires_at: new Date(Date.now() + 7_200_000).toISOString(), trace_id: 'trace-1', idempotency_key: 'idem-1',
    });
    const result = await client.execute({
      proposal_id: 'proposal-1', grant_id: 'grant-1', requirement_hash: hash, scope_hash: hash, workspace_binding_hash: hash,
      execution_id: 'exec-1', trace_id: 'trace-1', idempotency_key: 'execute:exec-1',
    });
    expect(result).toEqual({ execution_id: 'exec-1', pr_url: 'https://example.test/pr/1' });
    const repository = { workspace_id: 'workspace-1', repository_id: 'repository-1', provider: 'github' as const,
      repository_key: 'owner/repo', api_base_url: 'https://api.github.com', web_base_url: 'https://github.com/owner/repo',
      clone_url: 'https://github.com/owner/repo.git', default_branch: 'main', credential_ref: '', custom_ca_ref: null,
      observe: { issues: true, change_requests: true, comments: true, ci: true }, trace_id: 'trace-workspace',
      idempotency_key: 'workspace-key' };
    await client.validateRepository(repository);
    await client.describeRepository(repository);
    await client.syncWorkspaces({ trace_id: 'trace-workspace', idempotency_key: 'sync-key', config_version: 2,
      config_hash: `sha256:${'b'.repeat(64)}`, workspaces: [{ ...repository, workspace_slug: 'test', workspace_name: '测试工作区',
        workspace_status: 'active', description: '仓库描述', description_version: 1, description_hash: `sha256:${'d'.repeat(64)}`,
        short_description: '仓库描述', capabilities: ['测试'], routing_keywords: ['测试', '交付', '仓库'], exclusions: [],
        confidence: 0.9, source_instance_id: 'github-test' }] });
    await client.reassignProposal({ proposal_id: 'proposal-1', workspace_id: 'workspace-1', repository_id: 'repository-1',
      reason: '复核改派', trace_id: 'trace-workspace', idempotency_key: 'reassign-key' });
    expect(remote.paths).toEqual([
      '/orchestrator/api/proposals/proposal-1/decision', '/orchestrator/api/executions',
      '/orchestrator/api/workspaces/validate', '/orchestrator/api/workspaces/describe',
      '/orchestrator/api/workspaces/sync', '/orchestrator/api/workspaces/reassign-proposal',
    ]);
    expect(remote.validSignatures).toEqual([true, true, true, true, true, true]);
  });
});
