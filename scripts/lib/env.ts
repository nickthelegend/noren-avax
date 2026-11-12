// Repo-root .env loader. Values are read by name and never printed.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');

export function readEnvFile(path: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!existsSync(path)) return out;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (m) out[m[1]!] = m[2]!.replace(/^["']|["']$/g, '');
  }
  return out;
}

export const env = { ...readEnvFile(join(ROOT, '.env')), ...process.env } as Record<string, string | undefined>;

export function need(k: string): string {
  const v = env[k];
  if (!v) throw new Error(`Setup required: ${k} is not set (see .env.example)`);
  return v;
}

export const hexKey = (v: string) => (v.startsWith('0x') ? v : `0x${v}`) as `0x${string}`;

export const log = (k: string, v: unknown) =>
  console.log(`${k.padEnd(34)} ${typeof v === 'string' ? v : JSON.stringify(v, (_, x) => (typeof x === 'bigint' ? x.toString() : x))}`);
