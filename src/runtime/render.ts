type Row = Record<string, unknown>;
function table(rows: Row[], columns: [string, string][]): string {
  if (!rows.length) return '（无结果）\n';
  const clean = (value: unknown) => String(value ?? '').replace(/[\r\n\t\x1b]/g, ' ');
  return [columns.map(([, label]) => label).join('  '), ...rows.map(row => columns.map(([key]) => clean(row[key])).join('  '))].join('\n') + '\n';
}
export function render(command: string, data: unknown): string {
  if (!data || typeof data !== 'object') return JSON.stringify(data, null, 2) + '\n';
  const obj = data as Row;
  if (command === 'drive ls') {
    const resources = obj.resources as { list: Row[]; page: number; totalPage: number; total: number };
    return table((obj.folders as Row[]).map(f => ({ ...f, type: '目录' })), [['type', '类型'], ['name', '名称'], ['id', 'ID']]) + table(resources.list, [['resourceType', '类型'], ['resourceName', '名称'], ['resourceId', 'ID']]) + `资源第 ${resources.page}/${resources.totalPage} 页，共 ${resources.total} 项\n`;
  }
  const rows = obj.list ?? obj.providers ?? obj.models;
  if (Array.isArray(rows) && command.endsWith(' list')) {
    const columns: [string, string][] = command === 'group list' ? [['groupName', '名称'], ['groupId', 'ID'], ['groupType', '类型']] : command === 'session list' ? [['title', '标题'], ['id', 'ID'], ['updated_at', '更新时间']] : command === 'provider list' ? [['name', '名称'], ['id', 'ID'], ['type', '类型'], ['is_active', '启用']] : [['display_name', '名称'], ['id', 'ID'], ['scope', '范围'], ['is_active', '启用']];
    return table(rows, columns) + (obj.page ? `第 ${obj.page}/${obj.totalPage ?? obj.total_page} 页，共 ${obj.total} 项\n` : '');
  }
  if (command === 'web url' && typeof obj.url === 'string') return obj.url + '\n';
  return JSON.stringify(data, null, 2) + '\n';
}
