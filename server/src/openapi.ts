// Emits the OpenAPI document to packages/api-contract/openapi.json.
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { buildApp } from './app.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const target = path.resolve(here, '../../packages/api-contract/openapi.json');

const app = await buildApp();
await app.ready();
const doc = app.swagger();
await writeFile(target, JSON.stringify(doc, null, 2) + '\n');
await app.close();
console.log(`wrote ${path.relative(process.cwd(), target)}`);
