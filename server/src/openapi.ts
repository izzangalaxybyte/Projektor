// Emits the OpenAPI document to packages/api-contract/openapi.json.
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import { buildApp } from './app.js';
import { configForDataDir } from './config.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const target = path.resolve(here, '../../packages/api-contract/openapi.json');

const tmp = mkdtempSync(path.join(os.tmpdir(), 'projektor-openapi-'));
const app = await buildApp({ config: configForDataDir(tmp) });
await app.ready();
const doc = app.swagger();
await writeFile(target, JSON.stringify(doc, null, 2) + '\n');
await app.close();
rmSync(tmp, { recursive: true, force: true });
console.log(`wrote ${path.relative(process.cwd(), target)}`);
