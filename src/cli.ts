#!/usr/bin/env node
import { Command, CommanderError, Option } from 'commander';
import { z } from 'zod';
import { Context, globals } from './runtime/context.js';
import { parse, readInput, scrub } from './runtime/io.js';
import { localPath, localInputs } from './runtime/paths.js';
import { boundedJson, commandError, commandResult, executeCommand } from './runtime/execute.js';
import { asCliError, CliError, invalid } from './errors.js';
import { commands, VERSION } from './commands/index.js';
import { render } from './runtime/render.js';

const program = new Command().name('wisepen').description('WisePen console 与 agent 客户端').version(VERSION);
program.option('--json', '输出单个 JSON 结果，禁用交互').option('--data-dir <path>', '本次调用的数据目录').option('--yes', '确认有破坏性的业务操作').option('--dry-run', '只查询和预览，不执行写入').option('--timeout <ms>', '单次请求超时毫秒', '30000').option('--input <file>', '从 UTF-8 JSON 文件或 - (stdin) 读取参数');
const abort = new AbortController();
process.on('SIGINT', () => abort.abort());
let context: Context | undefined;
let commandName = 'help';
let result: unknown;
let help = '';
let handled = false;
const isJson = process.argv.includes('--json');
const nodes = new Map<string, Command>([['', program]]);
program.configureOutput({ writeOut: value => { help += value; }, writeErr: () => undefined });
program.exitOverride();
for (const def of commands) {
  const parts = def.name.split(' '); let parent = program;
  for (let i = 0; i < parts.length; i++) {
    const path = parts.slice(0, i + 1).join(' '); let node = nodes.get(path);
    if (!node) { node = parent.command(parts[i]!); nodes.set(path, node); }
    parent = node;
  }
  parent.description(def.description);
  for (const [flags, description] of def.options ?? []) parent.addOption(new Option(flags, description));
  parent.action(async (_opts, command: Command) => {
    commandName = def.name; handled = true;
    const all = command.optsWithGlobals();
    context = new Context(parse(globals, all), abort.signal);
    const local = { ...command.opts() };
    for (const key of [...Object.keys(globals.shape), 'input']) delete local[key];
    if (all.input === '-' && (local.passwordStdin || local.apiKeyStdin)) invalid('--input - 与密钥 stdin 不能同时使用。');
    let fromFile: Record<string, unknown> = {};
    if (all.input) fromFile = parse(z.record(z.string(), z.unknown()), await readInput(localPath(String(all.input))));
    if ('api_key' in fromFile || 'password' in fromFile || 'token' in fromFile) invalid('密码和密钥请通过隐藏提示或专用 stdin 参数提供。');
    const input = parse(def.input, localInputs(def.name, { ...fromFile, ...local }));
    result = await executeCommand(def, context, input);
  });
}
function output(data: unknown, error: ReturnType<typeof commandError> | null = null): void {
  const result = commandResult(commandName, context, data, error);
  if (isJson || context?.options.json) {
    const { json, limited } = boundedJson(result, context?.settingsValue?.maxOutputBytes);
    process.stdout.write(json + '\n');
    if (limited) process.exitCode = 6;
  } else if (!error) {
    if (help && !handled) process.stdout.write(help);
    else process.stdout.write(render(commandName, scrub(result.data)));
    for (const warning of context?.warnings ?? []) process.stderr.write(String(scrub(warning)) + '\n');
  } else {
    const value = scrub(error) as typeof error;
    process.stderr.write(value.message + '\n');
    if (value.details && Object.keys(value.details).length) process.stderr.write(JSON.stringify(value.details, null, 2) + '\n');
    for (const action of value.nextActions) process.stderr.write(action.displayCommand + '\n');
  }
}
try {
  await program.parseAsync(process.argv);
  if (!handled) { if (!help) help = program.helpInformation(); result = { help }; }
  output(result);
} catch (error) {
  if (error instanceof CommanderError && ['commander.helpDisplayed', 'commander.help'].includes(error.code)) output({ help });
  else if (error instanceof CommanderError && error.code === 'commander.version') output({ version: help.trim() });
  else {
    const e = error instanceof CommanderError ? new CliError('INVALID_ARGUMENT', '命令或参数无法解析，请查看 --help；0.2 已移除 profile、whoami、doctor 等旧入口。', 2, { parserCode: error.code }) : asCliError(error);
    output(null, commandError(context, e)); process.exitCode = e.exitCode;
  }
}
