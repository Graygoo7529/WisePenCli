import { readFile, mkdir, readdir, unlink } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { ensureDataDir, fileError, writeState } from '../runtime/config.js';
import { commitFile } from '../runtime/io.js';
import type { Context } from '../runtime/context.js';
import { CliError, invalid } from '../errors.js';
import { api } from '../contracts/api.js';

export function transferUrl(raw: string): URL {
  let url: URL; try { url = new URL(raw); } catch { throw new CliError('INVALID_TRANSFER_URL', '传输地址不是合法 URL。', 8); }
  if (url.username || url.password || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) throw new CliError('INVALID_TRANSFER_URL', '传输地址必须为 HTTPS，或本机 HTTP。', 8);
  return url;
}
export async function saveTask(ctx: Context, documentId: string, state: Record<string, unknown>): Promise<void> {
  const settings = await ctx.settings();
  if (!/^[a-zA-Z0-9_-]+$/.test(documentId)) throw new CliError('INVALID_RESPONSE', '文档任务 ID 格式异常。', 8);
  await ensureDataDir(settings.dataDir);
  const scope = createHash('sha256').update(JSON.stringify([settings.apiUrl, state.userId])).digest('hex');
  await writeState(join(settings.dataDir, 'tasks', scope, `${documentId}.json`), { ...state, apiUrl: settings.apiUrl, operationId: ctx.operationId, documentId, updatedAt: new Date().toISOString() });
}
export async function listTasks(ctx: Context): Promise<unknown[]> {
  const settings = await ctx.settings(); const dir = join(settings.dataDir, 'tasks');
  const actor = await (await ctx.api()).call(api.me);
  let scopes; try { scopes = await readdir(dir, { withFileTypes: true }); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; fileError(error, dir, 'list-tasks'); }
  const tasks = new Map<string, { apiUrl: string; userId: string; documentId: string; updatedAt?: string }>();
  for (const scope of scopes.filter(item => item.isDirectory())) {
    const directory = join(dir, scope.name); let files;
    try { files = await readdir(directory, { withFileTypes: true }); } catch (error) { fileError(error, directory, 'list-tasks'); }
    for (const file of files.filter(item => item.isFile() && item.name.endsWith('.json'))) {
      const path = join(directory, file.name); let raw;
      try { raw = await readFile(path, 'utf8'); } catch (error) { fileError(error, path, 'read-task'); }
      let task;
      try { task = JSON.parse(raw) as { apiUrl: string; userId: string; documentId: string; updatedAt?: string }; if (!task || typeof task.documentId !== 'string') throw new Error(); }
      catch { throw new CliError('TASK_JOURNAL_INVALID', '本地任务记录格式无效。', 6, { path }); }
      if (task.apiUrl !== settings.apiUrl || task.userId !== actor.userId) continue;
      const previous = tasks.get(task.documentId);
      if (!previous || (task.updatedAt ?? '') > (previous.updatedAt ?? '')) tasks.set(task.documentId, task);
    }
  }
  return [...tasks.values()];
}
export async function download(ctx: Context, resourceId: string, output: string, overwrite: boolean, type: string): Promise<unknown> {
  const client = await ctx.api(); let url = client.url('/document/download', { resourceId, downloadType: type });
  let headers: Record<string, string> = await client.authHeaders();
  let response: Response | undefined;
  for (let redirects = 0; redirects <= 5; redirects++) {
    try { response = await fetch(url, { headers, redirect: 'manual', signal: AbortSignal.any([ctx.signal, AbortSignal.timeout(ctx.options.timeout)]) }); }
    catch { throw new CliError('NETWORK_ERROR', '下载连接失败。', ctx.signal.aborted ? 130 : 7); }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location'); await response.body?.cancel();
      if (!location) throw new CliError('INVALID_RESPONSE', '下载重定向缺少 Location。', 8);
      const next = transferUrl(new URL(location, url).toString());
      if (next.origin !== url.origin) headers = {}; // Never restore credentials after leaving the gateway.
      url = next; response = undefined; continue;
    }
    break;
  }
  if (!response) throw new CliError('TOO_MANY_REDIRECTS', '下载重定向次数过多。', 8);
  if (!response.ok) { await response.body?.cancel(); const authenticated = !!headers.authorization; throw new CliError(authenticated && response.status === 401 ? 'LOGIN_REQUIRED' : authenticated && response.status === 403 ? 'PERMISSION_DENIED' : 'DOWNLOAD_REJECTED', `下载失败（HTTP ${response.status}）。`, authenticated && response.status === 401 ? 3 : authenticated && response.status === 403 ? 4 : response.status === 404 ? 5 : 8); }
  if (response.headers.get('content-type')?.includes('json')) { await response.body?.cancel(); throw new CliError('DOWNLOAD_NOT_FILE', '下载返回 JSON，未将错误响应保存为文件。', 8); }
  if (!response.body) throw new CliError('INVALID_RESPONSE', '下载响应无文件内容。', 8);
  const target = resolve(output); await mkdir(dirname(target), { recursive: true }); const temp = `${target}.${randomUUID()}.tmp`;
  try {
    await pipeline(Readable.fromWeb(response.body as never), createWriteStream(temp, { flags: 'wx', mode: 0o600 }), { signal: AbortSignal.any([ctx.signal, AbortSignal.timeout(ctx.options.timeout)]) });
    await commitFile(temp, target, overwrite); return { resourceId, output: target, downloadType: type };
  } catch (error) { if (error instanceof CliError) throw error; if (ctx.signal.aborted) throw new CliError('CANCELED', '下载已中断，未替换目标文件。', 130); throw new CliError('DOWNLOAD_FAILED', '下载或本地文件保存失败，未替换目标文件。', 7); }
  finally { await unlink(temp).catch(() => undefined); }
}
export function requireDocumentId(input: Record<string, unknown>): string { if (!input.documentId) invalid('需要 --document-id（上传任务 ID，不是 resourceId）。'); return String(input.documentId); }
