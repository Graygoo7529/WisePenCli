import { createInterface } from 'node:readline/promises';
import { readFile, rename, unlink, mkdir, link, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { StringDecoder } from 'node:string_decoder';
import { z } from 'zod';
import { CliError, invalid } from '../errors.js';

let stdinClaimed = false;
const secrets = new Set<string>();
export function registerSecret(value: string): string { if (value) secrets.add(value); return value; }
export function scrub(value: unknown): unknown {
  if (typeof value === 'string') {
    let text = value.replace(/https?:\/\/[^\s"<>]+[?][^\s"<>]+/gi, url => /[?&](authorization|token|signature|x-oss-signature|x-amz-signature|ossaccesskeyid|access_token)=/i.test(url) ? '[签名 URL 已隐藏]' : url);
    for (const secret of secrets) text = text.split(secret).join('[REDACTED]');
    return text;
  }
  if (Array.isArray(value)) return value.map(scrub);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key, /^(api_?key|password|authorization|token|put_?url|callback_?header)$/i.test(key) ? '[REDACTED]' : scrub(item),
  ]));
  return value;
}
export async function stdinText(): Promise<string> {
  if (stdinClaimed) invalid('stdin 已被其他输入占用。');
  stdinClaimed = true;
  let content = '';
  for await (const part of process.stdin) {
    content += String(part);
    if (Buffer.byteLength(content) > 16 * 1024 * 1024) invalid('stdin 超过 16 MiB。');
  }
  return content;
}
export async function readInput(path: string): Promise<unknown> {
  const text = path === '-' ? await stdinText() : await readFile(path, 'utf8');
  try { return JSON.parse(text.replace(/^\uFEFF/, '')); } catch { invalid('输入必须是 UTF-8 JSON。'); }
}
export function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) invalid('输入字段不符合要求。', { issues: result.error.issues.map(i => ({ path: i.path, code: i.code })) });
  return result.data;
}
export async function prompt(label: string, interactive: boolean, hidden = false): Promise<string> {
  if (!interactive || !process.stdin.isTTY || !process.stderr.isTTY) invalid(`需要 ${label}；非交互调用请提供命令参数或 stdin。`);
  if (!hidden) {
    const rl = createInterface({ input: process.stdin, output: process.stderr });
    const controller = new AbortController();
    const cancel = () => controller.abort();
    rl.once('SIGINT', cancel); rl.once('close', cancel); process.once('SIGINT', cancel);
    try { return (await rl.question(`${label}: `, { signal: controller.signal })).trim(); }
    catch (error) { if (controller.signal.aborted) throw new CliError('CANCELED', '已取消。', 130); throw error; }
    finally { process.off('SIGINT', cancel); rl.off('close', cancel); rl.close(); }
  }
  process.stderr.write(`${label}: `);
  return new Promise<string>((resolveSecret, reject) => {
    let value = '';
    const decoder = new StringDecoder('utf8');
    const previous = process.stdin.isRaw;
    process.stdin.setRawMode(true);
    process.stdin.resume();
    const cleanup = () => { process.stdin.off('data', receive); process.stdin.off('end', cancel); process.off('SIGINT', cancel); process.stdin.setRawMode(previous); process.stdin.pause(); process.stderr.write('\n'); };
    const cancel = () => { cleanup(); reject(new CliError('CANCELED', '已取消。', 130)); };
    const receive = (data: Buffer) => {
      for (const char of decoder.write(data)) {
        if (char === '\r' || char === '\n') { cleanup(); resolveSecret(value); return; }
        if (char === '\u0003' || char === '\u0004') { cancel(); return; }
        if (char === '\u007f' || char === '\b') value = Array.from(value).slice(0, -1).join('');
        else if (char >= ' ') value += char;
      }
    };
    process.stdin.on('data', receive);
    process.stdin.once('end', cancel); process.once('SIGINT', cancel);
  });
}
export async function secretInput(options: { value?: string; stdin?: boolean }, interactive: boolean, label: string): Promise<string> {
  if (options.value !== undefined && options.stdin) invalid('密码参数与 stdin 不可同时指定。');
  const value = options.value !== undefined ? options.value : options.stdin ? (await stdinText()).replace(/[\r\n]+$/, '') : await prompt(label, interactive, true);
  if (!value) invalid(`${label}不能为空。`);
  return registerSecret(value);
}
export async function confirm(message: string, yes: boolean, interactive: boolean): Promise<void> {
  if (yes) return;
  if (!interactive) invalid('该操作需要显式 --yes。', { impact: message });
  const answer = await prompt(`${message}\n输入 yes 确认`, interactive);
  if (answer !== 'yes') throw new CliError('CANCELED', '未确认，操作已取消。', 130);
}
export async function writeAtomic(path: string, content: string, overwrite = false): Promise<string> {
  const target = resolve(path);
  await mkdir(dirname(target), { recursive: true });
  const temp = `${target}.${randomUUID()}.tmp`;
  try { await writeFile(temp, content, { mode: 0o600, flag: 'wx' }); await commitFile(temp, target, overwrite); }
  finally { await unlink(temp).catch(() => undefined); }
  return target;
}
export async function commitFile(temp: string, target: string, overwrite: boolean): Promise<void> {
  try { if (overwrite) await rename(temp, target); else await link(temp, target); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new CliError('OUTPUT_EXISTS', '目标文件已存在；使用 --overwrite 明确覆盖。', 6); throw error; }
}
