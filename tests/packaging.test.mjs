import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('发布构建拒绝链接到项目外的目录，不清理其中的文件', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'wisepen-release-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const root = join(dir, 'project');
  const outside = join(dir, 'outside');
  const file = join(outside, 'wisepen-cli', 'keep.txt');
  await mkdir(join(root, 'scripts'), { recursive: true });
  await mkdir(join(outside, 'wisepen-cli'), { recursive: true });
  await writeFile(file, 'keep');
  await symlink(outside, join(root, 'releases'), process.platform === 'win32' ? 'junction' : 'dir');
  const builder = join(root, 'scripts', 'build-portable.mjs');
  await copyFile(new URL('../scripts/build-portable.mjs', import.meta.url), builder);

  const result = spawnSync(process.execPath, [builder, '--release'], { encoding: 'utf8' });
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /Release directory must be a real directory/);
  assert.equal(await readFile(file, 'utf8'), 'keep');
});
