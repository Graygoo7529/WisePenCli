import { z } from 'zod';
import { api } from '../contracts/api.js';
import { allPages, folder, listFolder, resolveGroup, resolveResource, segments, destination } from '../domain/resolve.js';
import { invalid } from '../errors.js';
import { define, text, number, pagination, pageOptions, selector, selectorOptions } from './registry.js';

const groupFields = { group: z.string().optional(), groupId: z.string().optional() };
const groupOptions: [string, string][] = [['--group <name>', '小组精确名称'], ['--group-id <id>', '小组 ID']];
define({ name: 'group list', description: '分页列出可见小组', effect: 'read', input: z.strictObject({ ...pagination, role: z.enum(['ALL', 'JOINED', 'MANAGED']).default('ALL'), type: z.enum(['NORMAL_GROUP', 'ADVANCED_GROUP', 'MARKET_GROUP']).optional() }), options: [...pageOptions, ['--role <role>', 'ALL/JOINED/MANAGED'], ['--type <type>', '小组类型枚举']], run: async (ctx, i) => (await ctx.api()).call(api.groups, { page: i.page, size: i.size, groupRoleFilter: i.role, groupType: i.type }) });
define({ name: 'group show', description: '查看小组详情', effect: 'read', input: z.strictObject(groupFields), options: groupOptions, run: async (ctx, i) => {
  const groupId = await resolveGroup(ctx, i); if (!groupId) invalid('需要 --group 或 --group-id。');
  return (await ctx.api()).call(api.group, { groupId });
} });
define({ name: 'drive ls', description: '列出个人或小组目录', effect: 'read', input: z.strictObject({ path: z.string().default('/'), ...groupFields, ...pagination }), options: [['--path <path>', '远端目录，默认 /'], ...groupOptions, ...pageOptions], run: async (ctx, i) => {
  const dir = await folder(ctx, text(i, 'path'), await resolveGroup(ctx, i));
  return { location: { path: dir.path, groupId: dir.groupId ?? null, tagId: dir.tagId ?? null, kind: !dir.tagId ? 'group-root' : dir.system ? 'system' : 'folder', canMount: !!dir.tagId && !dir.system }, folders: dir.children.map(t => ({ id: t.tagId, name: t.tagName.startsWith('/') ? t.tagName.slice(1) : t.tagName })), resources: await listFolder(ctx, dir, number(i, 'page'), number(i, 'size')) };
} });
define({ name: 'drive mkdir', description: '创建一个目录', effect: 'write', input: z.strictObject({ path: z.string(), ...groupFields }), options: [['--path <path>', '新目录完整路径'], ...groupOptions], run: async (ctx, i) => {
  const path = text(i, 'path'); const parts = segments(path); const name = parts.pop(); if (!name || name.startsWith('.')) invalid('新目录名称不能为空或使用系统目录名。');
  const groupId = await resolveGroup(ctx, i); const parent = await folder(ctx, '/' + parts.join('/'), groupId);
  if (parent.system) invalid('不能在系统目录中创建子目录。');
  if (parent.children.some(t => t.tagName === name || t.tagName === '/' + name)) invalid('同名目录已存在。');
  const body = { groupId, parentId: parent.tagId, tagName: groupId ? name : '/' + name };
  return ctx.write({ action: 'create-folder', path, body }, async () => ({ tagId: await (await ctx.api()).call(api.addTag, body), path }));
} });
define({ name: 'drive rename', description: '重命名目录', effect: 'write', input: z.strictObject({ path: z.string(), name: z.string().min(1), ...groupFields }), options: [['--path <path>', '现有目录路径'], ['--name <name>', '新目录名称'], ...groupOptions], run: async (ctx, i) => {
  const dir = await folder(ctx, text(i, 'path'), await resolveGroup(ctx, i)); const name = text(i, 'name');
  if (dir.path === '/' || name.includes('/') || name.includes('\\') || name.startsWith('.')) invalid('根目录或目标名称不允许重命名。');
  const targetTagId = destination(dir); const body = { groupId: dir.groupId, targetTagId, tagName: dir.groupId ? name : '/' + name };
  return ctx.write(body, async () => { await (await ctx.api()).call(api.renameTag, body); return { tagId: targetTagId, name }; });
} });
define({ name: 'drive move', description: '在同一空间内移动目录', effect: 'write', input: z.strictObject({ path: z.string(), to: z.string(), ...groupFields }), options: [['--path <path>', '源目录'], ['--to <path>', '目标父目录'], ...groupOptions], run: async (ctx, i) => {
  const groupId = await resolveGroup(ctx, i); const source = await folder(ctx, text(i, 'path'), groupId); const target = await folder(ctx, text(i, 'to'), groupId);
  if (source.path === '/' || target.path === source.path || target.path.startsWith(source.path + '/')) invalid('不能移动根目录，或将目录移动到自身/后代目录。');
  const body = { groupId, targetTagIds: [destination(source)], newParentId: target.tagId ? destination(target) : undefined };
  return ctx.write(body, async () => { await (await ctx.api()).call(api.moveTag, body); return body; });
} });
define({ name: 'resource show', description: '按路径或 ID 查看资源', effect: 'read', input: z.strictObject(selector), options: selectorOptions, run: resolveResource });
define({ name: 'search', description: '全局搜索可访问资源', effect: 'read', input: z.strictObject({ query: z.string().min(1), scope: z.enum(['ALL', 'DOCUMENT', 'NOTE']).default('ALL'), ...pagination }), options: [['--query <text>', '关键词'], ['--scope <scope>', 'ALL/DOCUMENT/NOTE'], ...pageOptions], run: async (ctx, i) => (await ctx.api()).call(api.search, { keyword: i.query, scope: i.scope, page: i.page, size: i.size }) });
define({ name: 'resource rename', description: '重命名资源', effect: 'write', input: z.strictObject({ ...selector, name: z.string().min(1) }), options: [...selectorOptions, ['--name <name>', '新名称']], run: async (ctx, i) => {
  const r = await resolveResource(ctx, i); const body = { resourceId: r.resource.resourceId, newName: i.name };
  return ctx.write(body, async () => { await (await ctx.api()).call(api.renameResource, body); return { ...body, resource: await ctx.verify(async () => (await ctx.api()).call(api.resource, { resourceId: body.resourceId })) }; });
} });
for (const operation of ['move', 'restore', 'mount', 'unmount', 'trash', 'delete'] as const) {
  const needsTo = ['move', 'restore', 'mount'].includes(operation);
  define({ name: `resource ${operation}`, description: ({ move: '同空间移动资源', restore: '从回收站恢复到个人目录', mount: '挂载资源到指定小组目录', unmount: '卸载指定小组目录中的挂载', trash: '移入个人回收站并清理分享', delete: '永久删除资源' })[operation], effect: 'write', input: z.strictObject({ ...selector, ...(needsTo ? { to: z.string() } : {}), ...(operation === 'mount' ? { targetGroup: z.string().optional(), targetGroupId: z.string().optional() } : {}), ...(['move', 'unmount'].includes(operation) ? { sourceTagId: z.string().optional() } : {}) }), options: [...selectorOptions, ...(needsTo ? [['--to <path>', '目标目录路径']] as [string, string][] : []), ...(operation === 'mount' ? [['--target-group <name>', '目标小组名称'], ['--target-group-id <id>', '目标小组 ID']] as [string, string][] : []), ...(['move', 'unmount'].includes(operation) ? [['--source-tag-id <id>', '按资源 ID 操作小组挂载时的源目录 ID']] as [string, string][] : [])], run: async (ctx, i) => {
    const located = await resolveResource(ctx, i); const resourceId = located.resource.resourceId;
    const client = await ctx.api();
    if (operation === 'trash' || operation === 'restore' || operation === 'delete') {
      if (located.groupId) invalid('此操作针对个人资源，请先选择个人空间。');
      const me = await client.call(api.me); if (located.resource.ownerId !== me.userId) invalid('此操作仅允许对当前用户拥有的资源执行。');
    }
    if (operation === 'trash' || operation === 'delete') return ctx.write({ action: operation, resourceId }, async () => { const result = operation === 'trash' ? await client.call(api.trash, { resourceIds: [resourceId] }) : await client.call(api.removeResource, { resourceIds: [resourceId] }); return { action: operation, resourceId, result }; }, operation === 'trash' ? '移入回收站会移除非个人挂载与分享授权；恢复不会恢复分享' : '永久删除资源，无法通过回收站恢复');
    let groupId = located.groupId;
    if (operation === 'mount') { groupId = await resolveGroup(ctx, { group: i.targetGroup, groupId: i.targetGroupId }); if (!groupId) invalid('挂载需要 --target-group 或 --target-group-id。'); }
    if (operation === 'unmount' || (operation === 'move' && groupId)) {
      if (!groupId) invalid('卸载需要指定小组。');
      const sourceTagId = located.sourceTagId ?? i.sourceTagId;
      if (!sourceTagId) invalid('小组挂载操作需要源路径，或 --source-tag-id。');
      const sourceItems = await allPages(page => client.call(api.resources, { page, size: 100, groupId, tagIds: [sourceTagId], tagQueryLogicMode: 'AND', sortBy: 'NAME', sortDir: 'ASC' }));
      if (!sourceItems.some(r => r.resourceId === resourceId)) invalid('资源不在指定的小组源目录中。');
      const body = { groupId, resourceSourceTagMap: { [resourceId]: String(sourceTagId) } };
      if (operation === 'unmount') return ctx.write(body, async () => client.call(api.unmount, body), '移除指定小组目录中的挂载');
      const targetTagId = destination(await folder(ctx, text(i, 'to'), groupId));
      return ctx.write({ ...body, targetTagId }, async () => client.call(api.groupMove, { ...body, targetTagId }));
    }
    const targetTagId = destination(await folder(ctx, text(i, 'to'), groupId));
    if (operation === 'restore') {
      const trash = await folder(ctx, '/.Trash');
      const trashed = located.sourceTagId === trash.tagId || (await allPages(page => listFolder(ctx, trash, page, 100))).some(r => r.resourceId === resourceId);
      if (!trashed) invalid('资源当前不在个人回收站中。');
      ctx.warnings.push('仅恢复个人目录位置；已移除的小组挂载和分享授权不会自动恢复。');
    }
    const body = { resourceIds: [resourceId], ...(operation === 'mount' ? { groupId, targetTagId } : { targetPathTagId: targetTagId }) };
    return ctx.write(body, async () => operation === 'mount' ? client.call(api.mount, body) : client.call(api.personalMove, body), operation === 'mount' ? '将资源挂载到小组目录，可能按该目录策略扩大可见范围' : undefined);
  } });
}
