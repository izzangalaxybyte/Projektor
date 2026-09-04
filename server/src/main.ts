import { buildApp } from './app.js';
import { loadConfig } from './config.js';

const config = loadConfig();
const app = await buildApp({ config, logger: true });

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    app.log.info({ signal }, 'shutting down');
    void app.close().then(() => process.exit(0));
  });
}

await app.listen({ port: config.port, host: config.host });
