import { access, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const { values } = parseArgs({ options: {
  'cli-dir': { type: 'string' }, 'enable-writes': { type: 'boolean' },
} });
const root = await realpath(values['cli-dir'] ?? fileURLToPath(new URL('../', import.meta.url)));
const { version } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const entry = join(root, 'dist', 'mcp.js');
await access(entry).catch(() => { throw new Error('找不到 MCP 入口。请先构建 WisePenCli 或指定已解压的便携包。'); });
const launch = { type: 'stdio', command: process.execPath, args: [entry, ...(values['enable-writes'] ? ['--enable-writes'] : [])] };
const output = join(root, 'agent-plugins');
const name = 'wisepen';
const description = '在 agent 中查询 WisePen 目录、资源、文档任务和会话。';
const metadata = { name, version, description };
const publisher = { name: 'WisePenCli' };
const mcp = { mcpServers: { [name]: launch } };
const source = './wisepen';
const marketplace = 'wisepen-local';

async function write(path, value) {
  const target = join(output, path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n');
}

await Promise.all([
  write('mcp.json', mcp),
  write('wisepen/.mcp.json', mcp),
  write('wisepen/.codex-plugin/plugin.json', {
    ...metadata, mcpServers: './.mcp.json', requires_local_executor: true,
    interface: { displayName: 'WisePen', shortDescription: description },
  }),
  write('wisepen/.claude-plugin/plugin.json', { ...metadata, author: publisher, mcpServers: './.mcp.json' }),
  write('.agents/plugins/marketplace.json', {
    name: marketplace,
    plugins: [{ name, source: { source: 'local', path: source }, policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' }, category: 'Productivity' }],
  }),
  write('.claude-plugin/marketplace.json', {
    name: marketplace, description, owner: publisher, plugins: [{ name, source, description }],
  }),
  write('dsh/package.json', {
    ...metadata, name: '@wisepen/dsh-plugin', private: true, files: ['cordis.patch.yml'], dsh: { bundle: { patch: './cordis.patch.yml' } },
  }),
  write('dsh/cordis.patch.yml', `- insert:
    - id: wisepen-mcp
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: wisepen
        transport: stdio
        command: ${JSON.stringify(launch.command)}
        args: ${JSON.stringify(launch.args)}
        failOnStartupError: true
`),
]);
console.log(output);
