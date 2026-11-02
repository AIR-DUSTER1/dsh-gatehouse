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
    res.end(JSON.stringify({ execution_id: 'exec-1', pr_url: 'https://example.test/pr/1' }));
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
      requirement_hash: hash, scope_hash: hash, schedule_at: new Date(Date.now() + 3_600_000).toISOString(),
      expires_at: new Date(Date.now() + 7_200_000).toISOString(), trace_id: 'trace-1', idempotency_key: 'idem-1',
    });
    const result = await client.execute({
      proposal_id: 'proposal-1', grant_id: 'grant-1', requirement_hash: hash, scope_hash: hash,
      execution_id: 'exec-1', trace_id: 'trace-1', idempotency_key: 'execute:exec-1',
    });
    expect(result).toEqual({ execution_id: 'exec-1', pr_url: 'https://example.test/pr/1' });
    expect(remote.paths).toEqual(['/orchestrator/api/proposals/proposal-1/decision', '/orchestrator/api/executions']);
    expect(remote.validSignatures).toEqual([true, true]);
  });
});
