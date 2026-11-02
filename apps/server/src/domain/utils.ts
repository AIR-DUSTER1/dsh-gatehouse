import { createHash, randomUUID } from 'node:crypto';

export function nowIso(now = new Date()): string {
  return now.toISOString();
}

export function sha256(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

export function newId(prefix: string): string {
  return `${prefix}_${randomUUID()}`;
}

export function stableHash(value: unknown): string {
  return sha256(JSON.stringify(value));
}

export function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string' || value.length === 0) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}
