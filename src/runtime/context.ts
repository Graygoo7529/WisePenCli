import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ApiClient } from '../client/http.js';
import { loadSettings, assertServiceConfigured, PACKAGE_ROOT, type RuntimeSettings } from './config.js';
import { confirm } from './io.js';
import { CliError, type Outcome } from '../errors.js';

export const globals = z.object({ json: z.boolean().default(false), dataDir: z.string().min(1).optional(), yes: z.boolean().default(false), dryRun: z.boolean().default(false), timeout: z.coerce.number().int().min(100).max(300000).default(30000) });
export class Context {
  readonly operationId = randomUUID();
  readonly warnings: string[] = [];
  outcome: Outcome = 'not-started';
  verification = 'not-requested';
  settingsValue?: RuntimeSettings;
  private client?: ApiClient;
  constructor(public options: z.infer<typeof globals>, public signal: AbortSignal, public packageRoot = PACKAGE_ROOT) {}
  get interactive(): boolean { return !this.options.json && !!process.stdin.isTTY && !!process.stderr.isTTY; }
  async settings(): Promise<RuntimeSettings> { return this.settingsValue ??= await loadSettings(this.options.dataDir, this.packageRoot); }
  async api(): Promise<ApiClient> { const settings = await this.settings(); assertServiceConfigured(settings); return this.client ??= new ApiClient(settings, this.options.timeout, this.signal); }
  async write<T>(preview: unknown, perform: () => Promise<T>, impact?: string): Promise<T | { dryRun: true; preview: unknown }> {
    if (this.options.dryRun) return { dryRun: true, preview };
    if (impact) await confirm(impact, this.options.yes, this.interactive);
    const value = await perform();
    if (this.outcome === 'not-started') this.outcome = 'applied';
    if (this.verification === 'not-requested') this.verification = 'server-acknowledged';
    return value;
  }
  async verify<T>(fn: () => Promise<T>): Promise<T | null> {
    try { const value = await fn(); this.verification = 'read-back'; return value; }
    catch (error) { this.verification = 'unverified'; this.warnings.push(`操作已获得成功响应，后续查询失败（${error instanceof CliError ? error.code : 'LOCAL_ERROR'}）。不要重复提交。`); return null; }
  }
}
