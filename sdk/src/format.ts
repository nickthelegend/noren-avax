/** Formatting for money: cents (eERC units), tUSDC (6 decimals), prices (8 decimals). */
export const centsToUsd = (c: bigint | number) => Number(c) / 100;
export const usdcToUsd = (u: bigint) => Number(u) / 1e6;
export const usd = (n: number, digits = 2) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: digits, maximumFractionDigits: digits });
export const short = (a?: string | null, n = 4) => (a ? `${a.slice(0, 2 + n)}…${a.slice(-n)}` : '');
export const usdcToCents = (u: bigint) => u / 10_000n;
export const centsToUsdc = (c: bigint) => c * 10_000n;
export function parseUsdToCents(s: string): bigint | null {
  const m = /^\s*\$?\s*(\d{1,7})(?:\.(\d{0,2}))?\s*$/.exec(s);
  if (!m) return null;
  return BigInt(m[1]!) * 100n + BigInt((m[2] ?? '').padEnd(2, '0') || '0');
}
