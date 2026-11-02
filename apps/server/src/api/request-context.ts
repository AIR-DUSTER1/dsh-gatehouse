import { randomUUID } from 'node:crypto';
import type { FastifyRequest } from 'fastify';

export function traceId(request: FastifyRequest): string {
  const header = request.headers['x-trace-id'];
  return typeof header === 'string' && header.trim() ? header : randomUUID();
}

export function headerValue(request: FastifyRequest, name: string): string {
  const value = request.headers[name.toLowerCase()];
  return typeof value === 'string' ? value : '';
}
