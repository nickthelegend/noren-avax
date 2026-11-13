/**
 * A shop's private books, decrypted in this tab with the shop's eERC key: the hub's payouts (each an encrypted eERC
 * transfer whose note is the itemised statement), checked against the digests NorenSettlement recorded, the private
 * balance and withdrawals. Also the merchant assistant's tools, which run here over these books.
 */
import type { Address, Hex } from 'viem';
import { checkStatement, parseStatement, readPayouts, scanLogs, statementDigest, withdrawEvent } from '@noren-avax/sdk';
import { D, pub } from './chain';
import { privateSession } from './signer';

export type Line = { key: string; tx: Hex; payTx: Hex | null; time: number; cents: bigint | null; item: string; order: string; batch: number | null };
export type Payout = { tx: Hex; time: number; batch: number | null; cents: bigint | null; cover: boolean; lines: number; problems: string[]; onChain: boolean };
export type Book = { lines: Line[]; payouts: Payout[]; balance: bigint; withdrawn: { hash: Hex; cents: bigint; time: number }[] };

async function blockTimes(blocks: bigint[]) {
  const uniq = [...new Set(blocks.map(String))].map(BigInt);
  const m = new Map<string, number>();
  await Promise.all(uniq.map(async (b) => m.set(String(b), Number((await pub.getBlock({ blockNumber: b })).timestamp))));
  return m;
}

export async function readBook(owner: Address, shopId: number): Promise<Book> {
  const p = privateSession();
  const [payments, bal, wlogs, recorded] = await Promise.all([
    p.received(owner, BigInt((D as { hubDeployBlock?: number }).hubDeployBlock ?? D.deployBlock)),
    p.balance(),
    scanLogs(pub as never, { address: D.encryptedERC, event: withdrawEvent, args: { user: owner }, fromBlock: BigInt(D.deployBlock) }),
    readPayouts(pub as never, D as never, shopId),
  ]);
  const times = await blockTimes([...payments.map((x) => x.block), ...wlogs.map((l) => l.blockNumber!)]);
  const lines: Line[] = [];
  const payouts: Payout[] = [];
  for (const x of payments) {
    if (x.from.toLowerCase() !== D.hub!.toLowerCase() || !x.memo) continue;
    const st = parseStatement(x.memo);
    if (!st) continue;
    const time = times.get(String(x.block)) ?? 0;
    const rec = recorded.find((r) => r.payoutTx.toLowerCase() === x.tx.toLowerCase());
    const problems = checkStatement(st, x.cents);
    if (rec && rec.digest !== statementDigest(x.memo)) problems.push('statement does not match the digest recorded on chain');
    payouts.push({ tx: x.tx, time, batch: st.batch, cents: x.cents, cover: st.cover, lines: st.items.length, problems, onChain: !!rec });
    for (const it of st.items) lines.push({ key: `${x.tx}-${it.tx}`, tx: x.tx, payTx: it.tx, time, cents: BigInt(it.cents), item: it.item, order: it.order, batch: st.batch });
  }
  return {
    lines: lines.sort((a, b) => b.time - a.time),
    payouts: payouts.sort((a, b) => b.time - a.time),
    balance: bal.cents,
    withdrawn: wlogs.map((l) => ({ hash: l.transactionHash!, cents: l.args.amount as bigint, time: times.get(String(l.blockNumber)) ?? 0 })),
  };
}

// ------------------------------------------------------------------ assistant tools (run in this tab)

const usd = (cents: bigint | number) => `$${(Number(cents) / 100).toFixed(2)}`;
const itemOf = (item: string) => item.replace(/^(private|stocks|credit|payin3|paylater|usdc):/, '');
const utc = (t: number) => `${new Date(t * 1000).toISOString().slice(0, 16).replace('T', ' ')} UTC`;

export function runTool(name: string, input: Record<string, unknown>, book: Book): string {
  const now = Date.now() / 1000;
  const since = (d: unknown) => (typeof d === 'number' && d > 0 ? now - d * 86400 : 0);
  const cap = (v: unknown, def: number, max: number) => Math.max(1, Math.min(max, Number(v) || def));
  const lines = book.lines.filter((l) => l.cents != null);
  if (name === 'revenue') {
    const want = typeof input.item === 'string' ? input.item.toLowerCase() : null;
    const ls = lines.filter((l) => l.time >= since(input.days) && (!want || itemOf(l.item).toLowerCase().includes(want)));
    const total = ls.reduce((a, l) => a + l.cents!, 0n);
    return JSON.stringify({ window: input.days ? `last ${input.days} days` : 'all time', item: input.item ?? null, revenue: usd(total), orders: ls.length, average: ls.length ? usd(Number(total) / ls.length) : null });
  }
  if (name === 'top_items') {
    const m = new Map<string, { revenue: bigint; orders: number }>();
    for (const l of lines.filter((x) => x.time >= since(input.days))) {
      const k = itemOf(l.item);
      const v = m.get(k) ?? { revenue: 0n, orders: 0 };
      m.set(k, { revenue: v.revenue + l.cents!, orders: v.orders + 1 });
    }
    const top = [...m.entries()].sort((a, b) => Number(b[1].revenue - a[1].revenue)).slice(0, cap(input.limit, 5, 10));
    return JSON.stringify(top.map(([item, v]) => ({ item, revenue: usd(v.revenue), orders: v.orders })));
  }
  if (name === 'recent_orders') return JSON.stringify(lines.slice(0, cap(input.limit, 5, 20)).map((l) => ({ when: utc(l.time), order: `${itemOf(l.item)} · ${l.order}`, amount: usd(l.cents!), batch: l.batch })));
  if (name === 'payouts')
    return JSON.stringify(book.payouts.slice(0, cap(input.limit, 5, 20)).map((p) => ({ batch: p.batch, when: utc(p.time), amount: p.cents != null ? usd(p.cents) : null, cover: p.cover, orders: p.lines, recorded_on_chain: p.onChain, checks: p.problems.length ? p.problems : 'ok' })));
  if (name === 'balance') return JSON.stringify({ private_balance: usd(book.balance), withdrawn: usd(book.withdrawn.reduce((a, w) => a + w.cents, 0n)) });
  throw Error(`unknown tool ${name}`);
}
