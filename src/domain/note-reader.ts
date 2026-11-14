import * as Y from 'yjs';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import * as sync from 'y-protocols/sync';
import WebSocket from 'ws';
import type { Context } from '../runtime/context.js';
import { CliError } from '../errors.js';

function tree(node: Y.XmlFragment | Y.XmlElement | Y.XmlText | Y.XmlHook): unknown {
  if (node instanceof Y.XmlHook) return { type: 'hook', name: node.hookName, data: node.toJSON() };
  if (node instanceof Y.XmlText) return { type: 'text', delta: node.toDelta() };
  return { type: node instanceof Y.XmlElement ? 'element' : 'fragment', ...(node instanceof Y.XmlElement ? { name: node.nodeName, attributes: node.getAttributes() } : {}), children: node.toArray().map(tree) };
}
function plain(node: Y.XmlFragment | Y.XmlElement | Y.XmlText | Y.XmlHook): string {
  if (node instanceof Y.XmlHook) return '[扩展内容]';
  if (node instanceof Y.XmlText) return node.toDelta().map((item: { insert?: unknown }) => typeof item.insert === 'string' ? item.insert : '[嵌入内容]').join('');
  return node.toArray().map(plain).join(node instanceof Y.XmlElement && ['paragraph', 'heading', 'tablecell'].includes(node.nodeName.toLowerCase()) ? '' : '\n');
}
export async function readNote(ctx: Context, resourceId: string): Promise<{ xml: string; tree: unknown; text: string; consistency: string; snapshotAt: string }> {
  const client = await ctx.api(); const url = new URL('/note-collab/ws', client.settings.apiUrl); url.searchParams.set('resourceId', resourceId); url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  const headers = await client.authHeaders();
  return new Promise((resolve, reject) => {
    const doc = new Y.Doc();
    const ws = new WebSocket(url, { headers, followRedirects: false, maxPayload: 16 * 1024 * 1024, handshakeTimeout: ctx.options.timeout });
    let finished = false;
    const finish = (error?: CliError) => {
      if (finished) return; finished = true; clearTimeout(timer); ctx.signal.removeEventListener('abort', cancel);
      if (error) reject(error);
      else { const fragment = doc.getXmlFragment('document-store'); resolve({ xml: fragment.toString(), tree: tree(fragment), text: plain(fragment), consistency: 'live-yjs-sync-step2; not a durable revision', snapshotAt: new Date().toISOString() }); }
      ws.terminate(); doc.destroy();
    };
    const cancel = () => finish(new CliError('CANCELED', '笔记读取已中断。', 130));
    const timer = setTimeout(() => finish(new CliError('NOTE_SYNC_TIMEOUT', '未收到笔记内容同步响应；空连接不视为成功。', 7)), ctx.options.timeout);
    ctx.signal.addEventListener('abort', cancel, { once: true }); if (ctx.signal.aborted) { cancel(); return; }
    ws.on('open', () => {
      // Only advertise an empty state vector. Never answer the server with a document update.
      const encoder = encoding.createEncoder(); encoding.writeVarUint(encoder, 0); sync.writeSyncStep1(encoder, doc); ws.send(encoding.toUint8Array(encoder));
    });
    ws.on('message', (data, isBinary) => {
      if (!isBinary || finished) return;
      try {
        const bytes = Buffer.isBuffer(data) ? data : data instanceof ArrayBuffer ? Buffer.from(data) : Buffer.concat(data);
        const decoder = decoding.createDecoder(bytes); if (decoding.readVarUint(decoder) !== 0) return;
        const type = decoding.readVarUint(decoder);
        if (type === sync.messageYjsSyncStep2 || type === sync.messageYjsUpdate) {
          Y.applyUpdate(doc, decoding.readVarUint8Array(decoder));
          if (type === sync.messageYjsSyncStep2) finish();
        }
      } catch { finish(new CliError('NOTE_PROTOCOL_ERROR', '协同内容不符合已验证的 Yjs 协议。', 8)); }
    });
    ws.on('error', () => finish(new CliError('NOTE_CONNECTION_FAILED', '笔记协同连接失败，请检查网关 WS 路由与认证。', 7)));
    ws.on('unexpected-response', (_request, response) => { response.resume(); finish(new CliError(response.statusCode === 401 ? 'LOGIN_REQUIRED' : response.statusCode === 403 ? 'PERMISSION_DENIED' : 'NOTE_CONNECTION_REJECTED', `协同服务拒绝连接（HTTP ${response.statusCode}）。`, response.statusCode === 401 ? 3 : response.statusCode === 403 ? 4 : 8)); });
    ws.on('close', () => { if (!finished) finish(new CliError('NOTE_SYNC_INCOMPLETE', '连接关闭前未完成内容同步。', 7)); });
  });
}
