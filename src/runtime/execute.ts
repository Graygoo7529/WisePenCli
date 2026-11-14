import { randomUUID } from 'node:crypto';
import type { CommandDef } from '../commands/registry.js';
import { segments } from '../domain/resolve.js';
import type { CliError } from '../errors.js';
import { DEFAULT_OUTPUT_BYTES } from './config.js';
import type { Context } from './context.js';
import { scrub } from './io.js';
import { recoveryActions } from './recovery.js';

export async function executeCommand(def: CommandDef, context: Context, input: Record<string, unknown>) {
  for (const key of ['path', 'to']) if (typeof input[key] === 'string') segments(input[key]);
  if (def.name !== 'schema' && def.name !== 'config set') await context.settings();
  const data = await def.run(context, input);
  if (def.effect === 'local' && context.verification === 'server-acknowledged') context.verification = 'local-write';
  return data;
}

export function commandError(context: Context | undefined, error: CliError) {
  if (context && (error.outcome !== 'not-started' || context.outcome === 'not-started')) context.outcome = error.outcome;
  const settings = context?.settingsValue;
  const details = error.exitCode === 3 ? { ...error.details, apiUrl: settings?.apiUrl, dataDir: settings?.dataDir } : error.details;
  return { code: error.code, message: error.message, details, nextActions: recoveryActions(context, error) };
}

export function commandResult(command: string, context: Context | undefined, data: unknown, error: ReturnType<typeof commandError> | null) {
  const settings = context?.settingsValue;
  return {
    schemaVersion: '2', command, ok: error === null, data: data ?? null,
    meta: { apiUrl: settings?.apiUrl ?? null, dataDir: settings?.dataDir ?? null, operationId: context?.operationId ?? randomUUID(), outcome: context?.outcome ?? 'not-started', verification: context?.verification ?? 'not-requested' },
    warnings: context?.warnings ?? [], error,
  };
}

export function boundedJson(result: ReturnType<typeof commandResult>, limit = DEFAULT_OUTPUT_BYTES, message = '输出超过预算；请减小 --size、使用 export，或用 config set 调整 maxOutputBytes。') {
  const value = scrub(result) as Record<string, unknown>;
  const json = JSON.stringify(value);
  const requiredBytes = Buffer.byteLength(json);
  if (requiredBytes <= limit) return { value, json, limited: false };
  const limited = { ...value, ok: false, data: null, error: { code: 'OUTPUT_LIMIT', message, details: { limit, requiredBytes, truncated: false }, nextActions: [] } };
  return { value: limited, json: JSON.stringify(limited), limited: true };
}
