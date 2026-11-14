import { api, type Tag, type Resource } from '../contracts/api.js';
import type { Context } from '../runtime/context.js';
import { CliError, invalid } from '../errors.js';

export function unique<T>(items: T[], description: string, choices: (item: T) => unknown): T {
  if (!items.length) throw new CliError('NOT_FOUND', `${description}不存在或不可访问。`, 5);
  if (items.length !== 1) throw new CliError('AMBIGUOUS_NAME', `${description}不唯一，请使用明确 ID。`, 6, { candidates: items.map(choices) });
  return items[0]!;
}
export async function allPages<T>(fetchPage: (page: number) => Promise<{ list: T[]; totalPage?: number; total_page?: number }>): Promise<T[]> {
  const result: T[] = [];
  for (let page = 1; page <= 1000; page++) {
    const response = await fetchPage(page); result.push(...response.list);
    if (page >= (response.totalPage ?? response.total_page ?? 1)) return result;
  }
  throw new CliError('RESOLUTION_LIMIT', '查询超过 1000 页，请使用明确 ID 或缩小范围。', 6);
}
export async function resolveGroup(ctx: Context, input: Record<string, unknown>): Promise<string | undefined> {
  if (input.group && input.groupId) invalid('--group 与 --group-id 不能同时指定。');
  const client = await ctx.api();
  if (input.groupId) { const g = await client.call(api.group, { groupId: input.groupId }); return g.groupId; }
  if (!input.group) return undefined;
  const items = await allPages(page => client.call(api.groups, { page, size: 100, groupRoleFilter: 'ALL' }));
  return unique(items.filter(g => g.groupName === input.group), '小组名称', g => ({ id: g.groupId, name: g.groupName })).groupId;
}
export function segments(path: string): string[] {
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\') || path.includes('\0')) invalid('远端路径应为 / 或 /目录/名称，不能使用盘符、UNC 或反斜杠。Git Bash 请用 ./wisepen 启动，避免远端路径被 shell 转换。');
  const parts = path.split('/').filter(Boolean);
  if (parts.some(p => p === '.' || p === '..')) invalid('远端路径不接受 . 或 ..。');
  return parts;
}
const tagLabel = (tag: Tag): string => tag.tagName.startsWith('/') ? tag.tagName.slice(1) : tag.tagName;
export type Folder = { groupId?: string; tagId?: string; path: string; children: Tag[]; system: boolean };
export async function folder(ctx: Context, path: string, groupId?: string): Promise<Folder> {
  const parts = segments(path);
  const tree = await (await ctx.api()).call(api.tags, { groupId });
  const system = !groupId && !!parts[0]?.startsWith('.');
  let current: Tag | undefined;
  let children = tree;
  if (!groupId) {
    const root = unique(tree.filter(t => t.tagName === '/'), '个人根目录', t => ({ id: t.tagId, name: t.tagName }));
    current = root; children = root.children ?? [];
    if (parts[0]?.startsWith('.')) { current = unique(tree.filter(t => t.tagName === parts[0]), '系统目录', t => ({ id: t.tagId, name: t.tagName })); parts.shift(); children = current.children ?? []; }
  }
  for (const part of parts) {
    current = unique(children.filter(t => tagLabel(t) === part), `目录 ${part}`, t => ({ id: t.tagId, name: t.tagName }));
    children = current.children ?? [];
  }
  if (!groupId && segments(path).length === 0) children = [...tree.filter(t => ['.Shared', '.Note', '.Page', '.Trash'].includes(t.tagName)), ...children];
  return { groupId, tagId: current?.tagId, path: '/' + segments(path).join('/'), children, system };
}
export function destination(dir: Folder): string {
  if (!dir.tagId) throw new CliError('GROUP_ROOT_NOT_MOUNTABLE', '小组 / 是目录入口，不能直接挂载资源；请选择子目录，或先创建 /资料。', 2, { groupId: dir.groupId, path: dir.path, candidates: dir.children.map(t => ({ tagId: t.tagId, path: '/' + tagLabel(t) })) });
  if (dir.system) invalid('目标不能是系统目录，请使用 trash 等对应业务命令。');
  return dir.tagId;
}
export async function listFolder(ctx: Context, dir: Folder, page = 1, size = 50) {
  if (!dir.tagId) return { list: [], total: 0, page, size, totalPage: 0 };
  return (await ctx.api()).call(api.resources, { page, size, groupId: dir.groupId, tagIds: [dir.tagId], tagQueryLogicMode: 'AND', sortBy: 'NAME', sortDir: 'ASC' });
}
export type LocatedResource = { resource: Resource; groupId?: string; sourceTagId?: string; path?: string };
export async function resolveResource(ctx: Context, input: Record<string, unknown>): Promise<LocatedResource> {
  if (input.id && input.path) invalid('--id 与 --path 不能同时指定。');
  if (!input.id && !input.path) invalid('需要 --path 或 --id。');
  const groupId = await resolveGroup(ctx, input);
  if (input.id) return { resource: await (await ctx.api()).call(api.resource, { resourceId: input.id }), groupId };
  const parts = segments(String(input.path)); const name = parts.pop();
  if (!name) invalid('请指定资源路径，根目录不是资源。');
  const dir = await folder(ctx, '/' + parts.join('/'), groupId);
  const items = await allPages(page => listFolder(ctx, dir, page, 100));
  return { resource: unique(items.filter(r => r.resourceName === name), '资源名称', r => ({ id: r.resourceId, name: r.resourceName, type: r.resourceType })), groupId, sourceTagId: dir.tagId, path: String(input.path) };
}
export async function resolveSession(ctx: Context, input: Record<string, unknown>): Promise<string> {
  if (!!input.id === !!input.title) invalid('请指定 --id 或 --title 其中之一。');
  if (input.id) return String(input.id);
  const client = await ctx.api();
  const items = await allPages(page => client.call(api.sessions, { page, size: 100 }));
  return unique(items.filter(s => s.title === input.title), '会话标题', s => ({ id: s.id, title: s.title })).id;
}
