import { z } from 'zod';
import { api } from '../contracts/api.js';
import { destination, folder, resolveResource } from '../domain/resolve.js';
import { readNote } from '../domain/note-reader.js';
import { invalid, unavailable } from '../errors.js';
import { writeAtomic } from '../runtime/io.js';
import { define, text, flag, selector, selectorOptions, pagination, pageOptions } from './registry.js';
define({ name: 'note create', description: '创建空白普通笔记', effect: 'write', input: z.strictObject({ title: z.string().trim().min(1), to: z.string().default('/') }), options: [['--title <title>', '笔记标题'], ['--to <path>', '个人目录']], run: async (ctx, i) => {
  const body = { title: i.title, resourceType: 'NOTE', mountTargetTagId: destination(await folder(ctx, text(i, 'to'))) };
  return ctx.write(body, async () => ({ resourceId: await (await ctx.api()).call(api.noteCreate, body), title: i.title }));
} });
for (const action of ['show', 'versions', 'fork'] as const) define({ name: `note ${action}`, description: ({ show: '查看笔记元信息', versions: '查看已保存版本列表', fork: '复制笔记为独立资源' })[action], effect: action === 'fork' ? 'write' : 'read', input: z.strictObject({ ...selector, ...(action === 'versions' ? pagination : {}), ...(action === 'fork' ? { name: z.string().optional(), version: z.coerce.number().int().positive().optional() } : {}) }), options: [...selectorOptions, ...(action === 'versions' ? pageOptions : []), ...(action === 'fork' ? [['--name <name>', '复制后的标题'], ['--version <version>', '指定已保存版本']] as [string, string][] : [])], run: async (ctx, i) => {
  const selected = await resolveResource(ctx, i); if (selected.resource.resourceType !== 'NOTE') invalid('此命令仅支持普通 NOTE 笔记。');
  const resourceId = selected.resource.resourceId; const client = await ctx.api();
  if (action === 'show') return client.call(api.noteInfo, { resourceId });
  if (action === 'versions') return client.call(api.noteVersions, { resourceId, page: i.page, size: i.size });
  const body = { resourceId, forkedResourceName: i.name, forkedResourceVersion: i.version }; return ctx.write(body, async () => ({ resourceId: await client.call(api.noteFork, body), sourceResourceId: resourceId }));
} });
for (const action of ['read', 'export'] as const) define({ name: `note ${action}`, description: '实验性只读 Yjs 内容快照；无持久化版本保证', effect: 'experimental', input: z.strictObject({ ...selector, experimental: z.boolean().default(false), format: z.enum(['json', 'xml', 'text', 'markdown']).default('json'), ...(action === 'export' ? { output: z.string(), overwrite: z.boolean().default(false) } : {}) }), options: [...selectorOptions, ['--experimental', '明确启用协同协议读取实验'], ['--format <format>', 'json/xml/text/markdown'], ...(action === 'export' ? [['--output <file>', '本地输出文件'], ['--overwrite', '允许覆盖文件']] as [string, string][] : [])], run: async (ctx, i) => {
  if (!i.experimental) unavailable('正文读取仍在协议实验阶段，请显式使用 --experimental；生产协同服务尚未完成端到端验证。');
  const selected = await resolveResource(ctx, i); if (selected.resource.resourceType !== 'NOTE') invalid('仅支持普通 NOTE 笔记。');
  const resourceId = selected.resource.resourceId;
  if (action === 'export' && ctx.options.dryRun) return { dryRun: true, resourceId, output: i.output };
  const snapshot = await readNote(ctx, resourceId);
  ctx.warnings.push('这是协同内存快照，不代表数据库持久化版本；结构内可能含待审核的 AI 建议。文本/Markdown 仅作有损阅读投影，不能无损导入。');
  const content = i.format === 'json' ? snapshot.tree : i.format === 'xml' ? snapshot.xml : snapshot.text;
  if (action === 'read') return { resourceId, format: i.format, content, consistency: snapshot.consistency, snapshotAt: snapshot.snapshotAt, lossy: i.format === 'text' || i.format === 'markdown' };
  return ctx.write({ resourceId, output: i.output }, async () => ({ resourceId, output: await writeAtomic(text(i, 'output'), i.format === 'json' ? JSON.stringify({ resourceId, ...snapshot }, null, 2) : String(content), flag(i, 'overwrite')), consistency: snapshot.consistency }));
} });
