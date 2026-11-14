import { z } from 'zod';
import { readFile, stat } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { api, documentExtensions } from '../contracts/api.js';
import { folder, destination, resolveGroup, resolveResource } from '../domain/resolve.js';
import { transferUrl, saveTask, listTasks, download, requireDocumentId } from '../domain/transfers.js';
import { CliError, invalid } from '../errors.js';
import { parse } from '../runtime/io.js';
import { define, text, number, flag, selector, selectorOptions } from './registry.js';

define({ name: 'doc upload', description: '上传文档到个人或小组目录，返回独立文档任务 ID', effect: 'write', input: z.strictObject({ file: z.string(), to: z.string().default('/'), group: z.string().optional(), groupId: z.string().optional() }), options: [['--file <file>', '本地文档路径（PDF、DOC/DOCX、PPT/PPTX、XLS/XLSX，最大 100 MiB）'], ['--to <path>', '远端目标目录，默认 /'], ['--group <name>', '目标小组精确名称'], ['--group-id <id>', '目标小组 ID']], run: async (ctx, i) => {
  const file = text(i, 'file'); const info = await stat(file); if (!info.isFile() || info.size < 1 || info.size > 104857600) invalid('仅支持 1 字节至 100 MiB 的普通文档文件。');
  const content = await readFile(file); if (content.length > 104857600) invalid('文件超过 100 MiB。');
  const md5 = createHash('md5').update(content).digest('hex'); const extension = extname(file).slice(1).toLowerCase();
  if (!(documentExtensions as readonly string[]).includes(extension)) invalid(`不支持的文档格式 .${extension || '(无扩展名)'}`, { extension, supportedExtensions: documentExtensions.map(value => `.${value}`) });
  const groupId = await resolveGroup(ctx, i);
  const targetFolder = await folder(ctx, text(i, 'to'), groupId);
  const mountTargetTagId = destination(targetFolder);
  const body = parse(api.upload.request, { filename: basename(file), extension, md5, expectedSize: content.length, mountTargetTagId });
  const actor = await (await ctx.api()).call(api.me);
  return ctx.write({ ...body as object, file }, async () => {
    const task = await (await ctx.api()).call(api.upload, body); ctx.outcome = 'pending';
    const state = { userId: actor.userId, filename: basename(file), md5, size: content.length, targetTagId: mountTargetTagId, groupId, stage: 'registered' };
    try { await saveTask(ctx, task.documentId, state); }
    catch { throw new CliError('TASK_JOURNAL_FAILED', '任务已创建，但本地记录保存失败；请保存 documentId 并查询任务。', 9, { documentId: task.documentId }, 'partial'); }
    if (!task.flashUploaded) {
      if (!task.putUrl) throw new CliError('UPLOAD_URL_MISSING', '任务已创建但响应缺少上传地址。', 9, { documentId: task.documentId }, 'partial');
      try {
        const response = await fetch(transferUrl(task.putUrl), { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream', ...(task.callbackHeader ? { 'x-oss-callback': task.callbackHeader } : {}) }, body: content, redirect: 'manual', signal: AbortSignal.any([ctx.signal, AbortSignal.timeout(ctx.options.timeout)]) });
        await response.body?.cancel();
        if (!response.ok) throw new Error('PUT failed');
      } catch { throw new CliError('UPLOAD_OUTCOME_UNKNOWN', '上传任务已创建，文件传输未获得成功确认；请查询该任务，不要重新创建上传。', ctx.signal.aborted ? 130 : 11, { documentId: task.documentId }, 'unknown'); }
    }
    await saveTask(ctx, task.documentId, { ...state, stage: task.flashUploaded ? 'flash-uploaded' : 'transferred' }).catch(() => { ctx.warnings.push('传输已完成，本地任务记录更新失败；使用返回的 documentId 继续查询。'); });
    // ctx.write acknowledges submission; pending describes processing after transfer.
    return { documentId: task.documentId, resourceId: null, flashUploaded: task.flashUploaded, processing: 'pending', target: { groupId: targetFolder.groupId ?? null, path: targetFolder.path }, next: `wisepen doc wait --document-id ${task.documentId}` };
  }).then(result => { if (!ctx.options.dryRun) ctx.outcome = 'pending'; return result; });
} });
define({ name: 'doc tasks', description: '列出数据目录中当前服务和账号的上传任务', effect: 'read', input: z.strictObject({}), run: listTasks });
define({ name: 'doc pending', description: '查询服务端当前可见的未完成文档任务', effect: 'read', input: z.strictObject({}), run: async ctx => (await ctx.api()).call(api.pending) });
define({ name: 'doc status', description: '只读查询文档任务或资源状态', effect: 'read', input: z.strictObject({ documentId: z.string().optional(), resourceId: z.string().optional() }), options: [['--document-id <id>', '文档任务 ID'], ['--resource-id <id>', '已注册的资源 ID']], run: async (ctx, i) => {
  if (!!i.documentId === !!i.resourceId) invalid('请指定 --document-id 或 --resource-id 其中之一。');
  const client = await ctx.api(); if (i.resourceId) return client.call(api.docInfo, { resourceId: i.resourceId });
  const list = await client.call(api.pending); const item = list.find(d => d.documentId === i.documentId);
  return item ?? { documentId: i.documentId, status: 'UNKNOWN', reason: '任务不在 pending 列表中，不能据此判断 READY 或不存在；使用 doc refresh 显式刷新。' };
} });
for (const action of ['refresh', 'retry', 'cancel'] as const) define({ name: `doc ${action}`, description: ({ refresh: '刷新并可能推进文档处理', retry: '显式重试失败文档处理', cancel: '取消文档处理并清理任务' })[action], effect: 'write', input: z.strictObject({ documentId: z.string() }), options: [['--document-id <id>', '文档任务 ID']], run: async (ctx, i) => {
  const documentId = requireDocumentId(i); const client = await ctx.api();
  if (action !== 'refresh') {
    const task = (await client.call(api.pending)).find(t => t.documentId === documentId);
    if (!task) invalid('任务不在可操作 pending 列表中；先使用 doc refresh 核实状态。');
    const s = task.documentStatus.status;
    if (action === 'cancel' && ['READY', 'CONVERTING_AND_PARSING'].includes(s)) invalid('该状态禁止取消。');
    if (action === 'retry' && !['FAILED', 'REGISTERING_RES_TIMEOUT'].includes(s)) invalid('仅可重试 FAILED 或 REGISTERING_RES_TIMEOUT；传输超时不能直接重试处理。');
  }
  return ctx.write({ documentId, action }, async () => { if (action === 'refresh') return client.call(api.refresh, { documentId }); await client.call(action === 'retry' ? api.retryDoc : api.cancelDoc, { documentId }); return { documentId, action }; }, action === 'cancel' ? '取消并清理文档任务及其上传数据' : undefined);
} });
define({ name: 'doc wait', description: '持续刷新直到处理完成；此命令可能推进后端处理', effect: 'write', input: z.strictObject({ documentId: z.string(), maxWait: z.coerce.number().int().min(1).max(86400).default(300) }), options: [['--document-id <id>', '文档任务 ID'], ['--max-wait <seconds>', '总等待秒数，默认 300']], run: async (ctx, i) => {
  const documentId = requireDocumentId(i); if (ctx.options.dryRun) return { dryRun: true, documentId, action: 'refresh-until-ready' };
  const deadline = Date.now() + number(i, 'maxWait') * 1000; const client = await ctx.api(); let last: unknown;
  while (Date.now() < deadline) {
    try { last = await client.call(api.refresh, { documentId }); } catch (error) { if (error instanceof CliError) throw new CliError(error.code, error.message, error.exitCode, { ...error.details, documentId, lastStatus: last }, error.outcome); throw error; }
    ctx.outcome = 'pending'; const current = last as { status: string };
    if (current.status === 'READY') { ctx.outcome = 'applied'; ctx.verification = 'server-acknowledged'; return { documentId, resourceId: null, ...current }; }
    if (['FAILED', 'TRANSFER_TIMEOUT', 'REGISTERING_RES_TIMEOUT'].includes(current.status)) throw new CliError('DOCUMENT_PROCESSING_FAILED', '文档处理失败或超时。', 8, { documentId, lastStatus: last }, 'partial');
    try { await delay(Math.min(2000, Math.max(1, deadline - Date.now())), undefined, { signal: ctx.signal }); }
    catch { throw new CliError('CANCELED', '已停止等待；服务端任务继续运行。', 130, { documentId, lastStatus: last }, 'pending'); }
  }
  throw new CliError('WAIT_TIMEOUT', '等待超时；服务端任务继续运行。', 124, { documentId, lastStatus: last }, 'pending');
} });
define({ name: 'doc download', description: '下载文档，原子保存并保护已有文件', effect: 'local', input: z.strictObject({ ...selector, output: z.string(), type: z.enum(['ORIGINAL', 'WATERMARK']).default('ORIGINAL'), overwrite: z.boolean().default(false) }), options: [...selectorOptions, ['--output <file>', '本地目标文件'], ['--type <type>', 'ORIGINAL 或 WATERMARK'], ['--overwrite', '允许覆盖目标文件']], run: async (ctx, i) => {
  const r = await resolveResource(ctx, i); const id = r.resource.resourceId;
  if (!['PDF', 'DOC', 'DOCX', 'PPT', 'PPTX', 'XLS', 'XLSX'].includes(r.resource.resourceType)) invalid('所选资源不是受支持的文档类型。');
  return ctx.write({ resourceId: id, output: i.output }, async () => download(ctx, id, text(i, 'output'), flag(i, 'overwrite'), text(i, 'type')));
} });
