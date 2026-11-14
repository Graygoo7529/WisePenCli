import { z } from 'zod';
import { resolveResource, resolveSession } from '../domain/resolve.js';
import { define, selector, selectorOptions } from './registry.js';

define({ name: 'web url', description: '生成网页链接，供用户或 browser use 打开', effect: 'read', input: z.strictObject({ ...selector, target: z.enum(['resource', 'session', 'ai-settings', 'home']).default('resource'), title: z.string().optional() }), options: [...selectorOptions, ['--target <kind>', 'resource/session/ai-settings/home'], ['--title <title>', '会话标题（session 目标）']], run: async (ctx, i) => {
  const settings = await ctx.settings(); let route = '/'; const query: Record<string, string> = {};
  if (i.target === 'resource') {
    const r = await resolveResource(ctx, i); route = `/resources/${encodeURIComponent(r.resource.resourceType)}/${encodeURIComponent(r.resource.resourceId)}`;
    if (r.groupId) { query.scope = 'group'; query.groupId = r.groupId; if (r.sourceTagId) query.tagId = r.sourceTagId; }
  } else if (i.target === 'session') route = `/chat/${encodeURIComponent(await resolveSession(ctx, { id: i.id, title: i.title }))}`;
  else if (i.target === 'ai-settings') route = '/profile/ai';
  const url = new URL(settings.webUrl + route); for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  return { url: url.toString(), requiresBrowserSession: true };
} });
