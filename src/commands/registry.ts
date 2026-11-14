import { z } from 'zod';
import type { Context } from '../runtime/context.js';

export const VERSION = '0.2.0';
export type CommandDef = { name: string; description: string; input: z.ZodObject; effect: 'read' | 'write' | 'local' | 'experimental'; available?: boolean; options?: [string, string][]; run: (ctx: Context, input: Record<string, unknown>) => Promise<unknown> };
export const commands: CommandDef[] = [];
export function define(def: CommandDef): void { commands.push(def); }
export const text = (input: Record<string, unknown>, key: string): string => input[key] as string;
export const optionalText = (input: Record<string, unknown>, key: string): string | undefined => input[key] as string | undefined;
export const number = (input: Record<string, unknown>, key: string): number => input[key] as number;
export const flag = (input: Record<string, unknown>, key: string): boolean => input[key] === true;
export const pagination = { page: z.coerce.number().int().positive().default(1), size: z.coerce.number().int().min(1).max(100).default(50) };
export const pageOptions: [string, string][] = [['--page <page>', '页码，从 1 开始'], ['--size <size>', '每页数量，最大 100']];
export const selector = { path: z.string().optional(), id: z.string().optional(), group: z.string().optional(), groupId: z.string().optional() };
export const selectorOptions: [string, string][] = [['--path <path>', '远端绝对路径'], ['--id <id>', '明确指定资源 ID'], ['--group <name>', '小组精确名称'], ['--group-id <id>', '明确指定小组 ID']];
