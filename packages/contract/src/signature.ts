import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Canonical plugin signature for this version:
 * HMAC-SHA256(secret, `${timestamp}.${nonce}.${JSON.stringify(body)}`)
 */
export function createPluginSignature(
  secret: string,
  timestamp: string,
  nonce: string,
  body: unknown,
): string {
  return createHmac('sha256', secret)
    .update(`${timestamp}.${nonce}.${JSON.stringify(body)}`)
    .digest('hex');
}

export function verifyPluginSignature(
  secret: string,
  timestamp: string,
  nonce: string,
  body: unknown,
  signature: string,
  now = Date.now(),
  toleranceMs = 5 * 60 * 1000,
): boolean {
  const numericTimestamp = Number(timestamp);
  if (!Number.isFinite(numericTimestamp) || Math.abs(now - numericTimestamp) > toleranceMs) {
    return false;
  }
  const expected = Buffer.from(createPluginSignature(secret, timestamp, nonce, body), 'hex');
  const received = Buffer.from(signature, 'hex');
  return expected.length === received.length && timingSafeEqual(expected, received);
}
