import { z } from 'zod';
import { ApiClient } from '../client/http.js';
import { api } from '../contracts/api.js';
import { CliError, invalid } from '../errors.js';
import { assertServiceConfigured, clearCredential, saveCredential, withLock, setConfig, configKeys, configValue, loadSettings } from '../runtime/config.js';
import { prompt, secretInput } from '../runtime/io.js';
import { commands, define, optionalText, flag } from './registry.js';
import { globals } from '../runtime/context.js';

const none = z.strictObject({});
define({ name: 'config show', description: '查看服务地址、实际数据目录和配置来源', input: none, effect: 'read', run: async ctx => ctx.settings() });
define({ name: 'config set', description: '保存一项包配置；dataDir 相对路径以包目录为基准', input: z.strictObject({ key: z.enum(configKeys), value: z.string() }), options: [['--key <key>', 'apiUrl/webUrl/dataDir/maxOutputBytes'], ['--value <value>', '配置值']], effect: 'local', run: async (ctx, input) => {
  const key = input.key as typeof configKeys[number]; const value = configValue(key, String(input.value));
  return ctx.write({ key, value, packageRoot: ctx.packageRoot }, async () => {
    await setConfig(ctx.packageRoot, key, value);
    ctx.outcome = 'applied'; ctx.verification = 'local-write';
    // Another legacy setting may still need review. A successful local edit stays successful.
    const settings = await ctx.verify(() => loadSettings(ctx.options.dataDir, ctx.packageRoot));
    if (settings) ctx.settingsValue = settings;
    return { key, value, settings };
  });
} });
define({ name: 'login', description: '输入账号、密码，保存可供 agent 复用的会话令牌', effect: 'write', input: z.strictObject({ account: z.string().optional(), password: z.string().optional(), passwordStdin: z.boolean().optional() }), options: [['--account <account>', '账号'], ['--password <password>', '直接传入密码（会留在命令历史中）'], ['--password-stdin', '从 stdin 读取密码']], run: async (ctx, input) => {
  const settings = await ctx.settings(); assertServiceConfigured(settings);
  if (ctx.options.dryRun) return { dryRun: true, apiUrl: settings.apiUrl, dataDir: settings.dataDir, action: 'login-and-save-session' };
  const account = optionalText(input, 'account') || await prompt('账号', ctx.interactive);
  const password = await secretInput({ value: optionalText(input, 'password'), stdin: flag(input, 'passwordStdin') }, ctx.interactive, '密码');
  return ctx.write({ action: 'login', account }, async () => withLock(settings.dataDir, 'auth', async () => {
    const session = await new ApiClient(settings, ctx.options.timeout, ctx.signal).call(api.login, { account, password });
    ctx.outcome = 'applied';
    const authenticated = new ApiClient(settings, ctx.options.timeout, ctx.signal, session);
    try {
      const user = await authenticated.call(api.me);
      await saveCredential(settings, session, user.userId);
      return { user, apiUrl: settings.apiUrl, dataDir: settings.dataDir, storage: 'plaintext-file', passwordSaved: false };
    } catch (error) {
      throw new CliError('LOGIN_LOCAL_SAVE_FAILED', '服务端已登录，但身份查询或本地保存失败；此目录尚不能复用本次登录。', 9, { dataDir: settings.dataDir, reason: error instanceof CliError ? error.code : 'LOCAL_ERROR', ...(error instanceof CliError ? { cause: error.details } : {}) }, 'partial');
    }
  }));
} });
define({ name: 'logout', description: '仅清除当前数据目录的会话，其他副本仍可能有效', effect: 'local', input: none, run: async ctx => {
  const settings = await ctx.settings();
  return ctx.write({ dataDir: settings.dataDir, localOnly: true }, async () => withLock(settings.dataDir, 'auth', async () => { await clearCredential(settings); return { localCredentialsRemoved: true, serverSessionRevoked: false }; }));
} });
define({ name: 'auth status', description: '向服务端验证当前会话并显示身份', effect: 'read', input: none, run: async ctx => {
  const user = await (await ctx.api()).call(api.me);
  return { authenticated: true, user, storage: 'plaintext-file', independentDeviceSession: false };
} });
define({ name: 'auth revoke', description: '注销服务端共享会话，可能同时退出浏览器和其他副本', effect: 'write', input: none, run: async ctx => {
  const settings = await ctx.settings(); assertServiceConfigured(settings);
  return ctx.write({ dataDir: settings.dataDir, sharedSession: true }, async () => withLock(settings.dataDir, 'auth', async () => {
    await new ApiClient(settings, ctx.options.timeout, ctx.signal).call(api.logout);
    ctx.outcome = 'applied';
    try { await clearCredential(settings); }
    catch (error) { throw new CliError('LOCAL_CREDENTIAL_CLEANUP_FAILED', '服务端已注销，但本地凭据清理失败。', 9, { dataDir: settings.dataDir, reason: error instanceof CliError ? error.code : 'LOCAL_ERROR' }, 'partial'); }
    return { revoked: true };
  }), '注销服务端共享会话，浏览器及其他使用者可能同时退出');
} });
define({ name: 'schema', description: '列出命令，或查看一个命令的输入与输出约定', effect: 'read', input: z.strictObject({ command: z.string().optional() }), options: [['--command <command>', '例如 "resource show"']], run: async (_ctx, input) => {
  const selected = input.command ? commands.filter(c => c.name === input.command) : commands;
  if (!selected.length) invalid('未知命令。');
  if (!input.command) return { version: '0.2.0', commands: selected.map(c => ({ name: c.name, description: c.description, effect: c.effect })) };
  return { schemaVersion: '2', globals: z.toJSONSchema(globals.extend({ input: z.string().optional() }), { io: 'input' }), output: { schemaVersion: '2', command: 'string', ok: 'boolean', data: 'command-specific; null on failure', meta: { apiUrl: 'string|null', dataDir: 'string|null', operationId: 'UUID', outcome: 'not-started|applied|pending|partial|unknown', verification: 'string' }, warnings: 'string[]', error: 'null|{code,message,details,nextActions}' }, commands: selected.map(c => ({ name: c.name, description: c.description, effect: c.effect, input: z.toJSONSchema(c.input, { io: 'input' }) })) };
} });
