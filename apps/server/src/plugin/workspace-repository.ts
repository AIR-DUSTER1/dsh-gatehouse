import { z } from 'zod';

const repositoryPattern = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const stateSchema = z.object({
  setup: z.object({
    accounts: z.object({
      repository: z.string().trim().regex(repositoryPattern).nullable().optional(),
    }).nullable().optional(),
  }).optional(),
}).passthrough();

/**
 * Reads the repository currently watched by DSH's GitHub Source.
 * This is display configuration only, so an unavailable or older DSH instance falls back to `null`.
 */
export async function readMonitoredRepository(baseUrl: string, timeoutMs: number): Promise<string | null> {
  const url = `${baseUrl.replace(/\/+$/, '')}/orchestrator/api/state`;
  try {
    const response = await fetch(url, {
      headers: { accept: 'application/json', 'x-orchestrator-request': '1' },
      signal: AbortSignal.timeout(Math.max(250, Math.min(timeoutMs, 2_000))),
    });
    if (!response.ok) return null;
    const parsed = stateSchema.safeParse(await response.json());
    return parsed.success ? parsed.data.setup?.accounts?.repository ?? null : null;
  } catch {
    return null;
  }
}
