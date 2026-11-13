// Noren Merchant's API: sign in with Ethereum, stores (each one an on-chain NorenMerchants shop), secret keys,
// invoices (payment links and hosted-checkout sessions) and each store's event log.
//
//   GET   /api/auth/nonce                -> { nonce }
//   POST  /api/auth/siwe                 { message, signature } -> { token, address, expiresAt }
//   GET   /api/stores                    (session) -> Store[]
//   POST  /api/stores                    (session) { shopId, name } -> { store, secretKey }
//   PATCH /api/stores/:id                (session) { name } -> { store }
//   POST  /api/stores/:id/keys           (session) -> { key, secretKey }
//   GET   /api/stores/:id/invoices       (session or the store's secret key) -> Invoice[]
//   GET   /api/stores/:id/events         (session or the store's secret key) -> Event[]
//   POST  /api/invoices                  (secret key, or session + storeId) { amountCents, description, ... } -> Invoice
//   GET   /api/invoices/:id              (public) -> Invoice without metadata
//
// The hub marks an invoice paid when it decrypts a payment note naming that invoice as its order (markPaid), and
// records the batch and payout when it settles (markSettled). Invoices never hold a customer address.
// Secret keys are stored as sha256 only; session tokens likewise. State is one JSON file, written atomically.
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { getAddress, type Address, type Hex, type PublicClient } from 'viem';
import { parseSiweMessage, verifySiweMessage } from 'viem/siwe';
import { norenMerchantsAbi, type Deployment } from '@noren-avax/sdk';

export const METHODS = ['private', 'stocks', 'credit', 'payin3', 'paylater'] as const;
export type Method = (typeof METHODS)[number];

export interface KeyRec {
  id: string;
  prefix: string;
  hash: string;
  createdAt: number;
}
export interface Store {
  id: string;
  shopId: number;
  name: string;
  owner: Address;
  createdAt: number;
  keys: KeyRec[];
}
export interface Invoice {
  id: string;
  storeId: string;
  shopId: number;
  merchantName: string;
  amountCents: number;
  description: string;
  status: 'open' | 'paid' | 'expired';
  createdAt: number;
  expiresAt: number;
  paidAt?: number;
  paymentTx?: Hex;
  method?: Method;
  batch?: number;
  payoutTx?: Hex;
  settledAt?: number;
  successUrl?: string;
  cancelUrl?: string;
  metadata?: Record<string, string>;
  url: string;
}
export interface NorenEvent {
  id: string;
  storeId: string;
  type: 'invoice.created' | 'invoice.paid' | 'payout.settled';
  created: number;
  data: Record<string, unknown>;
}
interface Data {
  nonces: Record<string, number>;
  sessions: Record<string, { address: Address; domain: string; expiresAt: number }>;
  stores: Store[];
  invoices: Invoice[];
  events: NorenEvent[];
}

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const now = () => Math.floor(Date.now() / 1000);
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const ALNUM = 'abcdefghijklmnopqrstuvwxyz0123456789';
const rid = (n: number) => Array.from(randomBytes(n), (b) => ALNUM[b % 36]).join('');
const SESSION_TTL = 7 * 24 * 3600;
const NONCE_TTL = 10 * 60;
const INVOICE_TTL = 24 * 3600;
const MAX_EVENTS = 500;

export const DEFAULT_CHECKOUT = 'https://noren-avax-merchant.vercel.app/#/pay/';

/** `<method>:<description>` in a hub note's item field; anything else is a plain private payment. */
export function methodOf(item: string): Method {
  const m = /^([a-z0-9]{3,10}):/.exec(item);
  return m && (METHODS as readonly string[]).includes(m[1]!) ? (m[1] as Method) : 'private';
}

export interface MerchantOptions {
  pub: PublicClient;
  d: Deployment;
  file: string;
  chainId: number;
  checkoutBase?: string;
  /** invoice creations allowed per minute per secret key / session, and per IP */
  perMinute?: number;
}

export class Merchant {
  private o: MerchantOptions;
  data: Data;
  private hits = new Map<string, number[]>();

  constructor(o: MerchantOptions) {
    this.o = o;
    this.data = existsSync(o.file) ? JSON.parse(readFileSync(o.file, 'utf8')) : { nonces: {}, sessions: {}, stores: [], invoices: [], events: [] };
  }

