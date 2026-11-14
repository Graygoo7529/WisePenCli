import { z } from 'zod';
import { api, message } from '../contracts/api.js';
import { resolveSession } from '../domain/resolve.js';
import { CliError } from '../errors.js';
import { writeAtomic, scrub } from '../runtime/io.js';
import { define, text, number, flag, pagination, pageOptions } from './registry.js';
const select = { id: z.string().optional(), title: z.string().optional() };
const options: [string, string][] = [['--id <id>', '会话 ID'], ['--title <title>', '精确会话标题']];
define({ name: 'session list', description: '分页列出历史会话', effect: 'read', input: z.strictObject(pagination), options: pageOptions, run: async (ctx, i) => (await ctx.api()).call(api.sessions, i) });
define({ name: 'session history', description: '读取会话历史；分页单位为回合', effect: 'read', input: z.strictObject({ ...select, ...pagination }), options: [...options, ...pageOptions], run: async (ctx, i) => ({ paginationUnit: 'turn', newestPageFirst: true, history: await (await ctx.api()).call(api.history, { session_id: await resolveSession(ctx, i), page: i.page, size: i.size }) }) });
define({ name: 'session export', description: '按时间顺序导出完整历史（JSON/Markdown）', effect: 'local', input: z.strictObject({ ...select, output: z.string(), format: z.enum(['json', 'markdown']).default('json'), overwrite: z.boolean().default(false), maxPages: z.coerce.number().int().min(1).max(1000).default(100) }), options: [...options, ['--output <file>', '本地输出文件'], ['--format <format>', 'json 或 markdown'], ['--overwrite', '允许覆盖已有文件'], ['--max-pages <count>', '最大回合页数，默认 100']], run: async (ctx, i) => {
  const sessionId = await resolveSession(ctx, i); const client = await ctx.api();
  if (ctx.options.dryRun) return { dryRun: true, sessionId, output: i.output };
  const latest = await client.call(api.history, { session_id: sessionId, page: 1, size: 100 });
  if (latest.total_page > number(i, 'maxPages')) throw new CliError('EXPORT_LIMIT', '历史超过导出页数限制，未写入文件。', 6, { totalPages: latest.total_page });
  const pages: z.infer<typeof message>[][] = [latest.list];
  for (let page = 2; page <= latest.total_page; page++) {
    const next = await client.call(api.history, { session_id: sessionId, page, size: 100 });
    if (next.total !== latest.total || next.total_page !== latest.total_page) throw new CliError('HISTORY_CHANGED', '导出期间回合总数发生变化，未写入文件；请在会话稳定后重试。', 6);
    pages.push(next.list);
  }
  const seen = new Set<string>();
  const messages = pages.reverse().flat().filter(m => { if (seen.has(m.id)) return false; seen.add(m.id); return true; });
  ctx.warnings.push('会话历史没有服务端快照事务；最新回合可能仍在生成。工具调用仅作为数据导出，不执行。');
  const exported = scrub({ sessionId, exportedAt: new Date().toISOString(), paginationUnit: 'turn', totalTurns: latest.total, messages });
  const content = i.format === 'json' ? JSON.stringify(exported, null, 2) : `# 会话 ${sessionId}\n\n` + messages.map(m => `## ${m.role} · ${m.id}\n\n` + m.parts.map(part => typeof part.text === 'string' ? part.text : `工具/扩展数据：\n\n\`\`\`json\n${JSON.stringify(scrub(part), null, 2).replace(/`/g, '\\u0060')}\n\`\`\``).join('\n\n')).join('\n\n');
  return ctx.write({ sessionId, output: i.output }, async () => ({ sessionId, output: await writeAtomic(text(i, 'output'), String(scrub(content)), flag(i, 'overwrite')), messageCount: messages.length, totalTurns: latest.total }));
} });
define({ name: 'session rename', description: '重命名已有会话', effect: 'write', input: z.strictObject({ ...select, name: z.string().trim().min(1) }), options: [...options, ['--name <title>', '新标题']], run: async (ctx, i) => {
  const body = { session_id: await resolveSession(ctx, i), new_title: i.name }; return ctx.write(body, async () => (await ctx.api()).call(api.renameSession, body));
} });
define({ name: 'session delete', description: '删除已有会话及历史', effect: 'write', input: z.strictObject(select), options, run: async (ctx, i) => {
  const session_id = await resolveSession(ctx, i); return ctx.write({ session_id }, async () => { await (await ctx.api()).call(api.deleteSession, { session_id }); return { sessionId: session_id, deleted: true }; }, '删除会话及其历史');
} });
