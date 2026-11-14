import { z } from 'zod';
import { CliError } from '../errors.js';
import { credential } from '../runtime/config.js';
import type { RuntimeSettings } from '../runtime/config.js';
import { parse, registerSecret } from '../runtime/io.js';
import type { Endpoint } from '../contracts/api.js';

const envelope = z.object({ code: z.number(), key: z.string().nullable().optional(), msg: z.string().nullable(), data: z.unknown() });
export class ApiClient {
  private session?: Promise<string>;
  public writeSubmitted = false;
  constructor(public settings: RuntimeSettings, public timeout: number, public signal: AbortSignal, token?: string) {
    if (token) this.session = Promise.resolve(registerSecret(token));
  }
  async token(): Promise<string> { this.session ??= credential(this.settings).then(v => v.token); return this.session; }
  async authHeaders(): Promise<Record<string, string>> {
    const token = await this.token();
    if (/[\r\n;]/.test(token)) throw new CliError('CREDENTIAL_INVALID', '会话凭据包含非法字符。', 3);
    return { authorization: token };
  }
  url(path: string, query: Record<string, unknown> = {}): URL {
    const url = new URL(`${this.settings.apiUrl}${path}`);
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined) continue;
      if (Array.isArray(value)) value.forEach(item => url.searchParams.append(key, String(item)));
      else url.searchParams.set(key, String(value));
    }
    return url;
  }
  async call<T>(endpoint: Endpoint<T>, input: unknown = {}): Promise<T> {
    const args = parse(endpoint.request, input) as Record<string, unknown>;
    const query: Record<string, unknown> = {};
    const body: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(args)) (endpoint.query === true || endpoint.query?.includes(key) ? query : body)[key] = value;
    const headers = { 'Content-Type': 'application/json', ...(endpoint.auth ? await this.authHeaders() : {}) };
    const url = this.url(endpoint.path, query);
    const attempts = endpoint.readOnly ? 2 : 1;
    for (let attempt = 0; attempt < attempts; attempt++) {
      if (this.signal.aborted) throw new CliError('CANCELED', '操作已中断。', 130);
      let response: Response;
      try {
        if (!endpoint.readOnly) this.writeSubmitted = true;
        response = await fetch(url, { method: endpoint.method, headers, redirect: 'manual', body: endpoint.method === 'GET' || endpoint.query === true ? undefined : JSON.stringify(body), signal: AbortSignal.any([this.signal, AbortSignal.timeout(this.timeout)]) });
      } catch {
        if (!endpoint.readOnly) throw new CliError('WRITE_OUTCOME_UNKNOWN', '请求可能已到达服务端，请核实结果后再决定是否重试。', this.signal.aborted ? 130 : 11, { endpoint: endpoint.path }, 'unknown');
        if (!this.signal.aborted && attempt + 1 < attempts) continue;
        throw new CliError(this.signal.aborted ? 'CANCELED' : 'NETWORK_ERROR', this.signal.aborted ? '操作已中断。' : '无法读取服务响应，请检查网关地址和网络。', this.signal.aborted ? 130 : 7);
      }
      if (response.status >= 500 && endpoint.readOnly && attempt + 1 < attempts) { await response.body?.cancel(); continue; }
      if ([401, 403, 404].includes(response.status)) {
        await response.body?.cancel();
        const code = response.status === 401 ? 3 : response.status === 403 ? 4 : 5;
        throw new CliError(code === 3 ? 'LOGIN_REQUIRED' : code === 4 ? 'PERMISSION_DENIED' : 'NOT_FOUND', `服务拒绝请求（HTTP ${response.status}）。`, code, { httpStatus: response.status, endpoint: endpoint.path });
      }
      if (response.status >= 300 && response.status < 400) { await response.body?.cancel(); throw new CliError('UNEXPECTED_REDIRECT', 'API 返回重定向，未转发会话凭据。', 8); }
      let wire: unknown;
      try { wire = await response.json(); } catch { throw new CliError(endpoint.readOnly ? 'INVALID_RESPONSE' : 'WRITE_OUTCOME_UNKNOWN', '服务响应无法解析。', endpoint.readOnly ? 8 : 11, { endpoint: endpoint.path }, endpoint.readOnly ? 'not-started' : 'unknown'); }
      const result = envelope.safeParse(wire);
      if (!result.success) throw new CliError(endpoint.readOnly ? 'INVALID_RESPONSE' : 'WRITE_OUTCOME_UNKNOWN', '服务响应外层不符合契约。', endpoint.readOnly ? 8 : 11, { endpoint: endpoint.path }, endpoint.readOnly ? 'not-started' : 'unknown');
      if (!response.ok || result.data.code !== 200) {
        const reason = result.data.key?.split('.').at(-1);
        const uncertain = !endpoint.readOnly && (response.status >= 500 || result.data.code === 500 || !!reason && ['failed', 'timeout', 'unavailable', 'internal_error', 'external_failed', 'external_timeout', 'external_unavailable'].includes(reason));
        const code = uncertain ? 11 : [401, 1211].includes(result.data.code) || reason === 'unauthenticated' ? 3 : [403, 1221, 1222, 1231].includes(result.data.code) || ['permission_denied', 'unauthorized'].includes(reason ?? '') ? 4 : reason === 'not_found' || response.status === 404 ? 5 : ['conflict', 'already_exists'].includes(reason ?? '') || response.status === 409 ? 6 : 8;
        const errorCode = ({ 3: 'LOGIN_REQUIRED', 4: 'PERMISSION_DENIED', 5: 'NOT_FOUND', 6: 'CONFLICT', 11: 'WRITE_OUTCOME_UNKNOWN' } as Record<number, string>)[code] ?? 'REMOTE_ERROR';
        throw new CliError(errorCode, uncertain ? '写请求可能已经生效，请先核实目标状态。' : '服务拒绝请求。', code, { httpStatus: response.status, serverCode: result.data.code, serverKey: result.data.key, serverMessage: result.data.msg, endpoint: endpoint.path }, uncertain ? 'unknown' : 'not-started');
      }
      const parsed = endpoint.response.safeParse(result.data.data);
      if (!parsed.success) throw new CliError('INVALID_RESPONSE', '响应数据不符合接口契约。', 8, { endpoint: endpoint.path, issues: parsed.error.issues.map(i => ({ path: i.path, code: i.code })) }, endpoint.readOnly ? 'not-started' : 'applied');
      if (endpoint.path.startsWith('/resource/placement/')) {
        const count = (parsed.data as { resourceCount: number }).resourceCount;
        const expected = Array.isArray(args.resourceIds) ? args.resourceIds.length : Object.keys(args.resourceSourceTagMap as object).length;
        if (count !== expected) throw new CliError('PARTIAL_WRITE', '服务端报告的资源数量与请求数量不同，请核实目标状态。', 9, { expected, affected: count, endpoint: endpoint.path }, 'partial');
      }
      return parsed.data;
    }
    throw new CliError('NETWORK_ERROR', '请求未完成。', 7);
  }
}