  private save() {
    mkdirSync(dirname(this.o.file), { recursive: true });
    const tmp = `${this.o.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.data, null, 1), { mode: 0o600 });
    renameSync(tmp, this.o.file);
  }

  private event(storeId: string, type: NorenEvent['type'], data: Record<string, unknown>) {
    this.data.events.push({ id: `ev${rid(12)}`, storeId, type, created: now(), data });
    const mine = this.data.events.filter((e) => e.storeId === storeId);
    if (mine.length > MAX_EVENTS) {
      const drop = new Set(mine.slice(0, mine.length - MAX_EVENTS).map((e) => e.id));
      this.data.events = this.data.events.filter((e) => !drop.has(e.id));
    }
  }

  // ---------------------------------------------------------------- auth

  nonce(): string {
    const t = now();
    for (const [n, exp] of Object.entries(this.data.nonces)) if (exp < t) delete this.data.nonces[n];
    const n = randomBytes(12).toString('hex');
    this.data.nonces[n] = t + NONCE_TTL;
    this.save();
    return n;
  }

  async siwe(message: unknown, signature: unknown) {
    if (typeof message !== 'string' || typeof signature !== 'string' || !/^0x[0-9a-fA-F]+$/.test(signature)) throw new HttpError(400, 'message and signature are required');
    const m = parseSiweMessage(message);
    if (!m.address || !m.nonce || !m.domain) throw new HttpError(400, 'not a sign-in-with-Ethereum message');
    if (m.chainId !== this.o.chainId) throw new HttpError(400, `sign in on chain ${this.o.chainId} (Avalanche Fuji), not ${m.chainId}`);
    const exp = this.data.nonces[m.nonce];
    if (!exp || exp < now()) throw new HttpError(401, 'unknown or expired nonce: ask for a new one');
    const ok = await verifySiweMessage(this.o.pub, { message, signature: signature as Hex, nonce: m.nonce });
    if (!ok) throw new HttpError(401, 'the signature does not match the message');
    delete this.data.nonces[m.nonce];
    const token = randomBytes(32).toString('hex');
    const address = getAddress(m.address);
    const expiresAt = now() + SESSION_TTL;
    this.data.sessions[sha(token)] = { address, domain: m.domain, expiresAt };
    for (const [k, s] of Object.entries(this.data.sessions)) if (s.expiresAt < now()) delete this.data.sessions[k];
    this.save();
    return { token, address, expiresAt };
  }

  /** The session address or the store a secret key belongs to, from an Authorization header. */
  principal(auth: string | undefined): { kind: 'session'; address: Address } | { kind: 'key'; store: Store } | null {
    const t = /^Bearer\s+(\S+)$/i.exec(auth ?? '')?.[1];
    if (!t) return null;
    if (t.startsWith('sk_test_')) {
      const h = sha(t);
      const store = this.data.stores.find((s) => s.keys.some((k) => k.hash === h));
      return store ? { kind: 'key', store } : null;
    }
    const s = this.data.sessions[sha(t)];
    return s && s.expiresAt > now() ? { kind: 'session', address: s.address } : null;
  }

  private session(auth: string | undefined): Address {
    const p = this.principal(auth);
    if (!p || p.kind !== 'session') throw new HttpError(401, 'Session required: sign in to Noren Merchant');
    return p.address;
  }

  private ownStore(auth: string | undefined, id: string, allowKey = false): Store {
    const p = this.principal(auth);
    if (!p) throw new HttpError(401, allowKey ? 'Session or secret key required' : 'Session required: sign in to Noren Merchant');
    const store = this.data.stores.find((s) => s.id === id);
    if (!store) throw new HttpError(404, 'no such store');
    if (p.kind === 'key') {
      if (!allowKey || p.store.id !== id) throw new HttpError(403, 'that key belongs to another store');
    } else if (p.address.toLowerCase() !== store.owner.toLowerCase()) throw new HttpError(403, 'not your store');
    return store;
  }

  // ---------------------------------------------------------------- stores and keys

  private newKey(): { rec: KeyRec; secretKey: string } {
    const secretKey = `sk_test_${randomBytes(32).toString('hex')}`;
    return { rec: { id: `key_${rid(8)}`, prefix: `${secretKey.slice(0, 14)}…${secretKey.slice(-4)}`, hash: sha(secretKey), createdAt: now() }, secretKey };
  }

  publicStore = (s: Store) => ({ id: s.id, shopId: s.shopId, name: s.name, owner: s.owner, createdAt: s.createdAt, keys: s.keys.map(({ id, prefix, createdAt }) => ({ id, prefix, createdAt })) });

  stores(auth: string | undefined) {
    const a = this.session(auth);
    return this.data.stores.filter((s) => s.owner.toLowerCase() === a.toLowerCase()).map(this.publicStore);
  }

  async createStore(auth: string | undefined, b: Record<string, unknown>) {
    const a = this.session(auth);
    const shopId = Number(b.shopId);
    if (!Number.isInteger(shopId) || shopId < 0) throw new HttpError(400, 'shopId must be the NorenMerchants shop id');
    const name = validName(b.name);
    let owner: Address;
    try {
      owner = ((await this.o.pub.readContract({ address: this.o.d.norenMerchants, abi: norenMerchantsAbi, functionName: 'shop', args: [BigInt(shopId)] })) as { owner: Address }).owner;
    } catch {
      throw new HttpError(404, `shop ${shopId} is not open on NorenMerchants`);
    }
    if (owner.toLowerCase() !== a.toLowerCase()) throw new HttpError(403, `shop ${shopId} belongs to ${owner}, not ${a}`);
    if (this.data.stores.some((s) => s.shopId === shopId)) throw new HttpError(409, `shop ${shopId} already has a Noren Merchant store`);
    const { rec, secretKey } = this.newKey();
    const store: Store = { id: `st_${rid(10)}`, shopId, name, owner, createdAt: now(), keys: [rec] };
    this.data.stores.push(store);
    this.save();
    return { store: this.publicStore(store), secretKey };
  }

  renameStore(auth: string | undefined, id: string, b: Record<string, unknown>) {
    const s = this.ownStore(auth, id);
    s.name = validName(b.name);
    this.save();
    return { store: this.publicStore(s) };
  }

  addKey(auth: string | undefined, id: string) {
    const s = this.ownStore(auth, id);
    if (s.keys.length >= 10) throw new HttpError(400, 'at most 10 keys per store');
    const { rec, secretKey } = this.newKey();
    s.keys.push(rec);
    this.save();
    return { key: { id: rec.id, prefix: rec.prefix, createdAt: rec.createdAt }, secretKey };
  }

  // ---------------------------------------------------------------- invoices

  private limit(key: string) {
    const per = this.o.perMinute ?? 30;
    const t = Date.now();
    const list = (this.hits.get(key) ?? []).filter((x) => t - x < 60_000);
    if (list.length >= per) throw new HttpError(429, 'too many invoices this minute; try again shortly');
    list.push(t);
    this.hits.set(key, list);
  }

  private view(inv: Invoice): Invoice {
    return inv.status === 'open' && inv.expiresAt < now() ? { ...inv, status: 'expired' } : inv;
  }

  publicInvoice(id: string) {
    const inv = this.data.invoices.find((i) => i.id === id);
    if (!inv) throw new HttpError(404, 'no such invoice');
    const { metadata: _m, ...rest } = this.view(inv);
    return rest;
  }

  createInvoice(auth: string | undefined, b: Record<string, unknown>, ip: string): Invoice {
    const p = this.principal(auth);
    if (!p) throw new HttpError(401, 'Secret key or session required');
    let store: Store;
    if (p.kind === 'key') store = p.store;
    else store = this.ownStore(auth, String(b.storeId ?? ''));
    this.limit(`s:${store.id}`);
    this.limit(`ip:${ip}`);
    const amountCents = Number(b.amountCents);
    if (!Number.isInteger(amountCents) || amountCents < 1 || amountCents > 1_000_000) throw new HttpError(400, 'amountCents must be a whole number of cents from 1 to 1,000,000');
    const description = String(b.description ?? '').trim().slice(0, 120);
    if (!description) throw new HttpError(400, 'description is required');
    const url = (v: unknown) => {
      if (v == null || v === '') return undefined;
      try {
        const u = new URL(String(v));
        if (u.protocol !== 'https:' && u.hostname !== 'localhost' && u.hostname !== '127.0.0.1') throw new Error();
        return u.toString();
      } catch {
        throw new HttpError(400, 'successUrl and cancelUrl must be https URLs');
      }
    };
    let metadata: Record<string, string> | undefined;
    if (b.metadata != null) {
      if (typeof b.metadata !== 'object' || Array.isArray(b.metadata)) throw new HttpError(400, 'metadata must be an object of strings');
      const ents = Object.entries(b.metadata as Record<string, unknown>).slice(0, 20);
      metadata = Object.fromEntries(ents.map(([k, v]) => [String(k).slice(0, 40), String(v).slice(0, 200)]));
    }
    const id = `in${rid(10)}`;
    const t = now();
    const inv: Invoice = {
      id,
      storeId: store.id,
      shopId: store.shopId,
      merchantName: store.name,
      amountCents,
      description,
      status: 'open',
      createdAt: t,
      expiresAt: t + INVOICE_TTL,
      successUrl: url(b.successUrl),
      cancelUrl: url(b.cancelUrl),
      metadata,
      url: `${this.o.checkoutBase ?? DEFAULT_CHECKOUT}${id}`,
    };
    this.data.invoices.push(inv);
    this.event(store.id, 'invoice.created', { invoice: id, amountCents, description });
    this.save();
    return inv;
  }

  invoices(auth: string | undefined, storeId: string) {
    this.ownStore(auth, storeId, true);
    return this.data.invoices.filter((i) => i.storeId === storeId).map((i) => this.view(i)).reverse();
  }

  events(auth: string | undefined, storeId: string) {
    this.ownStore(auth, storeId, true);
    return this.data.events.filter((e) => e.storeId === storeId).reverse();
  }

  // ---------------------------------------------------------------- from the hub

  /** A payment the hub decrypted: marks the invoice it names paid. Idempotent. Returns the invoice if it matched. */
  markPaid(p: { tx: Hex; shopId: number | null; order: string; item: string; cents: string }): Invoice | null {
    if (p.shopId == null || !p.order) return null;
    const inv = this.data.invoices.find((i) => i.id === p.order && i.shopId === p.shopId);
    if (!inv || inv.status === 'paid') return null;
    if (BigInt(p.cents) < BigInt(inv.amountCents)) return null;
    inv.status = 'paid';
    inv.paidAt = now();
    inv.paymentTx = p.tx;
    inv.method = methodOf(p.item);
    this.event(inv.storeId, 'invoice.paid', { invoice: inv.id, amountCents: inv.amountCents, method: inv.method, paymentTx: p.tx });
    this.save();
    return inv;
  }

  /** The hub settled a batch: records the batch and the shop's payout on each invoice paid by those payments. */
  markSettled(batch: number, items: { tx: Hex; shopId: number | null; payoutTx: Hex | null }[]) {
    const byStore = new Map<string, { invoices: string[]; payoutTx: Hex | null }>();
    for (const it of items) {
      const inv = this.data.invoices.find((i) => i.paymentTx === it.tx && i.shopId === it.shopId);
      if (!inv || inv.batch != null) continue;
      inv.batch = batch;
      inv.payoutTx = it.payoutTx ?? undefined;
      inv.settledAt = now();
      const e = byStore.get(inv.storeId) ?? { invoices: [], payoutTx: it.payoutTx };
      e.invoices.push(inv.id);
      byStore.set(inv.storeId, e);
    }
    for (const [storeId, e] of byStore) this.event(storeId, 'payout.settled', { batch, payoutTx: e.payoutTx, invoices: e.invoices });
    if (byStore.size) this.save();
  }

  // ---------------------------------------------------------------- HTTP

  /** Routes /api/auth, /api/stores and /api/invoices. Returns false for anything else. */
  async handle(req: IncomingMessage, url: URL, ip: string, body: () => Promise<Record<string, unknown>>, send: (s: number, d: unknown) => void): Promise<boolean> {
    const p = url.pathname;
    const m = req.method ?? 'GET';
    const auth = req.headers.authorization;
    if (p === '/api/auth/nonce' && m === 'GET') return send(200, { nonce: this.nonce() }), true;
    if (p === '/api/auth/siwe' && m === 'POST') {
      const b = await body();
      return send(200, await this.siwe(b.message, b.signature)), true;
    }
    if (p === '/api/stores' && m === 'GET') return send(200, this.stores(auth)), true;
    if (p === '/api/stores' && m === 'POST') return send(201, await this.createStore(auth, await body())), true;
    let r = /^\/api\/stores\/(st_[a-z0-9]{10})$/.exec(p);
    if (r && m === 'PATCH') return send(200, this.renameStore(auth, r[1]!, await body())), true;
    r = /^\/api\/stores\/(st_[a-z0-9]{10})\/(keys|invoices|events)$/.exec(p);
    if (r) {
      if (r[2] === 'keys' && m === 'POST') return send(201, this.addKey(auth, r[1]!)), true;
      if (r[2] === 'invoices' && m === 'GET') return send(200, this.invoices(auth, r[1]!)), true;
      if (r[2] === 'events' && m === 'GET') return send(200, this.events(auth, r[1]!)), true;
    }
    if (p === '/api/invoices' && m === 'POST') return send(201, this.createInvoice(auth, await body(), ip)), true;
    r = /^\/api\/invoices\/(in[a-z0-9]{10})$/.exec(p);
    if (r && m === 'GET') return send(200, this.publicInvoice(r[1]!)), true;
    if (p.startsWith('/api/auth') || p.startsWith('/api/stores') || p.startsWith('/api/invoices')) throw new HttpError(404, 'not found');
    return false;
  }
}

function validName(v: unknown): string {
  const n = String(v ?? '').trim();
  if (n.length < 1 || n.length > 60) throw new HttpError(400, 'name must be 1 to 60 characters');
  return n;
}
