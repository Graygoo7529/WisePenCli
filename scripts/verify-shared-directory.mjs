// Run in disposable Linux CI as root. No accounts or production state are changed.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, chmod, chown, cp, symlink, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

assert.equal(process.platform, 'linux', 'Run this check on Linux.');
assert.equal(process.getuid(), 0, 'Run with sudo so the check can launch two distinct UIDs.');
const owner = Number(process.env.SUDO_UID ?? 1001); const group = Number(process.env.SUDO_GID ?? 1001); const agent = 65534;
assert.ok(owner !== agent && owner !== 0);
const root = await mkdtemp(join(tmpdir(), 'wisepen-shared-users-'));
let generation = 0; let current = '';
const server = createServer(async (req, res) => {
  let raw = ''; for await (const chunk of req) raw += chunk;
  const url = new URL(req.url, 'http://localhost');
  const send = (data, code = 200) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ code, msg: null, data })); };
  if (url.pathname === '/auth/login') { assert.equal(JSON.parse(raw).password, 'fixture-password'); current = `fixture-session-${++generation}`; return send(current); }
  if (req.headers.authorization !== current) return send(null, 401);
  if (url.pathname === '/user/getUserInfo') return send({ userId: 'fixture-user', userInfo: { username: 'shared-test' } });
  if (url.pathname === '/resource/tag/getTagTree') return send([{ tagId: 'root', tagName: '/', parentId: '0', isPath: true, children: [] }]);
  if (url.pathname === '/document/uploadDoc') return send({ documentId: 'task-shared', putUrl: null, callbackHeader: null, objectKey: 'fixture', flashUploaded: true });
  return send(null, 404);
});
server.listen(0, '127.0.0.1'); await once(server, 'listening');
const data = join(root, 'data');
try {
  await chmod(root, 0o755);
  await cp(resolve('dist'), join(root, 'dist'), { recursive: true });
  await symlink(resolve('node_modules'), join(root, 'node_modules'), 'dir');
  await writeFile(join(root, 'package.json'), '{"type":"module"}', { mode: 0o644 });
  await writeFile(join(root, 'wisepen.json'), JSON.stringify({ version: 1, apiUrl: `http://127.0.0.1:${server.address().port}` }), { mode: 0o644 });
  await writeFile(join(root, 'fixture.pdf'), 'fixture', { mode: 0o644 });
  await mkdir(data); await chown(data, owner, group); await chmod(data, 0o2770);
  const run = (uid, args, stdin = '') => new Promise((resolveResult, reject) => {
    const bootstrap = `if(process.getuid()!==${uid}) throw Error('UID mismatch'); process.umask(0o007); await import(process.argv[1]);`;
    const child = spawn(process.execPath, ['--input-type=module', '-e', bootstrap, pathToFileURL(join(root, 'dist/cli.js')).href, ...args, '--json'], { uid, gid: group, cwd: root, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = ''; let err = ''; child.stdout.on('data', x => { out += x; }); child.stderr.on('data', x => { err += x; }); child.on('error', reject);
    const timer = setTimeout(() => { child.kill(); reject(Error('shared-account check timed out')); }, 15000);
    child.on('close', code => { clearTimeout(timer); try { resolveResult({ code, result: JSON.parse(out) }); } catch { reject(Error(err || out)); } });
    child.stdin.end(stdin);
  });
  const login = () => run(owner, ['login', '--account', 'fixture', '--password-stdin'], 'fixture-password');
  assert.equal((await login()).code, 0);
  assert.equal((await run(agent, ['auth', 'status'])).code, 0);
  assert.equal((await run(agent, ['doc', 'upload', '--file', join(root, 'fixture.pdf')])).code, 0);
  assert.equal((await run(owner, ['doc', 'tasks'])).result.data[0].documentId, 'task-shared');
  assert.equal((await login()).code, 0);
  assert.equal((await run(agent, ['auth', 'status'])).code, 0);
  assert.equal(JSON.parse(await readFile(join(data, 'auth.json'), 'utf8')).token, 'fixture-session-2');
  await chmod(data, 0o700);
  assert.equal((await run(agent, ['auth', 'status'])).result.error.code, 'DATA_DIR_ACCESS_DENIED');
  console.log(`Shared-directory flow passed with distinct UIDs ${owner} and ${agent}.`);
} finally {
  server.closeAllConnections(); await new Promise(resolveClose => server.close(resolveClose));
  await rm(root, { recursive: true, force: true });
}
