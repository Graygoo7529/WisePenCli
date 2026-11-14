export type Outcome = 'not-started' | 'applied' | 'pending' | 'partial' | 'unknown';
export class CliError extends Error {
  constructor(
    public code: string,
    message: string,
    public exitCode = 8,
    public details: Record<string, unknown> = {},
    public outcome: Outcome = 'not-started',
  ) { super(message); }
}
export function invalid(message: string, details: Record<string, unknown> = {}): never {
  throw new CliError('INVALID_INPUT', message, 2, details);
}
export function unavailable(message: string): never {
  throw new CliError('CAPABILITY_UNAVAILABLE', message, 10);
}
export function asCliError(error: unknown): CliError {
  if (error instanceof CliError) return error;
  // 未知异常不透传 URL、请求体和第三方库内部错误。
  return new CliError('CLIENT_ERROR', '客户端执行失败。请检查本地文件权限、配置与输入。');
}
