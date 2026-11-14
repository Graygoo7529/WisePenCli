import { cp, chmod, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = await realpath(resolve(dirname(fileURLToPath(import.meta.url)), '..'));
const releases = join(root, 'releases');
const target = join(releases, 'wisepen-cli');
await mkdir(releases, { recursive: true });
await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });
const targetReal = await realpath(target);
const relativeTarget = relative(releases, targetReal);
if (!relativeTarget || relativeTarget.startsWith('..') || isAbsolute(relativeTarget)) throw new Error('Release target must stay inside releases/.');

const sourcePackage = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
for (const name of ['dist', 'node_modules', 'skills']) await cp(join(root, name), join(target, name), { recursive: true });
await writeFile(join(target, 'package.json'), JSON.stringify({
  name: '@wisepen/cli-portable',
  version: sourcePackage.version,
  private: true,
  type: 'module',
  engines: sourcePackage.engines,
  dependencies: sourcePackage.dependencies,
}, null, 2) + '\n');
await cp(join(root, 'package-lock.json'), join(target, 'package-lock.json'));

const npmArgs = ['prune', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund', '--offline', '--prefix', target];
if (process.platform === 'win32') {
  execFileSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'npm.cmd', ...npmArgs], { stdio: 'inherit', windowsHide: true });
} else {
  execFileSync('npm', npmArgs, { stdio: 'inherit' });
}

await cp(join(root, 'wisepen'), join(target, 'wisepen'));
await chmod(join(target, 'wisepen'), 0o755);
const cmd = (await readFile(join(root, 'wisepen.cmd'), 'utf8')).replace(/\r?\n/g, '\r\n');
await writeFile(join(target, 'wisepen.cmd'), cmd);
await cp(join(root, 'docs', 'portable-README.md'), join(target, 'README.md'));
await cp(join(root, 'docs', 'CLI使用说明.md'), join(target, 'USAGE.md'));
await cp(join(root, 'docs', 'agent-integrations.md'), join(target, 'AGENT-INTEGRATIONS.md'));
await mkdir(join(target, 'scripts'), { recursive: true });
await cp(join(root, 'scripts', 'build-plugins.mjs'), join(target, 'scripts', 'build-plugins.mjs'));

const data = join(target, 'data');
await mkdir(data, { recursive: true, mode: 0o700 });
await writeFile(join(data, '.gitkeep'), '');
await writeFile(join(data, '.gitignore'), '*\n!.gitignore\n!.gitkeep\n');
console.log(`Clean release package ready: ${target}`);
