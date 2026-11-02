import { loadConfig } from './config.js';
import { createApplication } from './app.js';

const config = loadConfig();
const { app } = await createApplication({ config, logger: true, startScheduler: true });
try {
  await app.listen({ host: config.host, port: config.port });
  console.log(`Gatehouse server listening at http://${config.host}:${config.port}`);
} catch (error) {
  app.log.error(error);
  process.exit(1);
}

const shutdown = async () => {
  await app.close();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
