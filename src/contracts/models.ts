import { z } from 'zod';
import { endpoint, id, nonblank, empty } from './api.js';
const oid = z.string().regex(/^[a-f\d]{24}$/i);
const family = z.enum(['QWEN', 'GPT', 'CLAUDE', 'GEMINI', 'GENERIC']);
const providerType = z.enum(['ALIBABA', 'OPENAI', 'ANTHROPIC', 'GOOGLE', 'OPENAI_COMPATIBLE']);
const url = z.url().refine(value => { const u = new URL(value); return ['http:', 'https:'].includes(u.protocol) && !u.username && !u.password; }).nullable();
const decimal = z.string().regex(/^\d+(\.\d+)?$/);
export const providerSchema = z.object({ id: oid, name: id, scope: z.enum(['USER', 'SYSTEM']), type: providerType, base_url: url, api_key_fingerprint: z.string().nullable(), is_active: z.boolean() }).passthrough();
export const modelSchema = z.object({ id: oid, display_name: id, scope: z.enum(['USER', 'SYSTEM']), is_active: z.boolean(), mappings: z.array(z.object({ model_id: oid, provider_id: oid, provider_model_name: id }).passthrough()).nullable() }).passthrough();
const providerCreate = z.strictObject({ name: nonblank, type: providerType, api_key: id, base_url: url.optional(), is_active: z.boolean().optional() });
const modelCreate = z.strictObject({ display_name: nonblank, model_family: family.optional(), support_thinking: z.boolean().optional(), support_vision: z.boolean().optional(), support_tools: z.boolean().optional(), context_window_tokens: z.number().int().positive().nullable().optional(), max_output_tokens: z.number().int().positive().nullable().optional() });
const prefix = '/chat/model/';
export const modelsApi = {
  providers: endpoint('GET', `${prefix}listUserProviders`, z.strictObject({}), z.object({ providers: z.array(providerSchema) })),
  models: endpoint('GET', `${prefix}listModels`, z.strictObject({ model_scope: z.enum(['SYSTEM', 'USER']) }), z.object({ models: z.array(modelSchema) })),
  available: endpoint('GET', `${prefix}listAvailableModels`, z.strictObject({}), z.object({ system_models: z.array(modelSchema), user_models: z.array(modelSchema) })),
  createProvider: endpoint('POST', `${prefix}createUserProvider`, providerCreate, empty),
  updateProvider: endpoint('POST', `${prefix}updateUserProvider`, providerCreate.partial().extend({ provider_id: oid }), empty),
  deleteProvider: endpoint('POST', `${prefix}deleteUserProvider`, z.strictObject({ provider_id: oid }), empty),
  createModel: endpoint('POST', `${prefix}createUserModel`, modelCreate, empty),
  updateModel: endpoint('POST', `${prefix}updateUserModel`, modelCreate.partial().extend({ model_id: oid, is_active: z.boolean().optional() }), empty),
  deleteModel: endpoint('POST', `${prefix}deleteUserModel`, z.strictObject({ model_id: oid }), empty),
  bind: endpoint('POST', `${prefix}bindModelProvider`, z.strictObject({ model_id: oid, provider_id: oid, provider_model_name: nonblank, input_billing_ratio: decimal.optional(), cached_input_billing_ratio: decimal.optional(), output_billing_ratio: decimal.optional(), is_preferred: z.boolean().optional(), is_active: z.boolean().optional() }), empty),
  unbind: endpoint('POST', `${prefix}unbindModelProvider`, z.strictObject({ model_id: oid, provider_id: oid }), empty),
};
