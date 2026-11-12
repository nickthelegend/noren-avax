import { useRef, useState } from 'react';
import type { Shop } from '@noren-avax/sdk';
import { api } from '../lib/api';
import { readable } from '../lib/chain';
import type { Book } from '../pages/Merchant';

// The merchant assistant. Claude (through Noren's API, which holds the key) asks for tools; the tools run here, over
// the books this tab decrypted with the shop's key. Claude sees only the tool results it asks for.
type Block =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean };
type Msg = { role: 'user' | 'assistant'; content: string | Block[] };
type View = { kind: 'user' | 'bot' | 'tool'; text: string };

const usd = (cents: bigint | number) => `$${(Number(cents) / 100).toFixed(2)}`;
const itemOf = (memo: string | null) => (memo ?? 'No note').split(' · ')[0]!;
const utc = (t: number) => `${new Date(t * 1000).toISOString().slice(0, 16).replace('T', ' ')} UTC`;

function runTool(name: string, input: Record<string, unknown>, book: Book): string {
  const now = Date.now() / 1000;
  const since = (d: unknown) => (typeof d === 'number' && d > 0 ? now - d * 86400 : 0);
  const cap = (v: unknown, def: number, max: number) => Math.max(1, Math.min(max, Number(v) || def));
  const lines = book.lines.filter((l) => l.cents != null);
  if (name === 'revenue') {
    const want = typeof input.item === 'string' ? input.item.toLowerCase() : null;
    const ls = lines.filter((l) => l.time >= since(input.days) && (!want || itemOf(l.memo).toLowerCase().includes(want)));
    const total = ls.reduce((a, l) => a + l.cents!, 0n);
    return JSON.stringify({
      window: input.days ? `last ${input.days} days` : 'all time',
      item: input.item ?? null,
      revenue: usd(total),
      orders: ls.length,
      average: ls.length ? usd(Number(total) / ls.length) : null,
    });
  }
  if (name === 'top_items') {
    const m = new Map<string, { revenue: bigint; orders: number }>();
    for (const l of lines.filter((x) => x.time >= since(input.days))) {
      const k = itemOf(l.memo);
      const v = m.get(k) ?? { revenue: 0n, orders: 0 };
      m.set(k, { revenue: v.revenue + l.cents!, orders: v.orders + 1 });
    }
    const top = [...m.entries()].sort((a, b) => Number(b[1].revenue - a[1].revenue)).slice(0, cap(input.limit, 5, 10));
    return JSON.stringify(top.map(([item, v]) => ({ item, revenue: usd(v.revenue), orders: v.orders })));
  }
  if (name === 'recent_orders')
    return JSON.stringify(lines.slice(0, cap(input.limit, 5, 20)).map((l) => ({ when: utc(l.time), order: l.memo, amount: usd(l.cents!), batch: l.batch })));
  if (name === 'payouts')
    return JSON.stringify(
      book.payouts.slice(0, cap(input.limit, 5, 20)).map((p) => ({
        batch: p.batch,
        when: utc(p.time),
        amount: p.cents != null ? usd(p.cents) : null,
        cover: p.cover,
        orders: p.lines,
        recorded_on_chain: p.onChain,
        checks: p.problems.length ? p.problems : 'ok',
      })),
    );
  if (name === 'balance') return JSON.stringify({ private_balance: usd(book.balance), withdrawn: usd(book.withdrawn.reduce((a, w) => a + w.cents, 0n)) });
  throw Error(`unknown tool ${name}`);
}

const label = (name: string, input: Record<string, unknown>) =>
  `${name}(${Object.entries(input)
    .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
    .join(', ')})`;

const SUGGEST = ['How much did I make this week?', 'What sells best?', 'Did every payout check out?'];

export function Assistant({ shop, book }: { shop: Shop; book: Book }) {
  const [view, setView] = useState<View[]>([]);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const convo = useRef<Msg[]>([]);
  const end = useRef<HTMLDivElement>(null);

  async function ask(text: string) {
    if (!text.trim() || busy) return;
    setBusy(true);
    setErr(null);
    setQ('');
    const add = (v: View) => {
      setView((xs) => [...xs, v]);
      requestAnimationFrame(() => end.current?.scrollIntoView({ block: 'nearest' }));
    };
    add({ kind: 'user', text });
    const before = convo.current.length;
    convo.current.push({ role: 'user', content: text });
    try {
      for (let turn = 0; turn < 5; turn++) {
        const r = await api<{ stop_reason: string; content: Block[] }>('/ask', { messages: convo.current });
        convo.current.push({ role: 'assistant', content: r.content });
        for (const b of r.content) if (b.type === 'text' && b.text.trim()) add({ kind: 'bot', text: b.text.trim() });
        const calls = r.content.filter((b): b is Extract<Block, { type: 'tool_use' }> => b.type === 'tool_use');
        if (r.stop_reason !== 'tool_use' || !calls.length) break;
        const results: Block[] = calls.map((c) => {
          add({ kind: 'tool', text: label(c.name, c.input) });
          try {
            return { type: 'tool_result', tool_use_id: c.id, content: runTool(c.name, c.input, book) };
          } catch (e) {
            return { type: 'tool_result', tool_use_id: c.id, content: (e as Error).message, is_error: true };
          }
        });
        convo.current.push({ role: 'user', content: results });
      }
    } catch (e) {
      setErr(readable(e));
      convo.current = convo.current.slice(0, before);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <div className="card-h">
        <h2>Ask about {shop.name}</h2>
        <span className="chip">Claude</span>
      </div>
      {view.length === 0 && (
        <div className="chat-ask">
          {SUGGEST.map((s) => (
            <button key={s} onClick={() => ask(s)} disabled={busy}>
              {s}
            </button>
          ))}
        </div>
      )}
      {view.length > 0 && (
        <div className="chat" aria-live="polite">
          {view.map((v, i) => (
            <div key={i} className={`chat-msg chat-${v.kind}`} title={v.kind === 'tool' ? 'Ran in this tab over your decrypted books' : undefined}>
              {v.kind === 'tool' ? `ran ${v.text}` : v.text}
            </div>
          ))}
          {busy && <div className="chat-msg chat-bot faint">Thinking…</div>}
          <div ref={end} />
        </div>
      )}
      <form
        className="chat-form"
        onSubmit={(e) => {
          e.preventDefault();
          ask(q);
        }}
      >
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask about your sales" maxLength={300} aria-label="Ask about your sales" />
        <button className="btn btn-dark" disabled={busy || !q.trim()}>
          Ask
        </button>
      </form>
      {err && <p className="err">{err}</p>}
      <p className="muted small">Your key and books stay in this tab. Claude sees only what the tools above return.</p>
    </section>
  );
}
