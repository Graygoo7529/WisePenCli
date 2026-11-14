import { cp, mkdir, readFile, rm, writeFile, chmod, realpath } from 'node:fs/promises';
import { dirname, join, resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = await realpath(resolve(dirname(fileURLToPath(import.meta.url)), '..'));
const target = join(root, 'wisepen-cli');
await mkdir(target, { recursive: true });
if (await realpath(target) !== target) throw new Error('Portable target must be a real directory inside this project.');
const sourcePackage = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
// Only generated files are replaced. Never remove data/ or wisepen.json.
for (const name of ['dist', 'node_modules', 'skills', 'package.json', 'package-lock.json', 'README.md', 'USAGE.md', 'wisepen.cmd', 'wisepen']) {
  const path = resolve(target, name); const inside = relative(target, path);
  if (!inside || inside.startsWith('..') || isAbsolute(inside)) throw new Error('Invalid generated path.');
  await rm(path, { recursive: true, force: true });
}
for (const name of ['dist', 'node_modules', 'skills']) await cp(join(root, name), join(target, name), { recursive: true });
await writeFile(join(target, 'package.json'), JSON.stringify({ name: '@wisepen/cli-portable', version: sourcePackage.version, private: true, type: 'module', engines: sourcePackage.engines, dependencies: sourcePackage.dependencies }, null, 2) + '\n');
const npmArgs = ['prune', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund', '--offline', '--prefix', target];
if (process.platform === 'win32') execFileSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'npm.cmd', ...npmArgs], { stdio: 'inherit', windowsHide: true });
else execFileSync('npm', npmArgs, { stdio: 'inherit' });
await cp(join(root, 'wisepen'), join(target, 'wisepen'));
await chmod(join(target, 'wisepen'), 0o755);
const cmd = (await readFile(join(root, 'wisepen.cmd'), 'utf8')).replace(/\r?\n/g, '\r\n');
await writeFile(join(target, 'wisepen.cmd'), cmd);
await cp(join(root, 'docs', 'portable-README.md'), join(target, 'README.md'));
await cp(join(root, 'docs', 'CLI使用说明.md'), join(target, 'USAGE.md'));
await cp(join(root, 'docs', 'agent-integrations.md'), join(target, 'AGENT-INTEGRATIONS.md'));
await mkdir(join(target, 'scripts'), { recursive: true });
await cp(join(root, 'scripts', 'build-plugins.mjs'), join(target, 'scripts', 'build-plugins.mjs'));
await mkdir(join(target, 'data'), { recursive: true, mode: 0o700 });
await writeFile(join(target, 'data', '.gitkeep'), '');
await writeFile(join(target, 'data', '.gitignore'), '*\n!.gitignore\n!.gitkeep\n');
console.log(`Portable package ready: ${target}; existing configuration and data preserved.`);
