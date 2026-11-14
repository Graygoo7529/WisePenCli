#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { Server, specTypeSchemas } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { z } from 'zod';
import { commands, VERSION } from './commands/index.js';
import { asCliError, CliError } from './errors.js';
import { DEFAULT_OUTPUT_BYTES } from './runtime/config.js';
import { Context, globals } from './runtime/context.js';
import { boundedJson, commandError, commandResult, executeCommand } from './runtime/execute.js';
import { parse, withSecrets } from './runtime/io.js';

const reads = new Set([
  'auth status', 'group list', 'group show', 'drive ls', 'resource show', 'search',
  'doc tasks', 'doc pending', 'doc status', 'note show', 'note versions',
  'session list', 'session history', 'provider list', 'provider show',
  'model list', 'model show', 'model available', 'web url',
]);
const writes = new Set([
  'drive mkdir', 'drive rename', 'drive move', 'resource rename', 'resource move',
  'note create', 'note fork', 'session rename',
]);
const preview = z.boolean().default(true).describe('默认仅预览。取得用户确认后，传入 false 执行写入。');

function start() {
  const { values } = parseArgs({ options: {
    'data-dir': { type: 'string' }, 'enable-writes': { type: 'boolean' },
    help: { type: 'boolean', short: 'h' }, version: { type: 'boolean', short: 'V' },
  } });
  if (values.help) {
    process.stdout.write('用法：wisepen-mcp [--data-dir <目录>] [--enable-writes]\n');
    return;
  }
  if (values.version) { process.stdout.write(VERSION + '\n'); return; }
  const options = parse(globals, { json: true, dataDir: values['data-dir'] });
  const tools = new Map(commands.filter(def => def.available !== false && (
    def.effect === 'read' && reads.has(def.name) || def.effect === 'write' && values['enable-writes'] && writes.has(def.name)
  )).map(def => {
    const schema = def.effect === 'write' ? def.input.extend({ dryRun: preview }) : def.input;
    const name = def.name.replaceAll(' ', '_');
    const inputSchema = z.toJSONSchema(schema, { io: 'input', override: ({ jsonSchema }) => {
      // DSH 只接受 JSON Schema 的子集，实际参数限制仍由 Zod 验证。
      for (const key of ['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'minLength']) delete jsonSchema[key];
    } });
    delete inputSchema.$schema;
    const result = specTypeSchemas.Tool['~standard'].validate({
      name, description: def.effect === 'read' ? def.description : def.description + '；默认仅预览。',
      inputSchema, annotations: { readOnlyHint: def.effect === 'read' },
    });
    if (result.issues) throw new Error(`无效的 MCP 工具声明：${name}`);
    return [name, { def, schema, tool: result.value }];
  }));

  serveStdio(() => {
    const server = new Server({ name: 'wisepen', version: VERSION }, {
      capabilities: { tools: {} },
      instructions: '使用已登录的 WisePenCli 便携包。需要登录时把 nextActions 中的指令交给用户在终端执行，不要索要密码。写入前先预览；结果为 partial、pending 或 unknown 时先查询，不要重复提交。',
    });
    server.setRequestHandler('tools/list', () => ({ tools: [...tools.values()].map(tool => tool.tool) }));
    server.setRequestHandler('tools/call', (request, { mcpReq }) => withSecrets(async () => {
      const tool = tools.get(request.params.name);
      let context: Context | undefined;
      let data: unknown;
      let error: ReturnType<typeof commandError> | null = null;
      try {
        if (!tool) throw new CliError('CAPABILITY_UNAVAILABLE', '此 MCP server 未开放该工具。');
        const { dryRun, ...input } = parse(tool.schema, request.params.arguments ?? {});
        context = new Context({ ...options, dryRun: dryRun === true }, mcpReq.signal);
        data = await executeCommand(tool.def, context, input);
      } catch (cause) {
        error = commandError(context, asCliError(cause));
      }
      const { value, json, limited } = boundedJson(commandResult(tool?.def.name ?? 'mcp', context, data, error),
        Math.min(context?.settingsValue?.maxOutputBytes ?? DEFAULT_OUTPUT_BYTES, DEFAULT_OUTPUT_BYTES),
        '输出超过 MCP 预算；请缩小分页大小，或改用 CLI 导出。');
      return { isError: !!error || limited, content: [{ type: 'text', text: json }], structuredContent: value };
    }));
    return server;
  });
}

try { start(); }
catch {
  process.stderr.write('WisePen MCP 启动失败。请用 --help 检查启动参数。\n');
  process.exitCode = 2;
}
