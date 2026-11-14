import { join } from 'node:path';
import type { Context } from './context.js';
import { msysLauncher } from './paths.js';
import type { CliError } from '../errors.js';

export function nextAction(ctx: Context, command: string, args: string[] = [], actor = 'agent') {
  const windows = process.platform === 'win32' && !msysLauncher();
  const executable = join(ctx.packageRoot, windows ? 'wisepen.cmd' : 'wisepen');
  const dataDir = ctx.settingsValue?.dataDir;
  const argv = [...(dataDir ? ['--data-dir', dataDir] : []), ...command.split(' '), ...args];
  const quote = (value: string) => windows ? `'${value.replace(/'/g, "''")}'` : `'${value.replace(/'/g, "'\\''")}'`;
  const shellExecutable = windows ? executable : executable.replace(/\\/g, '/');
  return { actor, command, executable, args: argv, shell: windows ? 'powershell' : 'sh', displayCommand: `${windows ? '& ' : ''}${[shellExecutable, ...argv].map(quote).join(' ')}` };
}
export function recoveryActions(ctx: Context | undefined, error: CliError) {
  if (!ctx) return [];
  const actions = [];
  if (error.exitCode === 3) actions.push(nextAction(ctx, 'login', [], 'user'));
  if (error.details.documentId) actions.push(nextAction(ctx, 'doc status', ['--document-id', String(error.details.documentId)]));
  if (error.code === 'GROUP_ROOT_NOT_MOUNTABLE') {
    actions.push(nextAction(ctx, 'drive ls', ['--group-id', String(error.details.groupId)]));
    actions.push(nextAction(ctx, 'drive mkdir', ['--group-id', String(error.details.groupId), '--path', '/资料'], 'user'));
  }
  return actions;
}
