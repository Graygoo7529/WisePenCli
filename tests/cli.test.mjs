import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { mkdtemp, realpath, readFile, writeFile, readdir, rm, mkdir, cp, symlink, chmod, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { WebSocketServer } from 'ws';
import * as Y from 'yjs';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import * as sync from 'y-protocols/sync';
import { segments } from '../dist/domain/resolve.js';

const project = resolve(process.env.WISEPEN_TEST_PACKAGE ?? '.');
const token = 'fixture-session-secret';
const r = (id = '9007199254740993123', name = '文档.pdf', type = 'PDF') => ({ resourceId: id, resourceName: name, resourceType: type, ownerId: 'u1', tagBinds: [], currentActions: ['VIEW', 'EDIT'] });
const tag = (tagId, tagName, children = []) => ({ tagId, tagName, children, parentId: '0', isPath: tagName.startsWith('/') });
const tags = [tag('root', '/', [tag('work', '/研究')]), tag('trash', '.Trash')];
const javaPage = (list, page = 1, totalPage = 1, total = list.length) => ({ list, page, size: 100, totalPage, total: String(total) });
const pythonPage = (list, page = 1, total_page = 1, total = list.length) => ({ list, page, size: 100, total_page, total });
const session = (id, title) => ({ id, title, created_at: '2026-11-12T00:00:00Z', updated_at: '2026-11-12T00:00:00Z' });
const msg = (id, content) => ({ id, role: 'user', createdAt: null, parts: [{ type: 'text', text: content }] });
const provider = { id: 'aaaaaaaaaaaaaaaaaaaaaaaa', name: '测试供应商', scope: 'USER', type: 'OPENAI_COMPATIBLE', base_url: 'https://example.com/v1', api_key_fingerprint: 'abcd', is_active: true };

test('远端路径不使用 Windows 本地路径规则', () => {
  for (const [path, expected] of [['/', []], ['/研究//空 格/', ['研究', '空 格']], ['/c/notes', ['c', 'notes']]]) assert.deepEqual(segments(path), expected);
  for (const path of ['C:/work', 'C:\\work', '\\\\server\\share', '//server/share', '/a/../b', '/a/./b', '/a\0b', 'relative']) assert.throws(() => segments(path), { code: 'INVALID_INPUT' });
});

test('持久和临时数据目录的相对基准明确，不受 cwd 影响', async t => {
  const f = await fixture(t);
  const changed = await f.run(['config', 'set', '--key', 'dataDir', '--value', './shared data'], { cwd: tmpdir() }); assert.equal(changed.code, 0);
  const info = await f.run(['config', 'show'], { cwd: tmpdir() }); assert.equal(info.data.data.dataDir, join(f.root, 'shared data'));
  const override = await f.run(['--data-dir', 'temporary', 'config', 'show'], { cwd: f.root }); assert.equal(override.data.data.dataDir, join(f.root, 'temporary')); assert.equal(override.data.data.dataDirSource, 'argument');
  assert.equal(JSON.parse(await readFile(join(f.root, 'wisepen.json'), 'utf8')).dataDir, './shared data');
});

test('旧自定义服务须显式选择，旧 DPAPI 和明文文件不会自动回退', async t => {
  const f = await fixture(t); await rm(join(f.root, 'wisepen.json')); await rm(join(f.dir, 'auth.json'));
  await writeFile(join(f.dir, 'config.json'), JSON.stringify({ version: 1, defaultProfile: 'old', profiles: { old: { apiUrl: f.apiUrl } } }));
  await writeFile(join(f.dir, 'credential-old.json'), JSON.stringify({ encrypted: 'not-a-real-credential' }));
  const blocked = await f.run(['login', '--account', 'test', '--password', 'secret']); assert.equal(blocked.data.error.code, 'LEGACY_CONFIG_REVIEW_REQUIRED'); assert.equal(f.requests.length, 0);
  assert.equal((await f.run(['config', 'set', '--key', 'apiUrl', '--value', f.apiUrl])).code, 0);
  const absent = await f.run(['auth', 'status']); assert.equal(absent.code, 3); assert.equal(absent.data.error.nextActions[0].command, 'login');
  assert.ok((await readdir(f.dir)).includes('credential-old.json'));
});

test('未登录和无 TTY 的 login 都不会挂起，stdin 输入互斥', async t => {
  const f = await fixture(t); await rm(join(f.dir, 'auth.json'));
  const missing = await f.run(['drive', 'ls']); assert.equal(missing.code, 3);
  const next = missing.data.error.nextActions[0]; assert.equal(next.actor, 'user'); assert.deepEqual(next.args, ['--data-dir', f.dir, 'login']); assert.ok(next.displayCommand.includes('login'));
  assert.equal((await f.run(['login'])).code, 2);
  assert.equal((await f.run(['login', '--account', 'test', '--password-stdin', '--input', '-'], { stdin: '{}' })).code, 2);
  assert.equal(f.requests.length, 0);
});

test('登录后保存失败报告 partial 和具体路径', async t => {
  const f = await fixture(t, (q, send) => { if (q.url.pathname === '/auth/login') { send(token); return true; } });
  await rm(join(f.dir, 'auth.json')); await mkdir(join(f.dir, 'auth.json'));
  const out = await f.run(['login', '--account', 'test', '--password-stdin'], { stdin: 'fixture-password' });
  assert.equal(out.code, 9); assert.equal(out.data.error.code, 'LOGIN_LOCAL_SAVE_FAILED'); assert.equal(out.data.meta.outcome, 'partial'); assert.equal(out.data.error.details.dataDir, f.dir); assert.ok(!out.stdout.includes(token));
});

test('会话失效优先提示登录，文档 ID 保留且可读取新令牌继续查询', async t => {
  let refreshes = 0; const renewed = 'fixture-renewed-session';
  const f = await fixture(t, (q, send) => {
    if (q.url.pathname === '/document/syncDocStatus') { if (++refreshes === 1) send({ status: 'CONVERTING_AND_PARSING', errorMessage: null }); else send(null, 401); return true; }
    if (q.url.pathname === '/auth/login') { send(renewed); return true; }
    if (q.url.pathname === '/document/listPendingDocs') { assert.equal(q.headers.authorization, renewed); send([]); return true; }
  });
  const wait = await f.run(['doc', 'wait', '--document-id', 'task-expired', '--max-wait', '5']);
  assert.equal(wait.code, 3); assert.equal(wait.data.meta.outcome, 'pending'); assert.equal(wait.data.error.details.documentId, 'task-expired');
  assert.deepEqual(wait.data.error.nextActions.map(x => x.command), ['login', 'doc status']);
  assert.equal((await f.run(['login', '--account', 'test', '--password-stdin'], { stdin: 'new-password' })).code, 0);
  assert.equal((await f.run(['doc', 'status', '--document-id', 'task-expired'])).code, 0);
  assert.equal(f.requests.filter(q => q.url.pathname === '/document/uploadDoc').length, 0);
});

test('旧请求收到 401 不会删除另一进程刚保存的新令牌', async t => {
  const renewed = 'fixture-new-token'; let f;
  f = await fixture(t, async (_q, send) => {
    await writeFile(join(f.dir, 'auth.json'), JSON.stringify({ version: 1, apiUrl: f.apiUrl, userId: 'u1', token: renewed, loggedInAt: new Date().toISOString() })); send(null, 401); return true;
  });
  assert.equal((await f.run(['auth', 'status'])).code, 3);
  assert.equal(JSON.parse(await readFile(join(f.dir, 'auth.json'), 'utf8')).token, renewed);
});

test('并发登录原子保存，logout 不撤销服务端，revoke 才撤销', async t => {
  const f = await fixture(t, async (q, send) => { if (q.url.pathname === '/auth/login') { await new Promise(resolve => setTimeout(resolve, 60)); send(token); return true; } if (q.url.pathname === '/auth/logout') { send(null); return true; } });
  const results = await Promise.all([f.run(['login', '--account', 'a', '--password-stdin'], { stdin: 'a' }), f.run(['login', '--account', 'b', '--password-stdin'], { stdin: 'b' })]);
  assert.ok(results.every(x => x.code === 0)); assert.equal(JSON.parse(await readFile(join(f.dir, 'auth.json'), 'utf8')).token, token);
  assert.equal((await f.run(['logout'])).code, 0); assert.equal(f.requests.filter(q => q.url.pathname === '/auth/logout').length, 0); assert.equal((await f.run(['auth', 'status'])).code, 3);
  await f.run(['login', '--account', 'a', '--password-stdin'], { stdin: 'a' }); assert.equal((await f.run(['auth', 'revoke', '--yes'])).code, 0);
  assert.equal(f.requests.filter(q => q.url.pathname === '/auth/logout').length, 1); assert.ok(!(await readdir(f.dir)).some(x => x.endsWith('.lock') || x.endsWith('.tmp') || x === 'auth.json'));
});

test('残留锁有界失败，损坏凭据与权限错误不混为解密失败', async t => {
  const f = await fixture(t); await writeFile(join(f.dir, 'auth.lock'), 'stale-test');
  const locked = await f.run(['login', '--account', 'test', '--password', 'dummy']); assert.equal(locked.data.error.code, 'DATA_BUSY'); assert.equal(f.requests.length, 0);
  await writeFile(join(f.dir, 'auth.json'), '{broken'); const broken = await f.run(['auth', 'status']); assert.equal(broken.data.error.code, 'CREDENTIAL_INVALID'); assert.equal(broken.data.error.nextActions[0].command, 'login');
});

test('POSIX 数据权限错误不要求重新登录，替换后保留共享 mode', { skip: process.platform === 'win32' || process.getuid?.() === 0 }, async t => {
  const f = await fixture(t, (q, send) => { if (q.url.pathname === '/auth/login') { send(token); return true; } });
  const path = join(f.dir, 'auth.json'); await chmod(path, 0o660);
  assert.equal((await f.run(['login', '--account', 'test', '--password', 'dummy'])).code, 0); assert.equal((await stat(path)).mode & 0o777, 0o660);
  await chmod(path, 0o000);
  try { const out = await f.run(['auth', 'status']); assert.equal(out.data.error.code, 'DATA_DIR_ACCESS_DENIED'); assert.equal(out.data.error.nextActions.length, 0); }
  finally { await chmod(path, 0o660); }
});

test('小组根可浏览和创建目录，但挂载只给出指引且不写入', async t => {
  const f = await fixture(t, (q, send) => {
    if (q.url.pathname.endsWith('/getGroupDetailInfo')) { send({ groupId: 'g1', groupName: '研究组', groupType: 1 }); return true; }
    if (q.url.pathname.endsWith('/getTagTree') && q.url.searchParams.get('groupId')) { send([tag('group-folder', '资料')]); return true; }
  });
  const listed = await f.run(['drive', 'ls', '--group-id', 'g1', '--path', '/']); assert.equal(listed.code, 0); assert.equal(listed.data.data.location.canMount, false);
  const root = await f.run(['resource', 'mount', '--id', 'r1', '--target-group-id', 'g1', '--to', '/', '--yes']); assert.equal(root.data.error.code, 'GROUP_ROOT_NOT_MOUNTABLE'); assert.equal(root.data.error.details.candidates[0].path, '/资料');
  assert.deepEqual(root.data.error.nextActions.map(x => x.command), ['drive ls', 'drive mkdir']); assert.ok(f.requests.every(q => q.method === 'GET'));
  const mkdir = await f.run(['drive', 'mkdir', '--group-id', 'g1', '--path', '/新目录', '--dry-run']); assert.equal(mkdir.code, 0); assert.equal(mkdir.data.data.preview.body.tagName, '新目录');
});

test('旧任务按服务和用户过滤，与新任务记录兼容', async t => {
  const f = await fixture(t); const old = join(f.dir, 'tasks', 'old-profile'); await mkdir(old, { recursive: true });
  for (const [id, apiUrl, userId] of [['mine', f.apiUrl, 'u1'], ['other-user', f.apiUrl, 'u2'], ['other-service', 'https://else.example', 'u1']]) await writeFile(join(old, id + '.json'), JSON.stringify({ documentId: id, apiUrl, userId }));
  const out = await f.run(['doc', 'tasks']); assert.equal(out.code, 0); assert.deepEqual(out.data.data.map(x => x.documentId), ['mine']);
});

test('外域下载认证错误不要求平台重新登录', async t => {
  const storage = createServer((_req, res) => { res.writeHead(401); res.end(); }); storage.listen(0, '127.0.0.1'); await once(storage, 'listening'); t.after(() => storage.close());
  const f = await fixture(t, (q, _send, res) => { if (q.url.pathname === '/document/download') { res.writeHead(302, { location: `http://127.0.0.1:${storage.address().port}/expired` }); res.end(); return true; } });
  const out = await f.run(['doc', 'download', '--id', 'r1', '--output', join(f.dir, 'download.pdf')]); assert.equal(out.code, 8); assert.equal(out.data.error.code, 'DOWNLOAD_REJECTED'); assert.deepEqual(out.data.error.nextActions, []);
});

for (const launcher of process.platform === 'win32' ? ['powershell', 'cmd', 'bash'] : ['posix', 'bash']) test(`${launcher} 真正启动链路保持远端路径、文本和本地路径`, async t => {
  const f = await fixture(t, (q, send, res) => {
    if (q.url.pathname === '/auth/login') { assert.equal(q.body.password, '/keep-this-remote-looking-password'); send(token); return true; }
    if (q.url.pathname === '/document/uploadDoc') { assert.equal(q.body.mountTargetTagId, 'work'); send({ documentId: 'shell-task', putUrl: null, callbackHeader: null, objectKey: 'object', flashUploaded: true }); return true; }
    if (q.url.pathname === '/document/download') { res.end('fixture-content'); return true; }
  });
  const opts = { launcher, cwd: tmpdir() };
  const convert = path => launcher === 'bash' && process.platform === 'win32' ? path.replace(/\\/g, '/').replace(/^([A-Z]):/i, (_match, drive) => '/' + drive.toLowerCase()) : path;
  for (const pathArgs of [['--path', '/'], ['--path=/']]) {
    const root = await f.run(['drive', 'ls', ...pathArgs], opts); assert.equal(root.code, 0, root.stdout + root.stderr); assert.equal(root.data.data.location.path, '/');
  }
  const login = await f.run(['login', '--account', 'test', '--password', '/keep-this-remote-looking-password'], opts); assert.equal(login.code, 0, login.stdout + login.stderr);
  const file = join(f.dir, '研究 文件.pdf'); await writeFile(file, 'fixture');
  const upload = await f.run(['doc', 'upload', '--file', convert(file), '--to', '/研究'], opts); assert.equal(upload.code, 0, upload.stdout + upload.stderr);
  const input = join(f.dir, 'parameters.json'); await writeFile(input, JSON.stringify({ file: convert(file), to: '/研究' }));
  const jsonUpload = await f.run(['doc', 'upload', '--input', convert(input)], opts); assert.equal(jsonUpload.code, 0, jsonUpload.stdout + jsonUpload.stderr);
  const downloaded = join(f.dir, '下载 文件.pdf'); const download = await f.run(['doc', 'download', '--id', 'r1', '--output', convert(downloaded)], opts); assert.equal(download.code, 0, download.stdout + download.stderr); assert.equal(await readFile(downloaded, 'utf8'), 'fixture-content');
  const configured = await f.run(['config', 'set', '--key', 'dataDir', '--value', convert(f.dir)], opts); assert.equal(configured.code, 0, configured.stdout + configured.stderr); assert.equal(configured.data.data.settings.dataDir, f.dir);
  const override = await f.run(['--data-dir', convert(f.dir), 'auth', 'status'], opts); assert.equal(override.code, 0, override.stdout + override.stderr);
});

async function fixture(t, handler = () => undefined) {
  // macOS exposes /var as a symlink to /private/var. The CLI is loaded by
  // Node through its real path, so fixture paths must use the same spelling.
  const root = await realpath(await mkdtemp(join(tmpdir(), 'wisepen cli test-')));
  const dir = join(root, 'data'); await mkdir(dir, { mode: 0o700 });
  await cp(join(project, 'dist'), join(root, 'dist'), { recursive: true });
  await symlink(join(project, 'node_modules'), join(root, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  for (const file of ['wisepen', 'wisepen.cmd']) await cp(join(project, file), join(root, file));
  await chmod(join(root, 'wisepen'), 0o755);
  await writeFile(join(root, 'package.json'), '{"type":"module"}');
  const bin = join(root, 'dist', 'cli.js');
  const requests = [];
  const server = createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const url = new URL(req.url, 'http://localhost');
    let body; try { body = raw ? JSON.parse(raw) : undefined; } catch { body = raw; }
    const call = { url, method: req.method, headers: req.headers, body }; requests.push(call);
    const send = (data, code = 200, http = 200) => { res.writeHead(http, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ code, msg: null, data })); };
    try {
      if (await handler(call, send, res)) return;
      if (url.pathname === '/user/getUserInfo') return send({ userId: 'u1', userInfo: { username: 'test' } });
      if (url.pathname === '/resource/tag/getTagTree') return send(tags);
      if (url.pathname === '/resource/item/getResourceBaseInfo') return send(r(url.searchParams.get('resourceId')));
      if (url.pathname === '/resource/item/listResources') return send(javaPage([r()]));
      if (url.pathname === '/chat/model/listUserProviders') return send({ providers: [provider] });
      send(null, 404, 404);
    } catch (error) { res.writeHead(500); res.end(String(error)); }
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const apiUrl = `http://127.0.0.1:${server.address().port}`;
  await writeFile(join(root, 'wisepen.json'), JSON.stringify({ version: 1, apiUrl, webUrl: 'https://view.example.com' }));
  await writeFile(join(dir, 'auth.json'), JSON.stringify({ version: 1, apiUrl, userId: 'u1', token, loggedInAt: new Date().toISOString() }));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rm(root, { recursive: true, force: true }); });
  const run = (args, opts = {}) => new Promise((resolveResult, reject) => {
    let executable = process.execPath; let argv = [bin, ...args, '--json'];
    if (opts.launcher === 'bash') { executable = process.platform === 'win32' ? join(process.env.ProgramFiles || 'C:/Program Files', 'Git/bin/bash.exe') : '/bin/bash'; argv = ['--noprofile', '--norc', join(root, 'wisepen').replace(/\\/g, '/'), ...args, '--json']; }
    if (opts.launcher === 'posix') { executable = join(root, 'wisepen'); argv = [...args, '--json']; }
    if (opts.launcher === 'cmd') { executable = process.env.ComSpec || 'cmd.exe'; argv = ['/d', '/s', '/c', '"' + [join(root, 'wisepen.cmd'), ...args, '--json'].map(x => '"' + x + '"').join(' ') + '"']; }
    if (opts.launcher === 'powershell') { executable = 'powershell.exe'; argv = ['-NoProfile', '-Command', '& ' + [join(root, 'wisepen.cmd'), ...args, '--json'].map(x => "'" + x.replace(/'/g, "''") + "'").join(' ') + '; exit $LASTEXITCODE']; }
    const child = spawn(executable, argv, { cwd: opts.cwd, env: { ...process.env, ...opts.env }, windowsVerbatimArguments: opts.launcher === 'cmd', windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', part => { stdout += part; }); child.stderr.on('data', part => { stderr += part; }); child.on('error', reject);
    const timer = setTimeout(() => { child.kill(); reject(new Error('CLI timed out')); }, 15000);
    child.on('close', code => { clearTimeout(timer); try { resolveResult({ code, data: JSON.parse(stdout), stdout, stderr }); } catch { reject(new Error(`Invalid output: ${stdout} / ${stderr}`)); } });
    child.stdin.end(opts.stdin ?? '');
  });
  return { dir, root, apiUrl, server, requests, run };
}
test('命令发现、JSON help 和无效参数均输出一个 envelope', async t => {
  const f = await fixture(t);
  const help = await f.run(['--help']); assert.equal(help.code, 0); assert.match(help.data.data.help, /WisePen/);
  const version = await f.run(['--version']); assert.equal(version.code, 0); assert.equal(version.data.data.version, '0.2.0');
  const schema = await f.run(['schema', '--command', 'resource show']); assert.equal(schema.code, 0); assert.equal(schema.data.data.commands[0].name, 'resource show');
  const caps = await f.run(['schema']); assert.equal(caps.data.data.commands.length, 56); assert.ok(!schema.data.data.endpoints);
  const bad = await f.run(['resource', 'show', '--unknown']); assert.equal(bad.code, 2); assert.equal(bad.data.ok, false); assert.equal(bad.stderr, '');
});
test('文件凭据绑定服务，忽略旧环境变量，header 不添加 Bearer', async t => {
  const f = await fixture(t);
  const ok = await f.run(['auth', 'status'], { env: { WISEPEN_SESSION: 'ignored-secret', WISEPEN_API_URL: 'https://other.example.com', WISEPEN_CONFIG_DIR: 'unavailable' } });
  assert.equal(ok.code, 0); assert.equal(f.requests[0].headers.authorization, token); assert.ok(!ok.stdout.includes(token));
  const saved = JSON.parse(await readFile(join(f.dir, 'auth.json'), 'utf8')); saved.apiUrl = 'https://other.example.com';
  await writeFile(join(f.dir, 'auth.json'), JSON.stringify(saved));
  const bad = await f.run(['auth', 'status']); assert.equal(bad.code, 3); assert.equal(f.requests.length, 1);
});
test('没有包配置时使用内置服务和包内 data', async t => {
  const f = await fixture(t); await rm(join(f.root, 'wisepen.json'));
  const out = await f.run(['login', '--dry-run']); assert.equal(out.code, 0); assert.equal(out.data.data.apiUrl, 'https://api.wisepen.oriole.cn');
  const listed = await f.run(['config', 'show'], { cwd: tmpdir() });
  assert.equal(listed.data.data.dataDir, f.dir); assert.equal(listed.data.data.webUrl, 'https://wisepen.oriole.cn');
});
test('plaintext 登录可供后续独立进程复用且不保存密码', async t => {
  const f = await fixture(t, (q, send) => { if (q.url.pathname === '/auth/login') { assert.equal(q.body.password, 'fixture-password'); send(token); return true; } });
  const env = {};
  const login = await f.run(['login', '--account', 'test', '--password', 'fixture-password'], { env });
  assert.equal(login.code, 0); assert.equal(login.data.data.storage, 'plaintext-file');
  const saved = JSON.parse(await readFile(join(f.dir, 'auth.json'), 'utf8')); assert.equal(saved.token, token); assert.ok(!JSON.stringify(saved).includes('fixture-password'));
  const who = await f.run(['auth', 'status'], { env }); assert.equal(who.code, 0); assert.equal(who.data.data.user.userId, 'u1');
});
test('路径解析保留大整数 ID，重名返回候选项', async t => {
  let duplicate = false; const f = await fixture(t, (q, send) => { if (q.url.pathname.endsWith('/listResources')) { send(javaPage(duplicate ? [r(), r('2')] : [r()])); return true; } });
  const one = await f.run(['resource', 'show', '--path', '/研究/文档.pdf']); assert.equal(one.code, 0); assert.equal(one.data.data.resource.resourceId, '9007199254740993123');
  assert.equal(f.requests.find(q => q.url.pathname.endsWith('/listResources')).url.searchParams.get('tagIds'), 'work');
  duplicate = true; const bad = await f.run(['resource', 'show', '--path', '/研究/文档.pdf']); assert.equal(bad.code, 6); assert.equal(bad.data.error.details.candidates.length, 2);
});
test('小组重名解析会检查全部分页', async t => {
  const f = await fixture(t, (q, send) => { if (q.url.pathname === '/group/list') { const page = Number(q.url.searchParams.get('page')); send(javaPage([{ groupId: String(page), groupName: '小组', groupType: 1 }], page, 2, 2)); return true; } });
  const out = await f.run(['group', 'show', '--group', '小组']); assert.equal(out.code, 6); assert.equal(f.requests.length, 2);
});
test('dry-run 不写入，JSON 破坏性操作缺少 yes 时失败', async t => {
  const f = await fixture(t);
  const preview = await f.run(['resource', 'trash', '--id', 'r1', '--dry-run']); assert.equal(preview.code, 0); assert.equal(preview.data.data.dryRun, true);
  const missing = await f.run(['resource', 'trash', '--id', 'r1']); assert.equal(missing.code, 2); assert.ok(f.requests.every(q => q.method === 'GET'));
});
test('写请求失败不重试，报告不确定结果；只读失败可以重试', async t => {
  const f = await fixture(t, (q, send) => { if (q.url.pathname.endsWith('/renameResource')) { send(null, 500, 500); return true; } });
  const out = await f.run(['resource', 'rename', '--id', 'r1', '--name', '新名']); assert.equal(out.code, 11); assert.equal(out.data.meta.outcome, 'unknown'); assert.equal(f.requests.filter(q => q.method === 'POST').length, 1);
});
test('畸形接口数据不会变成空列表成功', async t => {
  const f = await fixture(t, (q, send) => { if (q.url.pathname.endsWith('/listSessions')) { send({ list: [], total: '0' }); return true; } });
  const out = await f.run(['session', 'list']); assert.equal(out.code, 8); assert.equal(out.data.error.code, 'INVALID_RESPONSE');
});
test('历史导出倒转页序但保留页内顺序，已有文件不覆盖', async t => {
  const f = await fixture(t, (q, send) => { if (q.url.pathname.endsWith('/listHistoryMessages')) { const page = Number(q.url.searchParams.get('page')); send(pythonPage(page === 1 ? [msg('new', '最新')] : [msg('old1', '旧1'), msg('old2', '旧2')], page, 2, 3)); return true; } });
  const path = join(f.dir, 'history.json'); const out = await f.run(['session', 'export', '--id', 's1', '--output', path]); assert.equal(out.code, 0);
  const saved = JSON.parse(await readFile(path, 'utf8')); assert.equal(saved.sessionId, 's1'); assert.deepEqual(saved.messages.map(m => m.id), ['old1', 'old2', 'new']);
  const again = await f.run(['session', 'export', '--id', 's1', '--output', path]); assert.equal(again.code, 6); assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), saved);
});
test('会话重命名的 session_id 在 query，标题在 body', async t => {
  const f = await fixture(t, (q, send) => { if (q.url.pathname.endsWith('/renameSession')) { send(session('s1', q.body.new_title)); return true; } });
  const out = await f.run(['session', 'rename', '--id', 's1', '--name', '新标题']); assert.equal(out.code, 0);
  const q = f.requests[0]; assert.equal(q.url.searchParams.get('session_id'), 's1'); assert.deepEqual(q.body, { new_title: '新标题' });
});
test('供应商密钥通过 stdin 读取；创建后查询失败不会重复创建', async t => {
  let created = false; const key = 'fixture-api-secret';
  const f = await fixture(t, (q, send) => {
    if (q.url.pathname.endsWith('/listUserProviders')) { if (created) send(null, 500, 500); else send({ providers: [] }); return true; }
    if (q.url.pathname.endsWith('/createUserProvider')) { assert.equal(q.body.api_key, key); created = true; send(''); return true; }
  });
  const out = await f.run(['provider', 'create', '--name', '测试', '--type', 'OPENAI', '--api-key-stdin'], { stdin: key });
  assert.equal(out.code, 0); assert.equal(out.data.data.created, true); assert.equal(out.data.data.provider, null); assert.equal(out.data.meta.verification, 'unverified'); assert.ok(!out.stdout.includes(key)); assert.equal(f.requests.filter(q => q.method === 'POST').length, 1);
});
test('下载跨域跳转清除授权且以完整文件原子提交', async t => {
  let leaked; const target = createServer((req, res) => { leaked = req.headers.authorization || req.headers.cookie; res.end('PDF fixture bytes'); }); target.listen(0, '127.0.0.1'); await once(target, 'listening'); t.after(() => target.close());
  const f = await fixture(t, (q, _send, res) => { if (q.url.pathname === '/document/download') { res.writeHead(302, { location: `http://127.0.0.1:${target.address().port}/signed?Signature=secret` }); res.end(); return true; } });
  const path = join(f.dir, 'doc.pdf'); const out = await f.run(['doc', 'download', '--id', 'r1', '--output', path]); assert.equal(out.code, 0); assert.equal(leaked, undefined); assert.equal(await readFile(path, 'utf8'), 'PDF fixture bytes'); assert.ok(!out.stdout.includes('Signature'));
});
test('上传不泄露签名 URL、仅 PUT 对象存储、保留任务与资源区别', async t => {
  let auth; const storage = createServer((req, res) => { auth = req.headers.authorization || req.headers.cookie; req.resume(); req.on('end', () => { res.end('ok'); }); }); storage.listen(0, '127.0.0.1'); await once(storage, 'listening'); t.after(() => storage.close());
  const f = await fixture(t, (q, send) => { if (q.url.pathname === '/document/uploadDoc') { send({ documentId: 'task1', putUrl: `http://127.0.0.1:${storage.address().port}/upload?Signature=secret`, callbackHeader: 'callback-secret', objectKey: 'object1', flashUploaded: false }); return true; } });
  const file = join(f.dir, 'upload.pdf'); await writeFile(file, '%PDF-fixture'); const out = await f.run(['doc', 'upload', '--file', file, '--to', '/研究']);
  assert.equal(out.code, 0); assert.equal(out.data.data.documentId, 'task1'); assert.equal(out.data.data.resourceId, null); assert.equal(out.data.meta.outcome, 'pending'); assert.equal(auth, undefined); assert.ok(!out.stdout.includes('Signature')); assert.ok(!out.stdout.includes('callback-secret'));
  const journal = (await f.run(['doc', 'tasks'])).data.data[0]; assert.equal(journal.stage, 'transferred'); assert.equal(journal.documentId, 'task1');
});
test('上传在客户端拒绝不支持的文档格式', async t => {
  const f = await fixture(t);
  const file = join(f.dir, 'notes.txt'); await writeFile(file, 'plain text');
  const out = await f.run(['doc', 'upload', '--file', file]);
  assert.equal(out.code, 2); assert.equal(out.data.error.code, 'INVALID_INPUT');
  assert.deepEqual(out.data.error.details.supportedExtensions, ['.pdf', '.doc', '.docx', '.ppt', '.pptx', '.xls', '.xlsx']);
  assert.equal(f.requests.length, 0);
});
test('文档可以直接上传到小组目录并保留目标语义', async t => {
  const f = await fixture(t, (q, send) => {
    if (q.url.pathname === '/group/getGroupDetailInfo') { send({ groupId: 'g1', groupName: '研究组', groupType: 1 }); return true; }
    if (q.url.pathname === '/resource/tag/getTagTree' && q.url.searchParams.get('groupId') === 'g1') { send([tag('group-folder', '资料')]); return true; }
    if (q.url.pathname === '/document/uploadDoc') { assert.equal(q.body.mountTargetTagId, 'group-folder'); send({ documentId: 'group-task', putUrl: null, callbackHeader: null, objectKey: 'group-object', flashUploaded: true }); return true; }
  });
  const file = join(f.dir, 'group.pdf'); await writeFile(file, '%PDF-fixture');
  const out = await f.run(['doc', 'upload', '--file', file, '--group-id', 'g1', '--to', '/资料']);
  assert.equal(out.code, 0); assert.deepEqual(out.data.data.target, { groupId: 'g1', path: '/资料' });
  assert.equal(out.data.data.documentId, 'group-task');
  assert.equal((await f.run(['doc', 'tasks'])).data.data[0].groupId, 'g1');
});
test('pending 列表中消失不能推断文档已就绪', async t => {
  const f = await fixture(t, (q, send) => { if (q.url.pathname === '/document/listPendingDocs') { send([]); return true; } });
  const out = await f.run(['doc', 'status', '--document-id', 'task1']); assert.equal(out.code, 0); assert.equal(out.data.data.status, 'UNKNOWN'); assert.ok(f.requests.every(q => q.method === 'GET'));
});
test('note read 仅发送 SyncStep1，服务端空文档也是合法同步结果', async t => {
  const f = await fixture(t, (q, send) => { if (q.url.pathname.endsWith('/getResourceBaseInfo')) { send(r('note1', '笔记', 'NOTE')); return true; } });
  const wss = new WebSocketServer({ server: f.server }); const sent = []; let wsAuth;
  wss.on('connection', (ws, request) => { wsAuth = request.headers.authorization; ws.on('message', data => { const d = decoding.createDecoder(data); sent.push([decoding.readVarUint(d), decoding.readVarUint(d)]); const doc = new Y.Doc(); const e = encoding.createEncoder(); encoding.writeVarUint(e, 0); sync.writeSyncStep2(e, doc); ws.send(encoding.toUint8Array(e)); doc.destroy(); }); });
  t.after(() => { for (const client of wss.clients) client.terminate(); wss.close(); });
  const out = await f.run(['note', 'read', '--id', 'note1', '--experimental']); assert.equal(out.code, 0); assert.equal(wsAuth, token); assert.deepEqual(sent, [[0, 0]]); assert.deepEqual(out.data.data.content.children, []);
});
test('note write 未开放时明确失败且不发网络请求', async t => {
  const f = await fixture(t); const out = await f.run(['note', 'append', '--id', 'note1']); assert.equal(out.code, 2); assert.equal(out.data.meta.outcome, 'not-started'); assert.equal(f.requests.length, 0);
});
test('web url 保留范围参数且不包含认证凭据', async t => {
  const f = await fixture(t, (q, send) => { if (q.url.pathname.endsWith('/getGroupDetailInfo')) { send({ groupId: 'g1', groupName: '小组', groupType: 1 }); return true; } });
  const out = await f.run(['web', 'url', '--id', 'r1', '--group-id', 'g1']); assert.equal(out.code, 0); assert.match(out.data.data.url, /scope=group&groupId=g1/); assert.ok(!out.stdout.includes(token));
});
test('JSON 输出预算超限时明确失败，不静默截断', async t => {
  const f = await fixture(t, (q, send) => { if (q.url.pathname.endsWith('/getResourceBaseInfo')) { send(r('r1', 'x'.repeat(2048))); return true; } }); await f.run(['config', 'set', '--key', 'maxOutputBytes', '--value', '1024']); const out = await f.run(['resource', 'show', '--id', 'r1']); assert.equal(out.code, 6); assert.equal(out.data.error.code, 'OUTPUT_LIMIT'); assert.equal(out.data.error.details.truncated, false);
});
test('未识别的密钥参数不回显值；仅保留标准 ID 参数', async t => {
  const f = await fixture(t); const accepted = await f.run(['login', '--account', 'test', '--password=do-not-echo-this', '--dry-run']); assert.equal(accepted.code, 0); assert.ok(!accepted.stdout.includes('do-not-echo-this'));
  const good = await f.run(['resource', 'show', '--id', 'r1']); assert.equal(good.code, 0); assert.equal(good.data.data.resource.resourceId, 'r1');
});
test('模型 create/update/bind 使用实际 body 且保持 USER 范围', async t => {
  const model = { id: 'bbbbbbbbbbbbbbbbbbbbbbbb', display_name: '我的模型', scope: 'USER', is_active: true, mappings: null }; const systemModel = { id: 'cccccccccccccccccccccccc', display_name: '系统模型', scope: 'SYSTEM', is_active: true, mappings: null }; let created = false;
  const f = await fixture(t, (q, send) => {
    if (q.url.pathname.endsWith('/listModels')) { const requested = q.url.searchParams.get('model_scope'); send({ models: requested === 'SYSTEM' ? [systemModel] : created ? [model] : [] }); return true; }
    if (q.url.pathname.endsWith('/createUserModel')) { created = true; assert.equal(q.body.display_name, '我的模型'); send(null); return true; }
    if (q.url.pathname.endsWith('/updateUserModel') || q.url.pathname.endsWith('/bindModelProvider')) { send(null); return true; }
  });
  const create = await f.run(['model', 'create', '--input', '-'], { stdin: JSON.stringify({ display_name: '我的模型', model_family: 'GPT' }) }); assert.equal(create.code, 0); assert.equal(create.data.data.model.id, model.id);
  const update = await f.run(['model', 'update', '--name', '我的模型', '--input', '-'], { stdin: JSON.stringify({ patch: { context_window_tokens: 4096, is_active: false } }) }); assert.equal(update.code, 0);
  assert.deepEqual(f.requests.find(q => q.url.pathname.endsWith('/updateUserModel')).body, { context_window_tokens: 4096, is_active: false, model_id: model.id });
  const bind = await f.run(['model', 'bind', '--name', '我的模型', '--provider', provider.name, '--provider-model', 'remote-model']); assert.equal(bind.code, 0); assert.equal(f.requests.at(-1).body.provider_id, provider.id);
  const systemBind = await f.run(['model', 'bind', '--scope', 'SYSTEM', '--name', '系统模型', '--provider', provider.name, '--provider-model', 'system-remote']); assert.equal(systemBind.code, 0); assert.equal(f.requests.at(-1).body.model_id, systemModel.id);
});
test('资源数量不符报告 partial，挂载需要明确 yes', async t => {
  const f = await fixture(t, (q, send) => {
    if (q.url.pathname.endsWith('/getGroupDetailInfo')) { send({ groupId: 'g1', groupName: '小组', groupType: 1 }); return true; }
    if (q.url.pathname.endsWith('/getTagTree') && q.url.searchParams.has('groupId')) { send([tag('group-folder', '资料')]); return true; }
    if (q.url.pathname.endsWith('/mountResourcesToGroup')) { send({ resourceCount: 0 }); return true; }
  });
  const args = ['resource', 'mount', '--id', 'r1', '--target-group-id', 'g1', '--to', '/资料'];
  assert.equal((await f.run(args)).code, 2); assert.ok(f.requests.every(q => q.method === 'GET'));
  const out = await f.run([...args, '--yes']); assert.equal(out.code, 9); assert.equal(out.data.meta.outcome, 'partial'); assert.equal(out.data.error.details.affected, 0);
});
test('个人目录名称遵循斜杠前缀；根目录展示系统入口', async t => {
  const f = await fixture(t, (q, send) => { if (q.url.pathname.endsWith('/addTag')) { assert.equal(q.body.tagName, '/新目录'); assert.equal(q.body.parentId, 'root'); send('new-folder'); return true; } });
  assert.equal((await f.run(['drive', 'mkdir', '--path', '/新目录'])).code, 0);
  const listed = await f.run(['drive', 'ls']); assert.ok(listed.data.data.folders.some(x => x.name === '.Trash'));
});
test('传输超时禁止处理重试，等待超时保留 documentId 和 pending', async t => {
  const f = await fixture(t, (q, send) => {
    if (q.url.pathname.endsWith('/listPendingDocs')) { send([{ documentId: 'task1', documentStatus: { status: 'TRANSFER_TIMEOUT', errorMessage: null }, uploadMeta: {} }]); return true; }
    if (q.url.pathname.endsWith('/syncDocStatus')) { send({ status: 'UPLOADED', errorMessage: null }); return true; }
  });
  assert.equal((await f.run(['doc', 'retry', '--document-id', 'task1'])).code, 2); assert.ok(f.requests.every(q => q.method === 'GET'));
  const out = await f.run(['doc', 'wait', '--document-id', 'task1', '--max-wait', '1']); assert.equal(out.code, 124); assert.equal(out.data.meta.outcome, 'pending'); assert.equal(out.data.error.details.documentId, 'task1'); assert.equal(out.data.error.nextActions[0].command, 'doc status');
});
test('只有 WS 连接没有 SyncStep2 时不能返回空笔记成功', async t => {
  const f = await fixture(t, (q, send) => { if (q.url.pathname.endsWith('/getResourceBaseInfo')) { send(r('note1', '笔记', 'NOTE')); return true; } });
  const wss = new WebSocketServer({ server: f.server }); t.after(() => { for (const client of wss.clients) client.terminate(); wss.close(); });
  const out = await f.run(['note', 'read', '--id', 'note1', '--experimental', '--timeout', '200']); assert.equal(out.code, 7); assert.equal(out.data.error.code, 'NOTE_SYNC_TIMEOUT');
});
test('对象存储上传断开后保留任务标识且不会重新注册', async t => {
  const storage = createServer((req, _res) => { req.socket.destroy(); }); storage.listen(0, '127.0.0.1'); await once(storage, 'listening'); t.after(() => storage.close());
  const f = await fixture(t, (q, send) => { if (q.url.pathname === '/document/uploadDoc') { send({ documentId: 'task2', putUrl: `http://127.0.0.1:${storage.address().port}/upload`, callbackHeader: null, objectKey: 'o2', flashUploaded: false }); return true; } });
  const file = join(f.dir, 'upload.pdf'); await writeFile(file, '%PDF-fixture');
  const out = await f.run(['doc', 'upload', '--file', file]); assert.equal(out.code, 11); assert.equal(out.data.error.details.documentId, 'task2'); assert.equal(out.data.meta.outcome, 'unknown'); assert.equal(f.requests.filter(q => q.method === 'POST').length, 1);
  const journal = (await f.run(['doc', 'tasks'])).data.data[0]; assert.equal(journal.stage, 'registered'); assert.equal(journal.userId, 'u1');
});
test('下载中断不能覆盖已有完整文件', async t => {
  const f = await fixture(t, (q, _send, res) => { if (q.url.pathname === '/document/download') { res.writeHead(200, { 'Content-Length': '1000', 'Content-Type': 'application/pdf' }); res.write('partial'); setTimeout(() => res.destroy(), 20); return true; } });
  const file = join(f.dir, 'existing.pdf'); await writeFile(file, 'previous-file');
  const out = await f.run(['doc', 'download', '--id', 'r1', '--output', file, '--overwrite']); assert.notEqual(out.code, 0); assert.equal(await readFile(file, 'utf8'), 'previous-file'); assert.ok(!(await readdir(f.dir)).some(name => name.endsWith('.tmp')));
});
test('回合分页变化中止导出，避免伪造完整历史', async t => {
  const f = await fixture(t, (q, send) => { if (q.url.pathname.endsWith('/listHistoryMessages')) { const page = Number(q.url.searchParams.get('page')); send(pythonPage([msg(String(page), '正文')], page, 2, page === 1 ? 2 : 3)); return true; } });
  const file = join(f.dir, 'history.json'); const out = await f.run(['session', 'export', '--id', 's1', '--output', file]); assert.equal(out.code, 6); assert.equal(out.data.error.code, 'HISTORY_CHANGED'); assert.ok(!(await readdir(f.dir)).includes('history.json'));
});
test('HTTP 200 的业务鉴权错误不能当成功', async t => {
  const f = await fixture(t, (_q, send) => { send(null, 401); return true; }); const out = await f.run(['auth', 'status']); assert.equal(out.code, 3); assert.equal(out.data.error.code, 'LOGIN_REQUIRED'); assert.equal(out.data.error.details.serverCode, 401);
});
test('小组移动保留源目录映射；个人恢复只移动回收站中资源', async t => {
  const f = await fixture(t, (q, send) => {
    if (q.url.pathname.endsWith('/getGroupDetailInfo')) { send({ groupId: 'g1', groupName: '小组', groupType: 1 }); return true; }
    if (q.url.pathname.endsWith('/getTagTree') && q.url.searchParams.has('groupId')) { send([tag('source', '资料'), tag('target', '归档')]); return true; }
    if (q.url.pathname.includes('/resource/placement/')) { send({ resourceCount: 1 }); return true; }
  });
  const move = await f.run(['resource', 'move', '--group-id', 'g1', '--path', '/资料/文档.pdf', '--to', '/归档']); assert.equal(move.code, 0);
  assert.deepEqual(f.requests.find(q => q.url.pathname.endsWith('/moveResourcesInGroup')).body, { groupId: 'g1', resourceSourceTagMap: { '9007199254740993123': 'source' }, targetTagId: 'target' });
  const restore = await f.run(['resource', 'restore', '--id', '9007199254740993123', '--to', '/研究']); assert.equal(restore.code, 0); assert.deepEqual(f.requests.at(-1).body, { resourceIds: ['9007199254740993123'], targetPathTagId: 'work' });
});
test('笔记非空结构读取保留文字与未知节点，不发送 Update', async t => {
  const f = await fixture(t, (q, send) => { if (q.url.pathname.endsWith('/getResourceBaseInfo')) { send(r('note1', '笔记', 'NOTE')); return true; } });
  const wss = new WebSocketServer({ server: f.server }); const sent = [];
  wss.on('connection', ws => { ws.on('message', data => {
    const d = decoding.createDecoder(data); sent.push([decoding.readVarUint(d), decoding.readVarUint(d)]);
    const doc = new Y.Doc(); const custom = new Y.XmlElement('custom-node'); custom.setAttribute('kind', 'unknown'); const content = new Y.XmlText(); content.insert(0, '中文笔记'); custom.insert(0, [content]); doc.getXmlFragment('document-store').insert(0, [custom]);
    const e = encoding.createEncoder(); encoding.writeVarUint(e, 0); sync.writeSyncStep2(e, doc); ws.send(encoding.toUint8Array(e)); doc.destroy();
  }); });
  t.after(() => { for (const client of wss.clients) client.terminate(); wss.close(); });
  const out = await f.run(['note', 'read', '--id', 'note1', '--experimental']); assert.equal(out.code, 0); assert.equal(out.data.data.content.children[0].name, 'custom-node'); assert.equal(out.data.data.content.children[0].children[0].delta[0].insert, '中文笔记'); assert.deepEqual(sent, [[0, 0]]);
});
