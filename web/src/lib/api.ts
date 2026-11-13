import { type Address, type Hex } from 'viem';
import { createSiweMessage } from 'viem/siwe';
import { gasDigest, hasHub, norenStockStarterAbi, type StockSym } from '@noren-avax/sdk';
import { D, pub } from './chain';
import { announceTx, signerClient, write } from './signer';

/** Noren's API on the VPS (hub, gas relay, merchant API, prices). Same origin: Vercel rewrites /api; Vite proxies it in dev. */
type Init = { method?: string; body?: unknown; token?: string };
export async function api<T>(path: string, init?: Init | unknown): Promise<T> {
  const o: Init = init && typeof init === 'object' && ('method' in init || 'token' in init || 'body' in init) ? (init as Init) : init === undefined ? {} : { method: 'POST', body: init };
  const method = o.method ?? (o.body === undefined ? 'GET' : 'POST');
  let r: Response;
  try {
    r = await fetch(`/api${path}`, {
      method,
      headers: { ...(o.body !== undefined ? { 'content-type': 'application/json' } : {}), ...(o.token ? { authorization: `Bearer ${o.token}` } : {}) },
      body: o.body === undefined ? undefined : JSON.stringify(o.body),
    });
  } catch {
    throw Error('Noren’s API is unreachable. Check your connection and try again.');
  }
  const text = await r.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    throw Error(`Noren’s API answered ${r.status} without JSON.`);
  }
  if (!r.ok) throw Error((data as { error?: string })?.error ?? `Noren’s API answered ${r.status}.`);
  return data as T;
}

// ------------------------------------------------------------------ gas + stock starter packs

export type GasStatus = { station: Address; pack: { avax: string; tUSDC: number; tWBTC: number }; todayLeft: number; youLeft: number; funded: number };

/** Signs the starter-pack request with the connected wallet and has Noren's relayer send it. */
export async function getStarterPack(to: Address): Promise<Hex> {
  if (!hasHub(D)) throw Error('Setup required: this deployment has no gas station.');
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);
  const w = signerClient();
  const sig = await w.signMessage({ account: w.account ?? to, message: { raw: gasDigest(D.chainId, D.norenGasStation, to, deadline) } });
  const { hash } = await api<{ hash: Hex }>('/gas', { to, deadline: String(deadline), sig });
  await pub.waitForTransactionReceipt({ hash, pollingInterval: 500, timeout: 90_000 });
  announceTx(hash, 'starter pack: gas, 100 tUSDC, 0.01 tWBTC');
  return hash;
}

export async function stockPackClaimed(who: Address) {
  return (await pub.readContract({ address: D.stockStarter, abi: norenStockStarterAbi, functionName: 'claimed', args: [who] })) as boolean;
}
export const claimStockPack = () => write(D.stockStarter, norenStockStarterAbi as never, 'claim', [], 'stock starter pack: 2 tNVDA, 1 tTSLA, 2 tAAPL, 1 tMSFT, 1 tSPY');

// ------------------------------------------------------------------ hub receipts

export type HubStatus = { hub: Address; everySec: number; coverMin: number; queued: number; settling: boolean; nextSettleAt: number; lastBatchAt: number | null; error: string | null };
export type Receipt = {
  tx: Hex; shopId: number; cents: string; order: string; status: 'queued' | 'settling' | 'settled' | 'refunded' | 'refund pending';
  batch: number | null; payoutTx: Hex | null; refundTx: Hex | null; hub: Address; signature: Hex; nextSettleAt: number;
};
const CLAIMS = 'noren:claims';
export function saveClaim(tx: Hex, claim: string, meta: { shop: string; item: string; cents: string; order: string; method: string }) {
  try {
    const all = JSON.parse(localStorage.getItem(CLAIMS) ?? '{}');
    all[tx] = { claim, ...meta, at: Date.now() };
    localStorage.setItem(CLAIMS, JSON.stringify(all));
  } catch {
    /* storage blocked: the receipt still shows for this session */
  }
}
export type SavedClaim = { claim: string; shop: string; item: string; cents: string; order: string; method: string; at: number };
export function savedClaims(): Record<Hex, SavedClaim> {
  try {
    return JSON.parse(localStorage.getItem(CLAIMS) ?? '{}');
  } catch {
    return {};
  }
}

