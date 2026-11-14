import { z } from 'zod';
import { api } from './api.js';
import { modelsApi } from './models.js';
export function endpointSchemas(): Record<string, unknown> {
  return Object.fromEntries(Object.entries({ ...api, ...modelsApi }).map(([key, e]) => [key, { method: e.method, path: e.path, query: e.query, auth: e.auth, readOnly: e.readOnly, successCode: 200, request: z.toJSONSchema(e.request, { io: 'input' }), responseWire: z.toJSONSchema(e.response, { io: 'input' }) }]));
}
