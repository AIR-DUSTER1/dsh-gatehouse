import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadDotEnv } from 'dotenv';

export const PROJECT_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
loadDotEnv({ path: resolve(PROJECT_ROOT, '.env'), quiet: true });

export interface AppConfig {
  host: string;
  port: number;
  databasePath: string;
  sessionSecret: string;
  pluginEventSecret: string;
  pluginSharedSecret: string;
  pluginBaseUrl: string;
  pluginMode: 'mock' | 'http';
  schedulePollMs: number;
  scheduleMaxConcurrency: number;
  pluginTimeoutMs: number;
  pluginMaxAttempts: number;
  webOrigin: string;
  demoSeed: boolean;
  sessionTtlSeconds: number;
}

function integer(name: string, fallback: number): number {
  const value = process.env[name];
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${name} must be a positive integer`);
  return parsed;
}

export function loadConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    host: process.env.HOST ?? '127.0.0.1',
    port: integer('PORT', 8787),
    databasePath: resolve(PROJECT_ROOT, process.env.DATABASE_PATH ?? './data/console.db'),
    sessionSecret: process.env.SESSION_SECRET ?? 'dev-session-secret-change-me',
    pluginEventSecret: process.env.PLUGIN_EVENT_SECRET ?? 'dev-event-secret-change-me',
    pluginSharedSecret: process.env.PLUGIN_SHARED_SECRET ?? 'dev-plugin-secret-change-me',
    pluginBaseUrl: process.env.PLUGIN_BASE_URL ?? 'http://127.0.0.1:8790',
    pluginMode: process.env.PLUGIN_MODE === 'http' ? 'http' : 'mock',
    schedulePollMs: integer('SCHEDULE_POLL_MS', 1000),
    scheduleMaxConcurrency: integer('SCHEDULE_MAX_CONCURRENCY', 2),
    pluginTimeoutMs: integer('PLUGIN_TIMEOUT_MS', 5000),
    pluginMaxAttempts: integer('PLUGIN_MAX_ATTEMPTS', 5),
    webOrigin: process.env.WEB_ORIGIN ?? 'http://127.0.0.1:5173',
    demoSeed: process.env.DEMO_SEED !== 'false',
    sessionTtlSeconds: integer('SESSION_TTL_SECONDS', 8 * 60 * 60),
    ...overrides,
  };
}
