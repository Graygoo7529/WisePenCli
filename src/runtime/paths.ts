import { execFileSync } from 'node:child_process';
import { CliError } from '../errors.js';

// Set only by the bundled shell launcher, before MSYS crosses into native Node.
export const msysLauncher = () => process.platform === 'win32' && process.env.WISEPEN_INTERNAL_MSYS === '1';
export function localPath(value: string): string {
  if (value === '-' || !msysLauncher() || !value.startsWith('/')) return value;
  try { return execFileSync('cygpath', ['-m', '--', value], { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }).replace(/[\r\n]+$/, ''); }
  catch { throw new CliError('LOCAL_PATH_CONVERSION_FAILED', 'Git Bash 无法转换本地路径，请检查 cygpath 是否可用。', 2); }
}
export function localInputs(command: string, input: Record<string, unknown>): Record<string, unknown> {
  const result = { ...input };
  for (const key of ['file', 'output']) if (typeof result[key] === 'string') result[key] = localPath(result[key]);
  if (command === 'config set' && result.key === 'dataDir' && typeof result.value === 'string') result.value = localPath(result.value);
  return result;
}
