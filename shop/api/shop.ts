// Aubelle's backend as one Vercel function (vercel.json rewrites /api/* here). It keeps no database: an order is the
// Noren invoice it created, so the order page always shows Noren's own status. Without the store's secret key,
// checkout answers "Setup required"; nothing here pretends.
import { randomBytes } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { bySlug, priceCart } from '../src/catalog.js';
import { createCheckout, readInvoice } from '../server/noren.js';

const CHECKOUT_BASE = (process.env.NOREN_CHECKOUT_URL ?? 'https://noren-avax-merchant.vercel.app').replace(/\/$/, '');
const NOREN = process.env.NOREN_API ?? 'https://noren-avax-api.201-18-198-162.sslip.io';
// Chainlink EUR/USD on Avalanche Fuji (8 decimals), read with eth_call.
const EUR_USD = '0x9F5c46674d14ec1ba3877f3eE3e7D93D138221f0';
const RPCS = ['https://avalanche-fuji-c-chain-rpc.publicnode.com', 'https://api.avax-test.network/ext/bc/C/rpc'];
const missing = () => (process.env.NOREN_SECRET_KEY ? [] : ['NOREN_SECRET_KEY']);

type Req = IncomingMessage & { query?: Record<string, string | string[]>; body?: unknown };
function send(res: ServerResponse, status: number, value: unknown) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(value));
}
async function json(req: Req): Promise<any> {
  if (req.body !== undefined) return typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  let s = '';
  for await (const c of req) { s += c; if (s.length > 64_000) throw new Error('Body too large'); }
  return s ? JSON.parse(s) : {};
}

let fx: { eurPerUsd: number; at: number; feed: string; updatedAt: string } | null = null;
async function eurRate() {
  if (fx && Date.now() - fx.at < 5 * 60_000) return fx;
  let last: unknown;
  for (const rpc of RPCS) {
    try {
      const r = await fetch(rpc, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: EUR_USD, data: '0xfeaf968c' }, 'latest'] }) });
      const j = await r.json();
      if (j.error) throw new Error(j.error.message);
      const w = (i: number) => BigInt('0x' + String(j.result).slice(2 + i * 64, 2 + (i + 1) * 64));
      const answer = Number(w(1)) / 1e8, updatedAt = Number(w(3));
      if (!(answer > 0)) throw new Error('Chainlink EUR/USD returned no price');
      if (Date.now() / 1000 - updatedAt > 3 * 86400) throw new Error('Chainlink EUR/USD on Fuji is stale');
      fx = { eurPerUsd: 1 / answer, at: Date.now(), feed: EUR_USD, updatedAt: new Date(updatedAt * 1000).toISOString() };
      return fx;
    } catch (e) { last = e; }
  }
  throw last;
}

const pack = (lines: { slug: string; size: string; qty: number }[]) => lines.map((l) => `${l.slug}:${l.size}:${l.qty}`).join(',');
const unpack = (s: unknown) => String(s ?? '').split(',').filter(Boolean).map((x) => {
  const [slug, size, qty] = x.split(':');
  const p = bySlug(slug!);
  return { slug: slug!, size: size!, qty: Number(qty), name: p?.name ?? slug!, price: p?.price ?? 0 };
});
const STATUS: Record<string, string> = { open: 'awaiting_payment', paid: 'paid', expired: 'expired' };

export default async function handler(req: Req, res: ServerResponse) {
  const url = new URL(req.url ?? '/', 'http://x');
  const route = String(req.query?.p ?? url.searchParams.get('p') ?? '').replace(/^\/+/, '');
  try {
    if (route === 'config' && req.method === 'GET') {
      return send(res, 200, { ready: missing().length === 0, missing: missing(), webhookError: null, server: NOREN, merchant: null, checkoutBase: CHECKOUT_BASE });
    }
    if (route === 'fx' && req.method === 'GET') return send(res, 200, await eurRate());
    if (route === 'checkout' && req.method === 'POST') {
      if (missing().length) return send(res, 503, { error: `Setup required: ${missing().join(', ')}` });
      const { lines, total } = priceCart((await json(req)).lines);
      const id = `AUB-${randomBytes(3).toString('hex').toUpperCase()}`;
      const items = lines.reduce((n, l) => n + l.qty, 0);
      const summary = `${lines[0]!.name}${lines.length > 1 ? ` and ${items - lines[0]!.qty} more` : lines[0]!.qty > 1 ? ` x${lines[0]!.qty}` : ''}`.slice(0, 48);
      const host = String(req.headers['x-forwarded-host'] ?? req.headers.host ?? 'noren-avax-shop.vercel.app');
      const shopUrl = `${host.startsWith('127.0.0.1') || host.startsWith('localhost') ? 'http' : 'https'}://${host}`;
      const { invoiceId, url: hosted } = await createCheckout({ id, totalCents: total, summary }, shopUrl, pack(lines));
      return send(res, 201, { orderId: id, invoiceId, checkoutUrl: hosted || `${CHECKOUT_BASE}/#/pay/${invoiceId}` });
    }
    const m = /^orders\/([A-Za-z0-9]{6,32})$/.exec(route);
    if (m && req.method === 'GET') {
      const inv = await readInvoice(m[1]!);
      const lines = unpack(inv.metadata?.lines);
      return send(res, 200, {
        id: inv.metadata?.order ?? inv.id, invoiceId: inv.id, status: STATUS[inv.status] ?? inv.status, lines, totalCents: inv.amountCents,
        paymentTx: inv.paymentTx ?? null, paidAt: inv.paidAt ?? null, method: inv.method ?? null, batch: inv.batch ?? null, payoutTx: inv.payoutTx ?? null,
        checkoutUrl: inv.url ?? `${CHECKOUT_BASE}/#/pay/${inv.id}`,
      });
    }
    return send(res, 404, { error: 'Not found' });
  } catch (e: any) {
    const status = e?.status === 401 || e?.status === 403 ? 502 : typeof e?.status === 'number' && e.status >= 400 ? e.status : e instanceof TypeError ? 502 : 400;
    const message = e?.status === 401 || e?.status === 403 ? `Noren rejected the store's secret key (${e.message})` : e instanceof TypeError ? `Noren is not reachable at ${NOREN} (${e.message})` : e.message;
    return send(res, status, { error: message });
  }
}