// ------------------------------------------------------------------ prices

export type PricesView = { source: string; quotes: { sym: StockSym; price: number; marketTime: number }[]; report: unknown; onchain?: { signedAt: number; fresh: boolean } };
export const prices = () => api<PricesView>('/prices');

// ------------------------------------------------------------------ Noren Merchant (sign-in, stores, keys, invoices)

export type Method = 'private' | 'stocks' | 'credit' | 'payin3' | 'paylater' | 'usdc';
export type Invoice = {
  id: string; storeId: string; shopId: number; merchantName: string; amountCents: number; description: string;
  status: 'open' | 'paid' | 'expired'; createdAt: number; expiresAt: number; paidAt?: number; paymentTx?: Hex; method?: Method;
  batch?: number; payoutTx?: Hex; settledAt?: number; successUrl?: string; cancelUrl?: string; metadata?: Record<string, string>; url?: string;
};
export type ApiKey = { id: string; prefix: string; createdAt: number };
export type Store = { id: string; shopId: number; name: string; owner: Address; createdAt: number; keys: ApiKey[] };
export type NorenEvent = { id: string; type: string; created: number; data: Record<string, unknown> };

const SESSION = 'noren:merchant-session';
export type Session = { token: string; address: Address };
export function savedSession(addr?: Address): Session | null {
  try {
    const s = JSON.parse(localStorage.getItem(SESSION) ?? 'null') as Session | null;
    return s && (!addr || s.address.toLowerCase() === addr.toLowerCase()) ? s : null;
  } catch {
    return null;
  }
}
export function dropSession() {
  try {
    localStorage.removeItem(SESSION);
  } catch {
    /* ignore */
  }
}

/** Sign-In with Ethereum (EIP-4361) against Noren's API: one signature, no transaction. */
export async function signIn(address: Address): Promise<Session> {
  const { nonce } = await api<{ nonce: string }>('/auth/nonce');
  const message = createSiweMessage({ domain: location.host, address, statement: 'Sign in to Noren Merchant.', uri: location.origin, version: '1', chainId: 43113, nonce });
  const w = signerClient();
  const signature = await w.signMessage({ account: w.account ?? address, message });
  const s = await api<{ token: string; address: Address }>('/auth/siwe', { message, signature });
  const session = { token: s.token, address: s.address };
  try {
    localStorage.setItem(SESSION, JSON.stringify(session));
  } catch {
    /* tab only */
  }
  return session;
}

export const merchant = {
  stores: (token: string) => api<Store[]>('/stores', { token }),
  createStore: (token: string, shopId: number, name: string) => api<{ store: Store; secretKey: string }>('/stores', { token, body: { shopId, name } }),
  newKey: (token: string, storeId: string) => api<{ key: ApiKey; secretKey: string }>(`/stores/${storeId}/keys`, { token, method: 'POST', body: {} }),
  rename: (token: string, storeId: string, name: string) => api<Store>(`/stores/${storeId}`, { token, method: 'PATCH', body: { name } }),
  invoices: (token: string, storeId: string) => api<Invoice[]>(`/stores/${storeId}/invoices`, { token }),
  events: (token: string, storeId: string) => api<NorenEvent[]>(`/stores/${storeId}/events`, { token }),
  createInvoice: (token: string, storeId: string, amountCents: number, description: string) =>
    api<Invoice & { url: string }>('/invoices', { token, body: { storeId, amountCents, description } }),
  invoice: (id: string) => api<Invoice>(`/invoices/${id}`),
  paidPublic: (id: string, tx: Hex) => api<Invoice>(`/invoices/${id}/public`, { tx }),
  shop: (shopId: number) => api<{ shopId: number; name: string; storeId: string | null }>(`/shops/${shopId}`),
};

export const cents = (c: number | bigint | undefined) => (c === undefined ? '–' : (Number(c) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
export const short = (h?: string | null, n = 6) => (h ? `${h.slice(0, n)}…${h.slice(-4)}` : '');
export const when = (s?: number) => {
  if (!s) return '–';
  const d = new Date(s * 1000), now = new Date();
  return d.toDateString() === now.toDateString()
    ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ', ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};
