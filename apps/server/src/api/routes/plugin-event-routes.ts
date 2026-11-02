import type { FastifyInstance } from 'fastify';
import { pluginEventSchema } from '@gatehouse/contract';
import { verifyPluginSignature } from '@gatehouse/contract/signature';
import type { AppContext } from '../../app.js';
import { DomainError } from '../../domain/errors.js';
import { headerValue } from '../request-context.js';

export async function registerPluginEventRoutes(app: FastifyInstance, context: AppContext): Promise<void> {
  app.post('/api/plugin/events', async (request) => {
    const timestamp = headerValue(request, 'x-timestamp');
    const nonce = headerValue(request, 'x-nonce');
    const signature = headerValue(request, 'x-signature');
    if (!timestamp || !nonce || !signature) {
      throw new DomainError('PLUGIN_SIGNATURE_REQUIRED', '缺少插件请求签名', '携带 x-timestamp、x-nonce、x-signature 后重试', 401);
    }
    if (!verifyPluginSignature(context.config.pluginEventSecret, timestamp, nonce, request.body, signature)) {
      throw new DomainError('INVALID_PLUGIN_SIGNATURE', '插件请求签名无效或已过期', '检查共享密钥、时间戳和签名内容', 401);
    }
    const envelope = pluginEventSchema.parse(request.body);
    return context.eventIngest.process({ envelope, nonce });
  });
}
