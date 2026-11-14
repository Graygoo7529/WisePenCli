import { z } from 'zod';
export const id = z.string().min(1);
export const nonblank = z.string().trim().min(1);
export const pageInput = { page: z.number().int().min(1), size: z.number().int().min(1).max(100) };
export const empty = z.union([z.null(), z.literal('')]);
export const object = z.record(z.string(), z.unknown());
export const resource = z.object({ resourceId: id, resourceName: id, resourceType: id, ownerId: id.optional(), currentActions: z.array(z.string()).optional(), tagBinds: z.array(object).optional() }).passthrough();
export type Resource = z.infer<typeof resource>;
export const group = z.object({ groupId: id, groupName: id, groupType: z.number() }).passthrough();
export const user = z.object({ userId: id, userInfo: z.object({ username: id }).passthrough() }).passthrough();
export type Tag = { tagId: string; parentId: string; tagName: string; isPath: boolean; children: Tag[] | null; [key: string]: unknown };
export const tag: z.ZodType<Tag> = z.lazy(() => z.object({ tagId: id, parentId: id, tagName: id, isPath: z.boolean(), children: z.array(tag).nullable() }).passthrough());
const totalLong = z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().nonnegative().refine(Number.isSafeInteger));
export const javaPage = <T>(item: z.ZodType<T>) => z.object({ list: z.array(item), total: totalLong, page: z.number().int(), size: z.number().int(), totalPage: z.number().int() });
export const pythonPage = <T>(item: z.ZodType<T>) => z.object({ list: z.array(item), total: z.number().int(), page: z.number().int(), size: z.number().int(), total_page: z.number().int() });
export const session = z.object({ id, title: id, created_at: z.string(), updated_at: z.string() }).passthrough();
export const message = z.object({ id, role: z.enum(['user', 'assistant', 'system']), parts: z.array(z.object({ type: id }).passthrough()), createdAt: z.string().nullable() }).passthrough();
export const status = z.object({ status: z.enum(['UPLOADING', 'UPLOADED', 'CONVERTING_AND_PARSING', 'REGISTERING_RES', 'READY', 'TRANSFER_TIMEOUT', 'REGISTERING_RES_TIMEOUT', 'FAILED']), errorMessage: z.string().nullable() });
export const pendingDoc = z.object({ documentId: id.optional(), documentStatus: status, uploadMeta: object }).passthrough();
export const resourceIdInput = z.strictObject({ resourceId: id });
export const docIdInput = z.strictObject({ documentId: id });
export interface Endpoint<T = unknown> { method: 'GET' | 'POST' | 'PUT'; path: string; request: z.ZodType; response: z.ZodType<T>; query?: readonly string[] | true; auth: boolean; readOnly: boolean }
export function endpoint<T>(method: Endpoint['method'], path: string, request: z.ZodType, response: z.ZodType<T>, options: Partial<Pick<Endpoint<T>, 'query' | 'auth' | 'readOnly'>> = {}): Endpoint<T> {
  return { method, path, request, response, auth: true, readOnly: method === 'GET', query: method === 'GET' ? true : undefined, ...options };
}
const noInput = z.strictObject({});
const idsInput = z.strictObject({ resourceIds: z.array(id).min(1) });
const count = z.object({ resourceCount: z.number().int().nonnegative() });
const groupIdInput = z.strictObject({ groupId: id });
export const api = {
  login: endpoint('POST', '/auth/login', z.strictObject({ account: nonblank, password: id }), id, { auth: false }),
  logout: endpoint('POST', '/auth/logout', noInput, empty),
  me: endpoint('GET', '/user/getUserInfo', noInput, user),
  groups: endpoint('GET', '/group/list', z.strictObject({ ...pageInput, groupRoleFilter: z.enum(['ALL', 'JOINED', 'MANAGED']), groupType: z.enum(['NORMAL_GROUP', 'ADVANCED_GROUP', 'MARKET_GROUP']).optional() }), javaPage(group)),
  group: endpoint('GET', '/group/getGroupDetailInfo', groupIdInput, group),
  members: endpoint('GET', '/group/member/list', z.strictObject({ ...pageInput, groupId: id }), javaPage(z.object({ memberId: id, role: z.number() }).passthrough())),
  tags: endpoint('GET', '/resource/tag/getTagTree', z.strictObject({ groupId: id.optional() }), z.array(tag)),
  addTag: endpoint('POST', '/resource/tag/addTag', z.strictObject({ groupId: id.optional(), parentId: id.optional(), tagName: nonblank }), id),
  renameTag: endpoint('POST', '/resource/tag/changeTag', z.strictObject({ groupId: id.optional(), targetTagId: id, tagName: nonblank }), empty),
  moveTag: endpoint('POST', '/resource/tag/moveTags', z.strictObject({ groupId: id.optional(), targetTagIds: z.array(id).min(1), newParentId: id.optional() }), empty),
  resources: endpoint('GET', '/resource/item/listResources', z.strictObject({ ...pageInput, groupId: id.optional(), tagIds: z.array(id).optional(), tagQueryLogicMode: z.enum(['AND', 'OR']), resourceType: id.optional(), sortBy: z.enum(['UPDATE_TIME', 'CREATE_TIME', 'NAME', 'SIZE']), sortDir: z.enum(['ASC', 'DESC']) }), javaPage(resource)),
  resource: endpoint('GET', '/resource/item/getResourceBaseInfo', resourceIdInput, resource),
  search: endpoint('GET', '/resource/search/globalSearchResources', z.strictObject({ ...pageInput, keyword: z.string(), scope: z.enum(['ALL', 'DOCUMENT', 'NOTE']), resourceTypes: z.array(id).optional() }), javaPage(resource)),
  renameResource: endpoint('POST', '/resource/item/renameResource', z.strictObject({ resourceId: id, newName: nonblank }), empty),
  removeResource: endpoint('POST', '/resource/item/removeResources', idsInput, empty),
  personalMove: endpoint('POST', '/resource/placement/setPersonalResourcesPathTag', idsInput.extend({ targetPathTagId: id }), count),
  trash: endpoint('POST', '/resource/placement/movePersonalResourcesToTrash', idsInput, count),
  mount: endpoint('POST', '/resource/placement/mountResourcesToGroup', idsInput.extend({ groupId: id, targetTagId: id }), count),
  unmount: endpoint('POST', '/resource/placement/unmountResourcesToGroup', z.strictObject({ groupId: id, resourceSourceTagMap: z.record(id, id) }), count),
  groupMove: endpoint('POST', '/resource/placement/moveResourcesInGroup', z.strictObject({ groupId: id, resourceSourceTagMap: z.record(id, id), targetTagId: id }), count),
  sessions: endpoint('GET', '/chat/session/listSessions', z.strictObject(pageInput), pythonPage(session)),
  history: endpoint('GET', '/chat/session/listHistoryMessages', z.strictObject({ ...pageInput, session_id: id }), pythonPage(message)),
  renameSession: endpoint('POST', '/chat/session/renameSession', z.strictObject({ session_id: id, new_title: nonblank }), session, { query: ['session_id'] }),
  deleteSession: endpoint('POST', '/chat/session/deleteSession', z.strictObject({ session_id: id }), empty, { query: true }),
  upload: endpoint('POST', '/document/uploadDoc', z.strictObject({ filename: nonblank, extension: z.enum(['pdf', 'doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx']), md5: z.string().regex(/^[a-f\d]{32}$/), expectedSize: z.number().int().min(1).max(104857600), mountTargetTagId: id.optional() }), z.object({ documentId: id, putUrl: z.string().nullable(), callbackHeader: z.string().nullable(), objectKey: id, flashUploaded: z.boolean() })),
  pending: endpoint('GET', '/document/listPendingDocs', noInput, z.array(pendingDoc)),
  refresh: endpoint('POST', '/document/syncDocStatus', docIdInput, status, { query: true }),
  retryDoc: endpoint('POST', '/document/retryDocProcess', docIdInput, empty, { query: true }),
  cancelDoc: endpoint('POST', '/document/cancelDocProcess', docIdInput, empty, { query: true }),
  docInfo: endpoint('GET', '/document/getDocInfo', resourceIdInput, z.object({ resourceInfo: resource, documentVersionInfo: z.object({ documentStatus: status }).passthrough().nullable() }).passthrough()),
  noteCreate: endpoint('POST', '/note/addNote', z.strictObject({ title: nonblank, resourceType: z.literal('NOTE'), mountTargetTagId: id.optional() }), id),
  noteInfo: endpoint('GET', '/note/getNoteInfo', resourceIdInput, z.object({ resourceInfo: resource, version: z.number().int() }).passthrough()),
  noteVersions: endpoint('GET', '/note/listNoteVersions', z.strictObject({ ...pageInput, resourceId: id }), javaPage(z.object({ version: z.number().int(), type: id }).passthrough())),
  noteFork: endpoint('POST', '/note/forkNote', z.strictObject({ resourceId: id, forkedResourceVersion: z.number().int().positive().optional(), forkedResourceName: nonblank.optional() }), id),
};
