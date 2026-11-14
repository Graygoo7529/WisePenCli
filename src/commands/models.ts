import { z } from 'zod';
import { modelsApi, modelSchema, providerSchema } from '../contracts/models.js';
import { unique } from '../domain/resolve.js';
import type { Context } from '../runtime/context.js';
import { invalid } from '../errors.js';
import { parse, secretInput } from '../runtime/io.js';
import { define, flag } from './registry.js';
const selection = { id: z.string().optional(), name: z.string().optional() };
const selectionOptions: [string, string][] = [['--id <id>', '明确 ID'], ['--name <name>', '精确名称']];
const scope = z.enum(['USER', 'SYSTEM']).default('USER');
async function resolveProvider(ctx: Context, i: Record<string, unknown>) {
  if (!!i.id === !!i.name) invalid('请指定 --id 或 --name 其中之一。');
  const list = (await (await ctx.api()).call(modelsApi.providers)).providers;
  return unique(list.filter(p => i.id ? p.id === i.id : p.name === i.name), '用户供应商', p => ({ id: p.id, name: p.name }));
}
async function resolveModel(ctx: Context, i: Record<string, unknown>) {
  if (!!i.id === !!i.name) invalid('请指定 --id 或 --name 其中之一。');
  const list = (await (await ctx.api()).call(modelsApi.models, { model_scope: i.scope ?? 'USER' })).models;
  return unique(list.filter(m => i.id ? m.id === i.id : m.display_name === i.name), '模型', m => ({ id: m.id, name: m.display_name, scope: m.scope }));
}
const editableProvider = (provider: z.infer<typeof providerSchema>) => { if (provider.scope !== 'USER') invalid('仅允许修改 USER 范围供应商。'); };
const editableModel = (model: z.infer<typeof modelSchema>) => { if (model.scope !== 'USER') invalid('仅允许修改 USER 范围模型。'); };
define({ name: 'provider list', description: '列出用户供应商及密钥指纹', input: z.strictObject({}), effect: 'read', run: async ctx => (await ctx.api()).call(modelsApi.providers) });
define({ name: 'provider show', description: '查看用户供应商', input: z.strictObject(selection), options: selectionOptions, effect: 'read', run: resolveProvider });
define({ name: 'model list', description: '列出指定范围模型及绑定', input: z.strictObject({ scope }), options: [['--scope <scope>', 'USER 或 SYSTEM']], effect: 'read', run: async (ctx, i) => (await ctx.api()).call(modelsApi.models, { model_scope: i.scope }) });
define({ name: 'model available', description: '列出当前可选模型', input: z.strictObject({}), effect: 'read', run: async ctx => (await ctx.api()).call(modelsApi.available) });
define({ name: 'model show', description: '按名称或 ID 查看模型', input: z.strictObject({ ...selection, scope }), options: [...selectionOptions, ['--scope <scope>', 'USER 或 SYSTEM']], effect: 'read', run: resolveModel });
const secretFields = { apiKeyStdin: z.boolean().optional() };
const secretOptions: [string, string][] = [['--api-key-stdin', '从 stdin 读取 API key']];
const providerPayload = z.strictObject({ name: z.string().trim().min(1), type: z.enum(['ALIBABA', 'OPENAI', 'ANTHROPIC', 'GOOGLE', 'OPENAI_COMPATIBLE']), base_url: z.string().nullable().optional(), is_active: z.boolean().optional() });
define({ name: 'provider create', description: '创建用户供应商（复杂字段使用 --input）', effect: 'write', input: providerPayload.extend(secretFields), options: [['--name <name>', '供应商名称'], ['--type <type>', '供应商类型'], ...secretOptions], run: async (ctx, i) => {
  const body = { ...i }; delete body.apiKeyStdin;
  parse(modelsApi.createProvider.request, { ...body, api_key: '<validated-secret>' });
  const exists = (await (await ctx.api()).call(modelsApi.providers)).providers.filter(p => p.name === i.name); if (exists.length) invalid('同名用户供应商已存在。');
  return ctx.write(body, async () => {
    const api_key = await secretInput({ stdin: flag(i, 'apiKeyStdin') }, ctx.interactive, 'API key');
    await (await ctx.api()).call(modelsApi.createProvider, { ...body, api_key }); ctx.outcome = 'applied';
    return { created: true, provider: await ctx.verify(async () => resolveProvider(ctx, { name: i.name })) };
  });
} });
define({ name: 'provider update', description: '更新用户供应商；patch 使用 --input', effect: 'write', input: z.strictObject({ ...selection, patch: providerPayload.partial().default({}), ...secretFields }), options: [...selectionOptions, ...secretOptions], run: async (ctx, i) => {
  const provider = await resolveProvider(ctx, i); editableProvider(provider); const patch = i.patch as Record<string, unknown>;
  if (!Object.keys(patch).length && !i.apiKeyStdin) invalid('没有需要更新的字段；更新密钥可使用 --api-key-stdin。');
  const body = parse(modelsApi.updateProvider.request, { provider_id: provider.id, ...patch }) as Record<string, unknown>;
  return ctx.write(body, async () => { if (i.apiKeyStdin) body.api_key = await secretInput({ stdin: true }, ctx.interactive, 'API key'); await (await ctx.api()).call(modelsApi.updateProvider, body); return { providerId: provider.id, updated: true }; });
} });
define({ name: 'provider delete', description: '删除用户供应商；被绑定时由服务端拒绝', effect: 'write', input: z.strictObject(selection), options: selectionOptions, run: async (ctx, i) => { const p = await resolveProvider(ctx, i); editableProvider(p); return ctx.write({ provider_id: p.id }, async () => { await (await ctx.api()).call(modelsApi.deleteProvider, { provider_id: p.id }); return { deleted: true, providerId: p.id }; }, '删除用户供应商'); } });
const createFields = (modelsApi.createModel.request as z.ZodObject).shape;
define({ name: 'model create', description: '创建用户模型；参数使用 --input JSON', effect: 'write', input: z.strictObject(createFields), run: async (ctx, i) => {
  const body = parse(modelsApi.createModel.request, i); const client = await ctx.api();
  if ((await client.call(modelsApi.models, { model_scope: 'USER' })).models.some(m => m.display_name === i.display_name)) invalid('同名用户模型已存在。');
  return ctx.write(body, async () => { await client.call(modelsApi.createModel, body); ctx.outcome = 'applied'; return { created: true, model: await ctx.verify(async () => resolveModel(ctx, { name: i.display_name, scope: 'USER' })) }; });
} });
define({ name: 'model update', description: '更新用户模型；patch 使用 --input', effect: 'write', input: z.strictObject({ ...selection, patch: z.strictObject(createFields).partial().extend({ is_active: z.boolean().optional() }) }), options: selectionOptions, run: async (ctx, i) => {
  const model = await resolveModel(ctx, i); editableModel(model); const patch = i.patch as Record<string, unknown>; if (!Object.keys(patch).length) invalid('没有需要更新的字段。');
  const body = { ...patch, model_id: model.id }; return ctx.write(body, async () => { await (await ctx.api()).call(modelsApi.updateModel, body); return { updated: true, modelId: model.id }; });
} });
define({ name: 'model delete', description: '删除用户模型', effect: 'write', input: z.strictObject(selection), options: selectionOptions, run: async (ctx, i) => { const m = await resolveModel(ctx, i); editableModel(m); return ctx.write({ model_id: m.id }, async () => { await (await ctx.api()).call(modelsApi.deleteModel, { model_id: m.id }); return { deleted: true, modelId: m.id }; }, '删除用户模型'); } });
for (const action of ['bind', 'unbind'] as const) define({ name: `model ${action}`, description: action === 'bind' ? '为系统或用户模型绑定用户供应商' : '解除模型与供应商绑定', effect: 'write', input: z.strictObject({ ...selection, scope, provider: z.string().optional(), providerId: z.string().optional(), ...(action === 'bind' ? { providerModel: z.string().min(1), options: (modelsApi.bind.request as z.ZodObject).omit({ model_id: true, provider_id: true, provider_model_name: true }).default({}) } : {}) }), options: [...selectionOptions, ['--scope <scope>', 'USER 或 SYSTEM'], ['--provider <name>', '用户供应商名称'], ['--provider-id <id>', '用户供应商 ID'], ...(action === 'bind' ? [['--provider-model <name>', '供应商实际模型标识']] as [string, string][] : [])], run: async (ctx, i) => {
  const model = await resolveModel(ctx, i); const provider = await resolveProvider(ctx, { id: i.providerId, name: i.provider }); editableProvider(provider);
  const body = { model_id: model.id, provider_id: provider.id, ...(action === 'bind' ? { provider_model_name: i.providerModel, ...(i.options as Record<string, unknown>) } : {}) };
  return ctx.write(body, async () => { await (await ctx.api()).call(action === 'bind' ? modelsApi.bind : modelsApi.unbind, body); return { ...body, action }; }, action === 'unbind' ? '解除模型供应商绑定' : undefined);
} });
