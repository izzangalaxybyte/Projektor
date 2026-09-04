import { buildApp } from './app.js';

const port = Number(process.env['PORT'] ?? 8096);
const host = process.env['HOST'] ?? '0.0.0.0';

const app = await buildApp({ logger: true });
await app.listen({ port, host });
