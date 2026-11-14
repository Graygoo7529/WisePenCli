import { cp, mkdir, readFile, rm, writeFile, chmod, lstat, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';

const { values: { release } } = parseArgs({ options: { release: { type: 'boolean' } } });
const root = await realpath(fileURLToPath(new URL('../', import.meta.url)));
const parent = release ? join(root, 'releases') : root;
const target = join(parent, 'wisepen-cli');
if (release) {
  await mkdir(parent, { recursive: true });
  if (!(await lstat(parent)).isDirectory()) throw new Error('Release directory must be a real directory inside this project.');
  await rm(target, { recursive: true, force: true });
}
await mkdir(target, { recursive: true });
if (await realpath(target) !== target) throw new Error('Portable target must be a real directory inside this project.');

const copy = [
  ['dist', 'dist'], ['node_modules', 'node_modules'], ['skills', 'skills'],
  ['wisepen', 'wisepen'], ['package-lock.json', 'package-lock.json'],
  ['docs/portable-README.md', 'README.md'], ['docs/CLI使用说明.md', 'USAGE.md'],
];
// 本地重建仅替换打包产物，保留 data/ 和 wisepen.json。
if (!release) {
  for (const name of [...copy.map(([, dest]) => dest), 'package.json', 'wisepen.cmd']) {
    await rm(join(target, name), { recursive: true, force: true });
  }
}
for (const [source, dest] of copy) await cp(join(root, source), join(target, dest), { recursive: true });
const sourcePackage = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
await writeFile(join(target, 'package.json'), JSON.stringify({ name: '@wisepen/cli-portable', version: sourcePackage.version, private: true, type: 'module', engines: sourcePackage.engines, dependencies: sourcePackage.dependencies }, null, 2) + '\n');

const npmArgs = ['prune', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund', '--offline', '--prefix', target];
if (process.platform === 'win32') execFileSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'npm.cmd', ...npmArgs], { stdio: 'inherit', windowsHide: true });
else execFileSync('npm', npmArgs, { stdio: 'inherit' });

await chmod(join(target, 'wisepen'), 0o755);
const cmd = (await readFile(join(root, 'wisepen.cmd'), 'utf8')).replace(/\r?\n/g, '\r\n');
await writeFile(join(target, 'wisepen.cmd'), cmd);
await mkdir(join(target, 'data'), { recursive: true, mode: 0o700 });
await writeFile(join(target, 'data', '.gitkeep'), '');
await writeFile(join(target, 'data', '.gitignore'), '*\n!.gitignore\n!.gitkeep\n');
console.log(release ? `Clean release package ready: ${target}` : `Portable package ready: ${target}; existing configuration and data preserved.`);
