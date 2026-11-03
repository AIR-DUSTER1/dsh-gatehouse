import { createServer } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { readMonitoredRepository } from '../src/plugin/workspace-repository.js';

const servers: ReturnType<typeof createServer>[] = [];
afterEach(async () => {
  while (servers.length) {
    const server = servers.pop()!;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

async function stateServer(payload: unknown): Promise<{ url: string; observed: { path: string | undefined; requestHeader: string | string[] | undefined } }> {
  const observed: { path: string | undefined; requestHeader: string | string[] | undefined } = { path: undefined, requestHeader: undefined };
  const server = createServer((request, response) => {
    observed.path = request.url;
    observed.requestHeader = request.headers['x-orchestrator-request'];
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify(payload));
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('server address unavailable');
  return { url: `http://127.0.0.1:${address.port}`, observed };
}

describe('readMonitoredRepository', () => {
  it('reads the GitHub repository from the DSH state view', async () => {
    const remote = await stateServer({
      setup: { accounts: { repository: 'AIR-DUSTER1/dsh-superagent-review', agent: 'AIR-DUSTER1' } },
    });
    await expect(readMonitoredRepository(`${remote.url}/`, 1_000)).resolves.toBe('AIR-DUSTER1/dsh-superagent-review');
    expect(remote.observed).toEqual({
      path: '/orchestrator/api/state',
      requestHeader: '1',
    });
  });

  it('ignores unavailable or malformed DSH state without breaking the console', async () => {
    const remote = await stateServer({ setup: { accounts: { repository: 'not-a-repository' } } });
    await expect(readMonitoredRepository(remote.url, 1_000)).resolves.toBeNull();
    await expect(readMonitoredRepository('http://127.0.0.1:1', 250)).resolves.toBeNull();
  });
});
