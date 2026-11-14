import { writeFile, mkdir } from 'node:fs/promises';
import { endpointSchemas } from '../dist/contracts/catalog.js';
await mkdir(new URL('../docs/', import.meta.url), { recursive: true });
await writeFile(new URL('../docs/contract-map.json', import.meta.url), JSON.stringify({ schemaVersion: '2', source: 'src/contracts/api.ts + models.ts; consumed fields only', endpoints: endpointSchemas() }, null, 2) + '\n');
