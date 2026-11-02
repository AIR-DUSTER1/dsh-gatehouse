import { loadConfig } from './config.js';
import { createApplication } from './app.js';

const config = loadConfig();
const { app } = await createApplication({ config, logger: true });
console.log('演示数据已就绪。可直接运行 pnpm dev 启动控制台。');
await app.close();
