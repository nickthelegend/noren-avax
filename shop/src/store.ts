import { useEffect, useState, useSyncExternalStore } from 'react';
import { bySlug, MAX_QTY, type CartLine } from './catalog.ts';

// ---- tiny hash router ----
export type Route = { path: string; query: URLSearchParams };
const readRoute = (): Route => { const raw = location.hash.replace(/^#/, '') || '/'; const [path, q] = raw.split('?'); return { path: path || '/', query: new URLSearchParams(q ?? '') }; };
export function useRoute() {
  const [route, setRoute] = useState(readRoute);
  useEffect(() => { const on = () => { setRoute(readRoute()); }; addEventListener('hashchange', on); return () => removeEventListener('hashchange', on); }, []);
  return route;
}
export const go = (hash: string) => { if (location.hash !== hash) location.hash = hash; };

// ---- bag (per browser; only a convenience, the backend re-prices everything) ----
const KEY = 'aubelle.bag.v1';
let bag: CartLine[] = (() => { try { const v = JSON.parse(localStorage.getItem(KEY) ?? '[]'); return Array.isArray(v) ? v.filter((l: CartLine) => bySlug(l.slug)) : []; } catch { return []; } })();
const listeners = new Set<() => void>();
const commit = (next: CartLine[]) => { bag = next; try { localStorage.setItem(KEY, JSON.stringify(bag)); } catch { /* private mode */ } listeners.forEach(l => l()); };
export const useBag = () => useSyncExternalStore(cb => { listeners.add(cb); return () => listeners.delete(cb); }, () => bag);
export const bagActions = {
  add(slug: string, size: string) { const hit = bag.find(l => l.slug === slug && l.size === size); commit(hit ? bag.map(l => l === hit ? { ...l, qty: Math.min(MAX_QTY, l.qty + 1) } : l) : [...bag, { slug, size, qty: 1 }]); },
  setQty(slug: string, size: string, qty: number) { commit(qty <= 0 ? bag.filter(l => !(l.slug === slug && l.size === size)) : bag.map(l => l.slug === slug && l.size === size ? { ...l, qty: Math.min(MAX_QTY, qty) } : l)); },
  clear() { commit([]); },
};
export const bagTotal = (lines: CartLine[]) => lines.reduce((s, l) => s + (bySlug(l.slug)?.price ?? 0) * l.qty, 0);
export const bagCount = (lines: CartLine[]) => lines.reduce((s, l) => s + l.qty, 0);

// ---- drawer ----
let drawerOpen = false;
const drawerListeners = new Set<() => void>();
export const setDrawer = (open: boolean) => { drawerOpen = open; drawerListeners.forEach(l => l()); };
export const useDrawer = () => useSyncExternalStore(cb => { drawerListeners.add(cb); return () => drawerListeners.delete(cb); }, () => drawerOpen);

// ---- backend ----
const ORDERS = 'aubelle.orders.v1';
export type Config = { ready: boolean; missing: string[]; webhookError: string | null; server: string | null; merchant: string | null; checkoutBase: string; appBase: string };
export type Fx = { eurPerUsd: number; feed: string; updatedAt: string };
async function getJson<T>(path: string): Promise<T> { const r = await fetch(path); const body = await r.json().catch(() => ({})); if (!r.ok) throw new Error(body.error ?? `HTTP ${r.status}`); return body as T; }
export const api = {
  config: () => getJson<Config>('/api/config'),
  fx: () => getJson<Fx>('/api/fx'),
  /** An order is its Noren invoice. AUB- order ids map to invoice ids in this browser (the shop keeps no database). */
  order: (id: string) => {
    // Noren's public invoice view carries no order metadata, so the bag lines come from this browser's own record.
    let mine: Record<string, { invoiceId: string; lines: unknown[] } | string> = {};
    try { mine = JSON.parse(localStorage.getItem(ORDERS) ?? '{}'); } catch { /* private mode */ }
    const entry = /^AUB-/.test(id) ? mine[id] : Object.entries(mine).find(([, v]) => typeof v === 'object' && v.invoiceId === id)?.[1];
    const inv = typeof entry === 'object' ? entry.invoiceId : typeof entry === 'string' ? entry : /^AUB-/.test(id) ? null : id;
    if (!inv) return Promise.reject(new Error(`Order ${id} was placed in another browser. Its Noren payment page has the status.`));
    const orderId = /^AUB-/.test(id) ? id : Object.entries(mine).find(([, v]) => typeof v === 'object' && v.invoiceId === id)?.[0];
    return getJson<any>(`/api/orders/${inv}`).then((o) => ({ ...o, id: orderId ?? o.id, lines: o.lines?.length ? o.lines : typeof entry === 'object' ? entry.lines : [] }));
  },
  async checkout(lines: CartLine[]) {
    const r = await fetch('/api/checkout', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ lines }) });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(body.error ?? `Checkout failed (HTTP ${r.status})`);
    try { const m = JSON.parse(localStorage.getItem(ORDERS) ?? '{}'); m[body.orderId] = { invoiceId: body.invoiceId, lines: body.lines }; localStorage.setItem(ORDERS, JSON.stringify(m)); } catch { /* private mode */ }
    return body as { orderId: string; invoiceId: string; totalCents: number; checkoutUrl: string; popupUrl: string };
  },
};

let fxCache: Promise<Fx | null> | null = null;
export function useFx() {
  const [fx, setFx] = useState<Fx | null>(null);
  useEffect(() => { fxCache ??= api.fx().catch(() => null); fxCache.then(setFx); }, []);
  return fx;
}
export function useConfig() {
  const [config, setConfig] = useState<Config | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { api.config().then(setConfig, e => setError(e.message)); }, []);
  return { config, error };
}
export const eur = (cents: number, fx: Fx | null) => fx ? `€${(cents / 100 * fx.eurPerUsd).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : null;

// ---- the Noren pop-up checkout (like Stripe / PayPal): one at a time, shown over the shop while it is open ----
export type Pending = { orderId: string; invoiceId: string; totalCents: number; popupUrl: string; checkoutUrl: string; win: Window | null };
let pending: Pending | null = null;
const pendingListeners = new Set<() => void>();
export const setPending = (p: Pending | null) => { pending = p; pendingListeners.forEach(l => l()); };
export const usePending = () => useSyncExternalStore(cb => { pendingListeners.add(cb); return () => pendingListeners.delete(cb); }, () => pending);
/** A small centred window, opened synchronously inside the click so pop-up blockers allow it. */
export function openNorenWindow(url = ''): Window | null {
  const w = 440, h = 720;
  const left = Math.max(0, Math.round((window.screenX ?? 0) + (window.outerWidth - w) / 2));
  const top = Math.max(0, Math.round((window.screenY ?? 0) + (window.outerHeight - h) / 2));
  const win = window.open(url, 'noren-checkout', `popup=yes,width=${w},height=${h},left=${left},top=${top}`);
  if (win && !url) {
    try {
      win.document.title = 'Noren checkout';
      win.document.body.style.cssText = 'margin:0;height:100vh;display:grid;place-items:center;background:#f4efe4;color:#575c72;font:500 15px system-ui,sans-serif';
      win.document.body.textContent = 'Opening Noren checkout…';
    } catch { /* not ours to write */ }
  }
  return win;
}
