import { readFile, mkdir, open, unlink, rename, writeFile, stat, chmod } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import { CliError, invalid } from '../errors.js';
import { registerSecret } from './io.js';
import { localPath } from './paths.js';

export const PACKAGE_ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const DEFAULT_API_URL = 'https://api.wisepen.oriole.cn';
export const DEFAULT_WEB_URL = 'https://wisepen.oriole.cn';
export const DEFAULT_OUTPUT_BYTES = 1048576;
export const ConfigSchema = z.strictObject({
  version: z.literal(1).default(1), apiUrl: z.string().optional(), webUrl: z.string().optional(),
  dataDir: z.string().min(1).optional(), maxOutputBytes: z.number().int().min(1024).max(16777216).optional(),
});
export type RuntimeSettings = {
  packageRoot: string; configFile: string; apiUrl: string; webUrl: string; dataDir: string;
  dataDirSource: 'argument' | 'config' | 'default'; maxOutputBytes: number;
  legacyServices: { name: string; apiUrl: string; webUrl?: string }[];
};
export const configKeys = ['apiUrl', 'webUrl', 'dataDir', 'maxOutputBytes'] as const;
export type ConfigKey = typeof configKeys[number];

export function normalizeUrl(text: string): string {
  let url: URL;
  try { url = new URL(text); } catch { invalid('服务地址不是有效 URL。'); }
  if (url.username || url.password || url.search || url.hash) invalid('服务地址不能包含凭据、查询参数或 fragment。');
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) invalid('服务地址必须是 HTTPS；仅 loopback 本地开发允许 HTTP。');
  return url.toString().replace(/\/+$/, '');
}
export function fileError(error: unknown, path: string, operation: string, config = false): never {
  const code = (error as NodeJS.ErrnoException).code;
  if (['EACCES', 'EPERM', 'EROFS'].includes(code ?? '')) throw new CliError(config ? 'CONFIG_ACCESS_DENIED' : 'DATA_DIR_ACCESS_DENIED', '无法访问文件，请由目录所有者检查共享目录的读写权限。', 6, { path, operation });
  if (error instanceof CliError) throw error;
  throw new CliError(config ? 'CONFIG_IO_ERROR' : 'DATA_IO_ERROR', '本地文件操作失败。', 6, { path, operation, reason: code ?? 'IO_ERROR' });
}
async function readConfig(root: string): Promise<z.infer<typeof ConfigSchema>> {
  const path = join(root, 'wisepen.json'); let raw: string;
  try { raw = await readFile(path, 'utf8'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1 }; fileError(error, path, 'read-config', true); }
  try { return ConfigSchema.parse(JSON.parse(raw.replace(/^\uFEFF/, ''))); }
  catch { throw new CliError('CONFIG_INVALID', '请检查包目录中的 wisepen.json 格式。', 2, { path }); }
}
export async function loadSettings(dataOverride?: string, root = PACKAGE_ROOT): Promise<RuntimeSettings> {
  const config = await readConfig(root);
  const dataDir = dataOverride ? resolve(localPath(dataOverride)) : resolve(root, config.dataDir ?? './data');
  const legacyServices: RuntimeSettings['legacyServices'] = [];
  if (!config.apiUrl) {
    const path = join(dataDir, 'config.json'); let raw: string | undefined;
    try { raw = await readFile(path, 'utf8'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') fileError(error, path, 'read-legacy-config'); }
    if (raw) {
      try {
        const old = z.object({ profiles: z.record(z.string(), z.object({ apiUrl: z.string(), webUrl: z.string().optional() })) }).parse(JSON.parse(raw));
        for (const [name, service] of Object.entries(old.profiles)) {
          const apiUrl = normalizeUrl(service.apiUrl);
          if (apiUrl !== DEFAULT_API_URL) legacyServices.push({ name, apiUrl, ...(service.webUrl ? { webUrl: normalizeUrl(service.webUrl) } : {}) });
        }
      } catch { throw new CliError('LEGACY_CONFIG_INVALID', '旧配置无法识别。请在包目录 wisepen.json 中明确设置 apiUrl 后再登录；旧数据无需删除。', 2, { path }); }
    }
  }
  return { packageRoot: root, configFile: join(root, 'wisepen.json'), apiUrl: normalizeUrl(config.apiUrl ?? DEFAULT_API_URL), webUrl: normalizeUrl(config.webUrl ?? DEFAULT_WEB_URL), dataDir, dataDirSource: dataOverride ? 'argument' : config.dataDir ? 'config' : 'default', maxOutputBytes: config.maxOutputBytes ?? DEFAULT_OUTPUT_BYTES, legacyServices };
}
export function assertServiceConfigured(settings: RuntimeSettings): void {
  if (settings.legacyServices.length) throw new CliError('LEGACY_CONFIG_REVIEW_REQUIRED', '发现旧版自定义服务。请先用 config set --key apiUrl --value <地址> 明确选择服务，再 login；旧配置和凭据保留。', 2, { configFile: settings.configFile, services: settings.legacyServices });
}
export async function ensureDataDir(path: string): Promise<void> {
  try { await mkdir(path, { recursive: true, mode: 0o700 }); }
  catch (error) { fileError(error, path, 'create-data-directory'); }
}
// Share via directory ACLs; temporary files inherit those ACLs. On POSIX,
// replacements also retain existing mode bits rather than forcing owner-only access.
export async function writeState(path: string, value: unknown, config = false): Promise<void> {
  const temp = join(dirname(path), `.${randomUUID()}.tmp`);
  try {
    await mkdir(dirname(path), { recursive: true });
    let mode: number | undefined;
    try { mode = (await stat(path)).mode & 0o777; } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    await writeFile(temp, JSON.stringify(value, null, 2) + '\n', { mode: mode ?? 0o666, flag: 'wx' });
    if (mode !== undefined && process.platform !== 'win32') await chmod(temp, mode);
    await rename(temp, path);
  } catch (error) { fileError(error, path, 'write', config); }
  finally { await unlink(temp).catch(() => undefined); }
}
export async function withLock<T>(directory: string, key: string, fn: () => Promise<T>, config = false): Promise<T> {
  await ensureDataDir(directory);
  const path = join(directory, `${key}.lock`);
  let lock;
  for (let attempt = 0; attempt < 11; attempt++) {
    try { lock = await open(path, 'wx', 0o666); break; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') fileError(error, path, 'lock', config);
      if (attempt === 10) throw new CliError('DATA_BUSY', '目录正被另一进程使用；若进程异常退出，确认无使用者后删除此锁文件再试。', 6, { path });
      await delay(50);
    }
  }
  if (!lock) throw new CliError('DATA_BUSY', '无法取得目录锁。', 6, { path });
  try { await lock.writeFile(String(process.pid)); return await fn(); }
  finally { await lock.close(); await unlink(path).catch(() => undefined); }
}
export function configValue(key: ConfigKey, value: string): string | number {
  if (key === 'apiUrl' || key === 'webUrl') return normalizeUrl(value);
  if (key === 'dataDir') { if (!value.trim() || value.includes('\0')) invalid('数据目录不能为空或包含 NUL。'); return localPath(value); }
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1024 || number > 16777216) invalid('maxOutputBytes 必须在 1024 到 16777216 之间。');
  return number;
}
export async function setConfig(root: string, key: ConfigKey, value: string | number): Promise<void> {
  await withLock(root, 'config', async () => {
    const config = await readConfig(root);
    await writeState(join(root, 'wisepen.json'), { ...config, [key]: value }, true);
  }, true);
}
const AuthSchema = z.strictObject({ version: z.literal(1), apiUrl: z.string(), userId: z.string().min(1), token: z.string().min(1), loggedInAt: z.string() });
export async function saveCredential(settings: RuntimeSettings, token: string, userId: string): Promise<void> {
  await writeState(join(settings.dataDir, 'auth.json'), { version: 1, apiUrl: settings.apiUrl, userId, token: registerSecret(token), loggedInAt: new Date().toISOString() });
}
export async function clearCredential(settings: RuntimeSettings): Promise<void> {
  const path = join(settings.dataDir, 'auth.json');
  try { await unlink(path); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') fileError(error, path, 'logout'); }
}
export async function credential(settings: RuntimeSettings): Promise<z.infer<typeof AuthSchema>> {
  const path = join(settings.dataDir, 'auth.json'); let raw: string;
  try { raw = await readFile(path, 'utf8'); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new CliError('LOGIN_REQUIRED', '请运行 login；从旧版升级后需首次重新登录，旧凭据文件无需删除。', 3);
    fileError(error, path, 'read-session');
  }
  let saved: z.infer<typeof AuthSchema>;
  try { saved = AuthSchema.parse(JSON.parse(raw)); }
  catch { throw new CliError('CREDENTIAL_INVALID', 'auth.json 格式无效，请重新 login 替换。', 3, { path }); }
  if (saved.apiUrl !== settings.apiUrl) throw new CliError('LOGIN_REQUIRED', '服务地址已更改，请在此数据目录重新登录。', 3);
  registerSecret(saved.token);
  return saved;
}
