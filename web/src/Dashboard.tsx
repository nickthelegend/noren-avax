import { useCallback, useEffect, useMemo, useRef, useState, type JSX, type ReactNode } from "react";
import { isAddress, type Abi, type Address } from "viem";
import { accountantOf, norenSettlementAbi } from "@noren-avax/sdk";
import { api, cents, dropSession, merchant, savedSession, short, type ApiKey, type HubStatus, type Invoice, type Method, type NorenEvent, type Session, type Store } from "./lib/api";
import { D, MERCHANT_ORIGIN, addrUrl, pub } from "./lib/chain";
import { announceTx, disconnect, isUnlocked, privateSession, restoreTestWallet, unlock, useSignerVersion, useWho, write } from "./lib/signer";
import { readBook, runTool, type Book } from "./lib/books";
import { Copy, Icon, Setup, msgOf } from "./ui";
import { LineChart, Menu, Modal, QR, Toasts, downloadCsv, toast } from "./kit";
import { TxLink } from "./tx";
import { Mark } from "./logos";
import { Onboard } from "./Onboard";

export type Tab = "home" | "balances" | "payments" | "links" | "developers" | "settings" | "onboard";
type Row = Invoice;

const STORE_KEY = "noren:merchant-store";
const readStoreId = () => { try { return localStorage.getItem(STORE_KEY); } catch { return null; } };
const saveStoreId = (id: string) => { try { localStorage.setItem(STORE_KEY, id); } catch { /* tab only */ } };
const payLink = (id: string) => `${MERCHANT_ORIGIN}/#/pay/${id}`;
const go = (h: string) => { location.hash = h; };
const STATUS: Record<string, [string, string]> = { paid: ["Succeeded", "ok"], open: ["Incomplete", "info"], expired: ["Expired", "muted"] };
const Badge = ({ s }: { s: string }) => { const [t, c] = STATUS[s] ?? [s, "info"]; return <span className={`sd-badge ${c}`}>{t}{s === "paid" && <Icon.check />}</span>; };
const settled = (r: Row) => r.status === "paid";
const n2 = (c?: number) => (c ?? 0) / 100;
const fmt = (v: number) => v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dt = (s?: number, withYear = false) => { if (!s) return "–"; const d = new Date(s * 1000); return d.toLocaleDateString([], { month: "short", day: "numeric", ...(withYear ? { year: "numeric" } : {}) }) + ", " + d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }); };

/** Payment methods, stocks first. Every one but tUSDC reaches the shop through Noren's hub as a private payment. */
const METHOD: Record<Method, [string, string, () => JSX.Element]> = {
  stocks: ["Stocks", "The customer sold test stock at the oracle price into their encrypted balance, then paid through Noren's hub", () => <Mark id="NVDA" size={16} />],
  payin3: ["Pay in 3", "Credit against the customer's stocks, three installments; paid to you in full by Noren's hub", () => <span className="sd-pm-ic round" aria-hidden><Icon.layers /></span>],
  paylater: ["Pay later", "Credit against the customer's stocks, one payment in 30 days; paid to you in full by Noren's hub", () => <span className="sd-pm-ic round" aria-hidden><Icon.clock /></span>],
  private: ["Private balance", "tUSDC from the customer's encrypted eERC balance, paid through Noren's hub", () => <span className="sd-pm-ic round" aria-hidden><Icon.eyeOff /></span>],
  credit: ["Credit", "A credit draw paid through Noren's hub", () => <span className="sd-pm-ic round" aria-hidden><Icon.layers /></span>],
  usdc: ["tUSDC", "A public tUSDC transfer from the customer's wallet, checked on chain", () => <Mark id="USDC" size={16} />],
};
const MIX: Method[] = ["stocks", "payin3", "paylater", "private", "usdc"];
const methodOf = (r: Row): Method | null => (settled(r) ? (r.method ?? "private") : null);
const PM = ({ r }: { r: Row }) => { const m = methodOf(r); if (!m) return <span className="sd-muted">–</span>; const [t, d, I] = METHOD[m]; return <span className={`sd-pm ${m === "stocks" ? "stocks" : m === "usdc" ? "usdc" : m === "private" ? "private" : "credit"}`} title={d}>{I()}{t}</span>; };
const Who = ({ r }: { r: Row }) => r.method === "usdc" ? <span className="sd-linked" title="Paid from a public wallet"><Icon.card />Public wallet</span> : <span className="sd-private"><Icon.eyeOff />Private</span>;

/* ================================================================== shell */
export function Dashboard({ tab, sub }: { tab: Tab; sub?: string }) {
  useEffect(() => { restoreTestWallet("merchant"); }, []);
  const who = useWho();
  const [session, setSession] = useState<Session | null>(() => savedSession());
  const [stores, setStores] = useState<Store[] | null>(null);
  const [storeId, setStoreId] = useState<string | null>(readStoreId);
  const [err, setErr] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [tick, setTick] = useState(0);
  const [menu, setMenu] = useState(false);
  const [palette, setPalette] = useState(false);
  const [creating, setCreating] = useState(false);
  // Stays on the onboarding flow after the store exists, for its payment-link and API-key steps.
  const [ob, setOb] = useState(false);
  useEffect(() => {
    if (!session) { setStores(null); return; }
    merchant.stores(session.token).then((s) => { setStores(s); setErr(null); }).catch((e) => { if (/session|401|expired/i.test(msgOf(e))) { dropSession(); setSession(null); } else setErr(msgOf(e)); });
  }, [session, tab]);
  const store = stores?.find((x) => x.id === storeId) ?? stores?.[0] ?? null;
  const token = session?.token ?? "";
  const refresh = useCallback(async () => {
    if (!store || !token) return;
    try { setRows(await merchant.invoices(token, store.id)); setErr(null); } catch (e) { setErr(msgOf(e)); }
    setTick((t) => t + 1);
  }, [store?.id, token]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { refresh(); const t = setInterval(refresh, 8000); return () => clearInterval(t); }, [refresh]);
  useEffect(() => setMenu(false), [tab, sub]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setPalette((p) => !p); }
      else if (e.key === "/" && !/input|textarea/i.test((e.target as HTMLElement).tagName)) { e.preventDefault(); setPalette(true); }
    };
    addEventListener("keydown", k); return () => removeEventListener("keydown", k);
  }, []);
  const signOut = () => { dropSession(); setSession(null); setStores(null); disconnect(); go("#/dashboard"); };

  const firstRun = ob || tab === "onboard" || !session || !who || (stores !== null && stores.length === 0);
  const testbar = <div className="sd-testbar">Noren Merchant · Test mode: Avalanche Fuji testnet, test tokens only. No real funds.</div>;
  if (firstRun && !(session && stores === null && tab !== "onboard" && !ob)) return (
    <div className="ob-page">
      {testbar}
      <Onboard session={who && session && session.address.toLowerCase() === who.address.toLowerCase() ? session : null} onSession={setSession} onStore={(st) => { setOb(true); setStores((l) => [...(l ?? []), st]); setStoreId(st.id); saveStoreId(st.id); }} onDone={() => { setOb(false); go("#/dashboard"); }} />
      <Toasts />
    </div>
  );
  const shop = store?.name ?? "Your shop";
  const nav: [Tab, string, () => JSX.Element, number?][] = [["home", "Home", Icon.home], ["balances", "Balances", Icon.receipt], ["payments", "Payments", Icon.card, rows?.filter(settled).length], ["links", "Payment links", Icon.link]];

  return (
    <div className="sd">
      {testbar}
      <aside className={`sd-side ${menu ? "open" : ""}`}>
        <Menu align="left" trigger={(o) => (
          <button className="sd-acct" onClick={o}><span className="sd-avatar">{shop.slice(0, 1).toUpperCase()}</span><span className="sd-acct-t"><b>{shop}</b><small className="mono">{store ? `shop #${store.shopId} · ${short(store.owner, 4)}` : "…"}</small></span><span className="sd-chev">⌄</span></button>
        )} items={[["Business settings", () => go("#/dashboard/settings")], ["Copy store ID", () => { if (store) { navigator.clipboard?.writeText(store.id); toast("Store ID copied"); } }], ...(stores && stores.length > 1 ? stores.filter((x) => x.id !== store?.id).map((x) => [`Switch to ${x.name}`, () => { saveStoreId(x.id); setStoreId(x.id); }] as [string, () => void]) : []), "sep", ["Set up a new store", () => go("#/dashboard/onboard")], ["Sign out", signOut], ["View landing page", () => go("#/")]]} />
        <nav className="sd-nav">
          {nav.map(([k, t, I, c]) => <a key={k} href={`#/dashboard${k === "home" ? "" : `/${k}`}`} aria-current={tab === k ? "page" : undefined}><I /><span>{t}</span>{!!c && <em>{c}</em>}</a>)}
          <span className="sd-nav-h">Developers</span>
          <a href="#/dashboard/developers" aria-current={tab === "developers" && !sub ? "page" : undefined}><Icon.code /><span>API keys</span></a>
          <a href="#/dashboard/developers/events" aria-current={tab === "developers" && sub === "events" ? "page" : undefined}><Icon.bolt /><span>Events</span></a>
        </nav>
        <div className="sd-side-foot">
          <a href="#/dashboard/settings" aria-current={tab === "settings" ? "page" : undefined}><Icon.gear /><span>Settings</span></a>
          <p className="mono lg-row"><Mark id="AVAX" size={12} /> Avalanche Fuji · 43113</p>
        </div>
      </aside>

      <div className="sd-body">
        <header className="sd-top">
          <button className="sd-icon-btn sd-burger" onClick={() => setMenu((m) => !m)} aria-label="Menu" aria-expanded={menu}><Icon.menu /></button>
          <button className="sd-search" onClick={() => setPalette(true)}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg><span>Search payments, links, events</span><kbd>⌘K</kbd></button>
          <div className="sd-top-r">
            <span className="sd-net mono"><i />Avalanche Fuji</span>
            <a className="sd-icon-btn" href="#/dashboard/developers" title="Developers" aria-label="Developers"><Icon.code /></a>
            <Menu trigger={(o) => <button className="sd-btn primary sm" onClick={o}><Icon.plus /> New</button>} items={[["Payment link", () => setCreating(true), !!store], ["API key", () => go("#/dashboard/developers")], ["Business name", () => go("#/dashboard/settings")]]} />
          </div>
        </header>

        <main className="sd-main">
          {err ? <Setup err={err} /> : !store ? <div className="sd-loading"><span className="spin" /> Loading your store…</div> : (
            <>
              {tab === "home" && <Home rows={rows} shop={shop} store={store} onCreate={() => setCreating(true)} />}
              {tab === "balances" && <Balances store={store} />}
              {tab === "payments" && (sub ? <PaymentPage id={sub} rows={rows} store={store} token={token} tick={tick} /> : <Payments rows={rows} />)}
              {tab === "links" && <Links rows={rows} onCreate={() => setCreating(true)} />}
              {tab === "developers" && <Developers sub={sub} store={store} token={token} tick={tick} onStores={() => session && merchant.stores(session.token).then(setStores).catch(() => {})} />}
              {tab === "settings" && <Settings store={store} token={token} onSaved={(s) => setStores((l) => l?.map((x) => (x.id === s.id ? s : x)) ?? null)} />}
            </>
          )}
        </main>
      </div>
      {menu && <div className="sd-scrim" onClick={() => setMenu(false)} />}
      {palette && <Palette rows={rows ?? []} onClose={() => setPalette(false)} onCreate={() => { setPalette(false); setCreating(true); }} />}
      {creating && store && <CreateLink store={store} token={token} onClose={() => setCreating(false)} onDone={(id) => { setCreating(false); refresh(); go(`#/dashboard/payments/${id}`); }} />}
      <Toasts />
    </div>
  );
}

const PageHead = ({ title, children, sub }: { title: ReactNode; children?: ReactNode; sub?: ReactNode }) => (
  <div className="sd-head"><div><h1>{title}</h1>{sub && <p>{sub}</p>}</div>{children && <div className="sd-head-act">{children}</div>}</div>
);
const Empty = ({ title, text, action }: { title: string; text: string; action?: ReactNode }) => <div className="sd-empty"><span className="sd-empty-ic"><Icon.card /></span><b>{title}</b><p>{text}</p>{action}</div>;

/* ================================================================== books (decrypted in this tab) */
function useBook(store: Store) {
  const who = useWho();
  const ver = useSignerVersion();
  const [book, setBook] = useState<Book | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const mine = !!who && who.address.toLowerCase() === store.owner.toLowerCase();
  const unlocked = isUnlocked() && mine;
  const load = useCallback(async () => {
    if (!unlocked) return;
    try { setBook(await readBook(store.owner, store.shopId)); setErr(null); } catch (e) { setErr(msgOf(e)); }
  }, [unlocked, store.owner, store.shopId, ver]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); const t = setInterval(load, 30_000); return () => clearInterval(t); }, [load]);
  const open = async () => { setBusy(true); setErr(null); try { await unlock(); } catch (e) { setErr(msgOf(e)); } finally { setBusy(false); } };
  return { book, err, busy, open, unlocked, mine, reload: load };
}

/* ================================================================== home */
type Range = "today" | "7d" | "30d" | "90d";
const RANGES: [Range, string][] = [["today", "Today"], ["7d", "Last 7 days"], ["30d", "Last 4 weeks"], ["90d", "Last 3 months"]];
function buckets(range: Range, offset = 0) {
  const now = Math.floor(Date.now() / 1000), H = 3600, DAY = 86400;
  if (range === "today") { const start = new Date(); start.setHours(0, 0, 0, 0); const s = Math.floor(start.getTime() / 1000) - offset * DAY; return { start: s, step: H, n: 24, end: s + DAY, label: (t: number) => new Date(t * 1000).toLocaleTimeString([], { hour: "numeric" }) }; }
  const days = range === "7d" ? 7 : range === "30d" ? 28 : 90;
  const end = Math.floor(now / DAY) * DAY + DAY - offset * days * DAY, start = end - days * DAY;
  return { start, step: DAY, n: days, end, label: (t: number) => new Date(t * 1000).toLocaleDateString([], { month: "short", day: "numeric" }) };
}
function series(rows: Row[], range: Range, offset: number, pick: (r: Row) => number, at: (r: Row) => number | undefined = (r) => r.paidAt, cumulative = false) {
  const b = buckets(range, offset), vals = Array.from({ length: b.n }, () => 0);
  for (const r of rows) { const t = at(r); if (!t || t < b.start || t >= b.end) continue; vals[Math.floor((t - b.start) / b.step)] += pick(r); }
  if (cumulative) for (let i = 1; i < vals.length; i++) vals[i] += vals[i - 1];
  return { vals, labels: vals.map((_, i) => b.label(b.start + i * b.step)), total: vals.reduce((a, v) => a + v, 0) };
}
const delta = (cur: number, prev: number) => prev === 0 ? (cur === 0 ? null : "new") : `${cur >= prev ? "+" : ""}${(((cur - prev) / prev) * 100).toFixed(1)}%`;

function Home({ rows, shop, store, onCreate }: { rows: Row[] | null; shop: string; store: Store; onCreate: () => void }) {
  const [range, setRange] = useState<Range>("7d");
  const r = rows ?? [];
  const paid = r.filter(settled);
  const today = series(paid, "today", 0, (x) => n2(x.amountCents), undefined, true);
  const yday = series(paid, "today", 1, (x) => n2(x.amountCents), undefined, true);
  const hub = useHub();
  const books = useBook(store);
  const gross = series(paid, range, 0, (x) => n2(x.amountCents)), grossP = series(paid, range, 1, (x) => n2(x.amountCents));
  const count = series(paid, range, 0, () => 1), countP = series(paid, range, 1, () => 1);
  const links = series(r, range, 0, () => 1, (x) => x.createdAt), linksP = series(r, range, 1, () => 1, (x) => x.createdAt);
  const stockVol = series(paid.filter((x) => x.method === "stocks" || x.method === "payin3" || x.method === "paylater"), range, 0, (x) => n2(x.amountCents)), stockVolP = series(paid.filter((x) => x.method === "stocks" || x.method === "payin3" || x.method === "paylater"), range, 1, (x) => n2(x.amountCents));
  const cards: [string, { vals: number[]; total: number }, number, (v: number) => string, string][] = [
    ["Gross volume", gross, grossP.total, (v) => `${fmt(v)} tUSDC`, "Paid invoices"],
    ["Paid with stocks", stockVol, stockVolP.total, (v) => `${fmt(v)} tUSDC`, "Pay with stocks, pay in 3 and pay later (credit against stocks)"],
    ["Successful payments", count, countP.total, (v) => String(Math.round(v)), "Paid invoices"],
    ["Payment links created", links, linksP.total, (v) => String(Math.round(v)), "Including unpaid and expired"],
    ["Average payment", { vals: gross.vals.map((v, i) => (count.vals[i] ? v / count.vals[i] : 0)), total: count.total ? gross.total / count.total : 0 }, countP.total ? grossP.total / countP.total : 0, (v) => `${fmt(v)} tUSDC`, "Gross volume ÷ payments"],
  ];
  const now = Date.now() / 1000;
  return (
    <>
      <PageHead title="Today" sub={<>Noren lets merchants accept stablecoins, stocks or credit — privately. Welcome back, {shop}: amounts are decrypted in this tab, and nothing here identifies a customer.</>}>
        <button className="sd-btn primary" onClick={onCreate}><Icon.plus /> Create payment link</button>
      </PageHead>

      <section className="sd-today">
        <div className="sd-today-chart">
          <div className="sd-kv-row">
            <div><span>Gross volume</span><b>{fmt(today.total ? today.vals[today.vals.length - 1] : 0)} <em>tUSDC</em></b><small>{new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</small></div>
            <div className="muted"><span>Yesterday</span><b>{fmt(yday.vals[yday.vals.length - 1] ?? 0)} <em>tUSDC</em></b></div>
          </div>
          <LineChart series={[{ label: "Today", values: today.vals.slice(0, new Date().getHours() + 1) }, { label: "Yesterday", values: yday.vals, dashed: true }]} labels={today.labels} height={150} format={(v) => `${fmt(v)} tUSDC`} />
          <div className="sd-axis mono"><span>12:00 AM</span><span>Now, {new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span><span>11:59 PM</span></div>
        </div>
        <div className="sd-today-side">
          <div className="sd-stat"><span>Private balance</span>
            {books.unlocked ? <b>{books.book ? fmt(Number(books.book.balance) / 100) : <span className="sd-skel w80" />} <em>tUSDC</em></b> : <b className="sd-enc">Encrypted</b>}
            <small>{books.err ? <span className="sd-err-t">{books.err}</span> : books.unlocked ? "eERC balance, decrypted in this tab with your key" : books.mine ? "Snowtrace shows ciphertext. Sign once to read it here." : "Sign in with the store’s wallet to read it."}</small>
            {books.unlocked ? <a href="#/dashboard/balances">View balance <Icon.arrow /></a> : books.mine && <button className="sd-btn sm" disabled={books.busy} onClick={books.open}>{books.busy ? <span className="spin" /> : <Icon.lock />} Decrypt</button>}
          </div>
          <div className="sd-stat"><span>Payouts</span><b>Every {hub.data ? Math.round(hub.data.everySec / 60) : 3} min</b><small>Noren’s hub pays you in a batch with other shops{hub.data ? ` · next ${hub.data.nextSettleAt > now ? `in ${Math.max(1, Math.round((hub.data.nextSettleAt - now) / 60))} min` : "now"}` : ""}.</small></div>
          <div className="sd-stat accent"><span>Customers identified</span><b>0</b><small>of {paid.filter((x) => x.method !== "usdc").length} private payments. They reach you from Noren’s hub, never from a customer’s wallet.</small></div>
        </div>
      </section>

      <div className="sd-section-h">
        <h2>Your overview</h2>
        <div className="sd-seg">{RANGES.map(([k, t]) => <button key={k} aria-pressed={range === k} onClick={() => setRange(k)}>{t}</button>)}</div>
      </div>
      <section className="sd-cards">
        {cards.map(([t, s, prev, f, hint]) => {
          const d = delta(s.total, prev);
          return (
            <article className="sd-card" key={t} title={hint}>
              <header><span>{t}</span>{d && <em className={d.startsWith("-") ? "down" : "up"}>{d}</em>}</header>
              <b>{f(s.total)}</b>
              <small>{f(prev)} previous period</small>
              {rows === null ? <div className="sd-skel h60" /> : <LineChart compact series={[{ label: t, values: s.vals }]} labels={series([], range, 0, () => 0).labels} height={64} format={f} />}
              <div className="sd-axis mono"><span>{series([], range, 0, () => 0).labels[0]}</span><span>{range === "today" ? "Now" : "Today"}</span></div>
            </article>
          );
        })}
      </section>

      <Methods rows={rows} store={store} />
      {books.unlocked && books.book && <Assistant shop={shop} book={books.book} />}

      <div className="sd-section-h"><h2>Recent payments</h2><a className="sd-link" href="#/dashboard/payments">View all <Icon.arrow /></a></div>
      <PayTable rows={paid.slice(0, 6)} loading={!rows} />
    </>
  );
}

function useHub() {
  const [data, setData] = useState<HubStatus | null>(null);
  useEffect(() => { let on = true; const f = () => api<HubStatus>("/hub").then((h) => on && setData(h)).catch(() => {}); f(); const t = setInterval(f, 20_000); return () => { on = false; clearInterval(t); }; }, []);
  return { data };
}

/** Payment-method mix (stocks first) and the shop's payouts that Noren's hub recorded on NorenSettlement. */
function Methods({ rows, store }: { rows: Row[] | null; store: Store }) {
  const paid = (rows ?? []).filter(settled);
  const mix = MIX.map((m) => { const xs = paid.filter((x) => methodOf(x) === m); return { m, n: xs.length, v: xs.reduce((a, x) => a + n2(x.amountCents), 0) }; });
  const total = mix.reduce((a, x) => a + x.v, 0);
  const batches = new Set(paid.map((x) => x.batch).filter((b) => b != null));
  const lastPayout = paid.filter((x) => x.payoutTx).sort((a, b) => (b.paidAt ?? 0) - (a.paidAt ?? 0))[0];
  return (
    <section className="sd-methods">
      <div>
        <div className="sd-section-h tight"><h2>Payment methods</h2><span className="sd-muted">{paid.length} paid</span></div>
        <div className="sd-mix" aria-hidden>{total > 0 && mix.map((x) => x.v > 0 && <i key={x.m} className={x.m === "stocks" ? "stocks" : x.m === "usdc" ? "usdc" : x.m === "private" ? "private" : "credit"} style={{ width: `${(x.v / total) * 100}%` }} />)}</div>
        <ul className="sd-mix-l">{mix.map((x) => { const [t, d, I] = METHOD[x.m]; return <li key={x.m} title={d}><span className={`sd-pm ${x.m === "stocks" ? "stocks" : x.m === "usdc" ? "usdc" : x.m === "private" ? "private" : "credit"}`}>{I()}{t}</span><b className="num">{fmt(x.v)} <em className="lg-row"><Mark id="USDC" size={14} />tUSDC</em></b><small>{x.n} payment{x.n === 1 ? "" : "s"}{total > 0 && ` · ${Math.round((x.v / total) * 100)}%`}</small></li>; })}</ul>
      </div>
      <div className="sd-exposure">
        <div className="sd-section-h tight"><h2>Settlement</h2></div>
        <dl className="sd-dl">
          <dt>Batches that paid you</dt><dd className="num">{batches.size}</dd>
          <dt>Last payout</dt><dd>{lastPayout ? <TxLink hash={lastPayout.payoutTx} n={6} /> : "–"}</dd>
          <dt>Waiting for a batch</dt><dd className="num">{paid.filter((x) => !x.payoutTx && x.method !== "usdc").length}</dd>
          <dt>Your credit exposure</dt><dd><b>0.00 tUSDC</b> · pay in 3 and pay later are paid to you in full</dd>
        </dl>
        <p className="sd-muted sm">Payouts are eERC transfers from Noren’s hub, recorded on <a href={addrUrl(D.norenSettlement!)} target="_blank" rel="noreferrer">NorenSettlement</a> with a digest of your statement. Shop #{store.shopId}.</p>
      </div>
    </section>
  );
}

/* ================================================================== assistant */
type Block = { type: "text"; text: string } | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> } | { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean };
type Msg = { role: "user" | "assistant"; content: string | Block[] };
function Assistant({ shop, book }: { shop: string; book: Book }) {
  const [view, setView] = useState<{ kind: "user" | "bot" | "tool"; text: string }[]>([]);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const convo = useRef<Msg[]>([]);
  async function ask(text: string) {
    if (!text.trim() || busy) return;
    setBusy(true); setErr(null); setQ("");
    const add = (v: { kind: "user" | "bot" | "tool"; text: string }) => setView((xs) => [...xs, v]);
    add({ kind: "user", text });
    const before = convo.current.length;
    convo.current.push({ role: "user", content: text });
    try {
      for (let turn = 0; turn < 5; turn++) {
        const r = await api<{ stop_reason: string; content: Block[] }>("/ask", { messages: convo.current });
        convo.current.push({ role: "assistant", content: r.content });
        for (const b of r.content) if (b.type === "text" && b.text.trim()) add({ kind: "bot", text: b.text.trim() });
        const calls = r.content.filter((b): b is Extract<Block, { type: "tool_use" }> => b.type === "tool_use");
        if (r.stop_reason !== "tool_use" || !calls.length) break;
        convo.current.push({ role: "user", content: calls.map((c) => { add({ kind: "tool", text: `${c.name}(${Object.entries(c.input).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join(", ")})` }); try { return { type: "tool_result" as const, tool_use_id: c.id, content: runTool(c.name, c.input, book) }; } catch (e) { return { type: "tool_result" as const, tool_use_id: c.id, content: (e as Error).message, is_error: true }; } }) });
      }
    } catch (e) { setErr(msgOf(e)); convo.current = convo.current.slice(0, before); } finally { setBusy(false); }
  }
  return (
    <section className="sd-panel sd-ask">
      <div className="sd-section-h tight"><h2>Ask about {shop}</h2><span className="sd-muted">Claude answers from your decrypted books; the tools run in this tab</span></div>
      {view.length === 0 && <div className="sd-seg">{["How much did I make this week?", "What sells best?", "Did every payout check out?"].map((s) => <button key={s} onClick={() => ask(s)} disabled={busy}>{s}</button>)}</div>}
      {view.length > 0 && <ul className="sd-ask-log">{view.map((v, i) => <li key={i} className={v.kind}>{v.kind === "tool" ? <code>{v.text}</code> : v.text}</li>)}{busy && <li className="bot"><span className="spin xs" /></li>}</ul>}
      <form className="sd-row" onSubmit={(e) => { e.preventDefault(); ask(q); }}><input className="sd-input" placeholder="Ask about sales, items or payouts" value={q} onChange={(e) => setQ(e.target.value)} /><button className="sd-btn primary" disabled={busy || !q.trim()}>Ask</button></form>
      {err && <p className="sd-err-t">{err}</p>}
      <p className="sd-help">Your key and books stay in this tab. Claude sees only what the tools return.</p>
    </section>
  );
}

/* ================================================================== balances */
function Balances({ store }: { store: Store }) {
  const books = useBook(store);
  const b = books.book;
  const [amt, setAmt] = useState("");
  const [busy, setBusy] = useState(false);
  const out = b?.withdrawn.reduce((a, w) => a + w.cents, 0n) ?? 0n;
  const withdraw = async () => {
    const c = BigInt(Math.round(Number(amt) * 100));
    if (!b || c <= 0n || c > b.balance) return toast("Enter an amount up to your private balance", "err");
    setBusy(true);
    try { const h = await privateSession().withdraw(c); announceTx(h, `withdraw ${cents(Number(c))} tUSDC`); toast(`Withdrew ${cents(Number(c))} tUSDC to your wallet`); setAmt(""); books.reload(); } catch (e) { toast(msgOf(e), "err"); } finally { setBusy(false); }
  };
  const exportCsv = () => b && downloadCsv(`noren-payouts-${new Date().toISOString().slice(0, 10)}.csv`, [["batch", "date", "amount_tusdc", "orders", "cover", "checks", "tx"], ...b.payouts.map((p) => [p.batch ?? "", new Date(p.time * 1000).toISOString(), p.cents != null ? (Number(p.cents) / 100).toFixed(2) : "", p.lines, p.cover ? "yes" : "no", p.problems.length ? p.problems.join("; ") : "ok", p.tx])]);
  return (
    <>
      <PageHead title="Balances" sub="Noren’s hub pays you in encrypted batches. Your balance and payouts decrypt here, with your key, and nowhere else.">
        <button className="sd-btn" onClick={exportCsv} disabled={!b?.payouts.length}>Export CSV</button>
      </PageHead>
      {!books.unlocked ? (
        <section className="sd-panel narrow">
          <h2>Encrypted</h2>
          <p className="sd-muted">Snowtrace shows only that Noren’s hub paid shop #{store.shopId}, never who the customers were or how much. {books.mine ? "Sign once to derive your key and decrypt your books here." : "Sign in with the store’s wallet to decrypt."}</p>
          {books.mine && <button className="sd-btn primary" disabled={books.busy} onClick={books.open}>{books.busy ? <><span className="spin" /> Decrypting…</> : <><Icon.lock /> Decrypt my books</>}</button>}
          {books.err && <p className="sd-err-t">{books.err}</p>}
        </section>
      ) : (
        <>
          <section className="sd-bal">
            <div className="sd-bal-main">
              <span>Private balance</span>
              <b>{b ? fmt(Number(b.balance) / 100) : <span className="sd-skel w120" />} <em>tUSDC</em></b>
              <ul>
                <li><i className="dot a" /><span>Paid out to you</span><b>{b ? fmt(b.payouts.reduce((a, p) => a + Number(p.cents ?? 0n), 0) / 100) : "…"} tUSDC</b></li>
                <li><i className="dot b" /><span>Withdrawn to your wallet</span><b>{fmt(Number(out) / 100)} tUSDC</b></li>
              </ul>
              <div className="sd-row"><input className="sd-input" inputMode="decimal" placeholder="Amount" value={amt} onChange={(e) => setAmt(e.target.value.replace(/[^0-9.]/g, ""))} aria-label="Withdraw amount" /><button className="sd-btn primary" disabled={busy || !b} onClick={withdraw}>{busy ? <><span className="spin" /> Proving…</> : "Withdraw"}</button></div>
              <p className="sd-help">A withdrawal is public: it moves tUSDC out of eERC to your wallet.</p>
              {books.err && <p className="sd-err-t">{books.err}</p>}
            </div>
            <dl className="sd-dl">
              <dt>Payout wallet</dt><dd className="mono">{short(store.owner, 8)} <Copy text={store.owner} /></dd>
              <dt>Settlement asset</dt><dd><span className="lg-row"><Mark id="USDC" size={16} />tUSDC</span> in <a href={addrUrl(D.encryptedERC)} target="_blank" rel="noreferrer">Ava Labs eERC</a> on <span className="lg-row"><Mark id="AVAX" size={16} />Avalanche Fuji</span></dd>
              <dt>Payout timing</dt><dd>Batches every 3 minutes, with zero-value covers to other shops</dd>
              <dt>Checks</dt><dd>Each statement is checked against your decrypted payout and the digest on NorenSettlement</dd>
            </dl>
          </section>
          <div className="sd-section-h"><h2>Payouts</h2><span className="sd-muted">{b?.payouts.length ?? 0}</span></div>
          <div className="sd-table-wrap">
            {!b ? <div className="sd-skel-rows"><i /><i /><i /></div> : b.payouts.length === 0 ? <Empty title="No payouts yet" text="Payouts appear after the hub’s next batch, every 3 minutes." /> : (
              <table className="sd-table">
                <thead><tr><th>Batch</th><th className="r">Amount</th><th className="hide-s">Orders</th><th>Checks</th><th className="hide-s">Transaction</th><th>Date</th></tr></thead>
                <tbody>{b.payouts.map((p) => (
                  <tr key={p.tx}>
                    <td><span className="sd-type">#{p.batch}{p.cover ? " · cover" : ""}</span></td>
                    <td className="r num">{p.cents != null ? fmt(Number(p.cents) / 100) : "?"} <span className="sd-muted">tUSDC</span></td>
                    <td className="hide-s">{p.lines}</td>
                    <td>{p.problems.length ? <span className="sd-badge bad" title={p.problems.join("; ")}>Mismatch</span> : <span className="sd-badge ok">Checked <Icon.check /></span>}</td>
                    <td className="hide-s"><TxLink hash={p.tx} /></td>
                    <td className="sd-muted">{dt(p.time)}</td>
                  </tr>
                ))}</tbody>
              </table>
            )}
          </div>
        </>
      )}
    </>
  );
}

/* ================================================================== payments */
type Filter = "all" | "paid" | "open" | "expired";
function Payments({ rows }: { rows: Row[] | null }) {
  const [f, setF] = useState<Filter>("paid");
  const [q, setQ] = useState("");
  const [range, setRange] = useState<"all" | Range>("all");
  const [pm, setPm] = useState<"all" | Method>("all");
  const r = (rows ?? []).filter((x) => pm === "all" || methodOf(x) === pm);
  const inRange = (x: Row) => { if (range === "all") return true; const b = buckets(range); const t = x.paidAt ?? x.createdAt; return t >= b.start && t < b.end; };
  const match = (x: Row) => !q || [x.id, x.description, x.paymentTx, cents(x.amountCents)].some((v) => v && String(v).toLowerCase().includes(q.toLowerCase()));
  const byStatus = (x: Row, k: Filter) => k === "all" || x.status === k;
  const shown = r.filter((x) => byStatus(x, f) && match(x) && inRange(x));
  const counts = Object.fromEntries((["all", "paid", "open", "expired"] as Filter[]).map((k) => [k, r.filter((x) => byStatus(x, k) && match(x) && inRange(x)).length])) as Record<Filter, number>;
  const exportCsv = () => downloadCsv(`noren-payments-${new Date().toISOString().slice(0, 10)}.csv`, [["invoice_id", "status", "amount_tusdc", "description", "created", "paid", "payment_tx", "batch", "payout_tx", "method", "customer"], ...shown.map((x) => [x.id, x.status, n2(x.amountCents).toFixed(2), x.description ?? "", new Date(x.createdAt * 1000).toISOString(), x.paidAt ? new Date(x.paidAt * 1000).toISOString() : "", x.paymentTx ?? "", x.batch ?? "", x.payoutTx ?? "", methodOf(x) ?? "", x.method === "usdc" ? "public wallet" : settled(x) ? "private" : ""])]);
  return (
    <>
      <PageHead title="Payments"><button className="sd-btn" onClick={exportCsv} disabled={!shown.length}>Export</button></PageHead>
      <div className="sd-tabs" role="tablist">
        {([["all", "All"], ["paid", "Succeeded"], ["open", "Incomplete"], ["expired", "Expired"]] as [Filter, string][]).map(([k, t]) => <button key={k} role="tab" aria-selected={f === k} onClick={() => setF(k)}><span>{t}</span><b>{counts[k]}</b></button>)}
      </div>
      <div className="sd-filters">
        <label className="sd-filter-search"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg><input placeholder="Filter by ID, description, amount or tx" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filter payments" /></label>
        <Menu align="left" trigger={(o) => <button className={`sd-chip ${range !== "all" ? "on" : ""}`} onClick={o}><Icon.plus /> Date{range !== "all" && `: ${RANGES.find(([k]) => k === range)?.[1]}`}</button>} items={[["Any time", () => setRange("all")], ...RANGES.map(([k, t]) => [t, () => setRange(k)] as [string, () => void])]} />
        <Menu align="left" trigger={(o) => <button className={`sd-chip ${pm !== "all" ? "on" : ""}`} onClick={o}><Icon.plus /> Payment method{pm !== "all" && `: ${METHOD[pm][0]}`}</button>} items={[["Any method", () => setPm("all")], ...MIX.map((k) => [METHOD[k][0], () => setPm(k)] as [string, () => void])]} />
      </div>
      <PayTable rows={shown} loading={!rows} />
      {rows && <p className="sd-foot-n">{shown.length} result{shown.length === 1 ? "" : "s"}</p>}
    </>
  );
}

function PayTable({ rows, loading }: { rows: Row[]; loading?: boolean }) {
  if (loading) return <div className="sd-table-wrap"><div className="sd-skel-rows"><i /><i /><i /></div></div>;
  if (!rows.length) return <div className="sd-table-wrap"><Empty title="No payments match" text="Create a payment link and pay it on the hosted checkout. It shows up here when Noren’s hub reads it, within seconds." action={<a className="sd-btn sm" href="#/dashboard/links">Go to payment links</a>} /></div>;
  return (
    <div className="sd-table-wrap">
      <table className="sd-table">
        <thead><tr><th className="r">Amount</th><th /><th>Status</th><th className="hide-s">Payment method</th><th className="hide-m">Description</th><th>Customer</th><th className="hide-m">Payout</th><th className="hide-s">Date</th><th /></tr></thead>
        <tbody>{rows.map((x) => (
          <tr key={x.id} tabIndex={0} onClick={() => go(`#/dashboard/payments/${x.id}`)} onKeyDown={(e) => e.key === "Enter" && go(`#/dashboard/payments/${x.id}`)}>
            <td className="r num"><b>{cents(x.amountCents)}</b></td>
            <td className="sd-cur"><span className="lg-row"><Mark id="USDC" size={16} />tUSDC</span></td>
            <td><Badge s={x.status} /></td>
            <td className="hide-s"><PM r={x} /></td>
            <td className="hide-m sd-desc">{x.description || <span className="sd-muted mono">{x.id}</span>}</td>
            <td>{settled(x) ? <Who r={x} /> : <span className="sd-muted">–</span>}</td>
            <td className="hide-m">{x.payoutTx ? <TxLink hash={x.payoutTx}>batch #{x.batch}</TxLink> : x.method === "usdc" ? <TxLink hash={x.paymentTx} /> : settled(x) ? <span className="sd-muted">next batch</span> : <span className="sd-muted">–</span>}</td>
            <td className="hide-s sd-muted">{dt(x.paidAt ?? x.createdAt)}</td>
            <td className="r"><Menu trigger={(o) => <button className="sd-icon-btn sm" onClick={o} aria-label="Row actions">⋯</button>} items={[["View payment details", () => go(`#/dashboard/payments/${x.id}`)], ["Copy payment ID", () => { navigator.clipboard?.writeText(x.id); toast("Payment ID copied"); }], ["Copy checkout link", () => { navigator.clipboard?.writeText(payLink(x.id)); toast("Checkout link copied"); }], ["Open hosted checkout", () => go(`#/pay/${x.id}`)]]} /></td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

/* ================================================================== payment detail */
function PaymentPage({ id, rows, store, token, tick }: { id: string; rows: Row[] | null; store: Store; token: string; tick: number }) {
  const r = rows?.find((x) => x.id === id);
  const [events, setEvents] = useState<NorenEvent[] | null>(null);
  useEffect(() => { merchant.events(token, store.id).then((l) => setEvents(l.filter((e) => String(e.data?.id ?? e.data?.invoiceId ?? "") === id))).catch(() => setEvents([])); }, [token, store.id, id, tick]);
  if (!rows) return <div className="sd-loading"><span className="spin" /> Loading payment…</div>;
  if (!r) return <><a className="sd-back" href="#/dashboard/payments"><Icon.back /> Payments</a><Empty title="Payment not found" text={`No payment ${id} in this store's records.`} /></>;
  const pub_ = r.method === "usdc";
  const steps: [string, number | undefined, ReactNode, boolean][] = pub_ ? [
    ["Payment link created", r.createdAt, r.description ? `“${r.description}”` : null, true],
    ["Paid with tUSDC from a public wallet", r.paidAt, r.paymentTx ? <><TxLink hash={r.paymentTx} n={8} /> · checked on chain by Noren’s API</> : null, settled(r)],
  ] : [
    ["Payment link created", r.createdAt, r.description ? `“${r.description}”` : null, true],
    [`Paid privately to Noren’s hub${r.method === "stocks" ? ", with stocks" : r.method === "payin3" ? ", in 3" : r.method === "paylater" ? ", later" : ""}`, r.paidAt, r.paymentTx ? <><TxLink hash={r.paymentTx} n={8} /> · eERC transfer, amount encrypted; the hub read the order from its encrypted note</> : null, settled(r)],
    ["Paid out to you in a batch", r.payoutTx ? r.paidAt : undefined, r.payoutTx ? <>batch #{r.batch} · <TxLink hash={r.payoutTx} n={8} /> · with zero-value covers to other shops</> : null, !!r.payoutTx],
  ];
  return (
    <>
      <a className="sd-back" href="#/dashboard/payments"><Icon.back /> Payments</a>
      <div className="sd-pay-head">
        <div>
          <span className="sd-eyebrow">Payment</span>
          <h1><span className="num">{cents(r.amountCents)}</span> <em className="lg-row"><Mark id="USDC" size={24} />tUSDC</em> <Badge s={r.status} /></h1>
        </div>
        <div className="sd-head-act">
          <Menu trigger={(o) => <button className="sd-btn" onClick={o} aria-label="More actions">⋯</button>} items={[["Copy payment ID", () => { navigator.clipboard?.writeText(r.id); toast("Payment ID copied"); }], ["Copy checkout link", () => { navigator.clipboard?.writeText(payLink(r.id)); toast("Checkout link copied"); }], ["Open hosted checkout", () => go(`#/pay/${r.id}`)]]} />
        </div>
      </div>
      <div className="sd-summary">
        <div><span>Last update</span><b>{dt(r.paidAt ?? r.createdAt)}</b></div>
        <div><span>Customer</span><b>{settled(r) ? <Who r={r} /> : "–"}</b></div>
        <div><span>Payment method</span><b><PM r={r} /></b></div>
        <div><span>Network fee</span><b>{settled(r) ? "paid by the customer" : "–"}</b></div>
      </div>
      <div className="sd-detail-grid">
        <div>
          <section className="sd-panel">
            <h2>Timeline</h2>
            <ol className="sd-tl">{steps.map(([t, at, d, on]) => <li key={t} data-on={on}><i /><div><b>{t}</b><span>{on ? dt(at, true) : "Not yet"}</span>{on && d && <p>{d}</p>}</div></li>)}</ol>
          </section>
          <section className="sd-panel">
            <h2>Events</h2>
            {events === null ? <div className="sd-skel-rows"><i /></div> : events.length === 0 ? <p className="sd-muted">No events recorded for this payment.</p> : (
              <ul className="sd-evmini">{events.map((e) => <li key={e.id}><code>{e.type}</code><span className="sd-badge muted">Recorded</span><span className="sd-muted">{dt(e.created)}</span></li>)}</ul>
            )}
          </section>
        </div>
        <div>
          <section className="sd-panel">
            <h2>Payment details</h2>
            <dl className="sd-dl">
              <dt>Payment ID</dt><dd className="mono">{r.id} <Copy text={r.id} /></dd>
              <dt>Amount</dt><dd>{cents(r.amountCents)} tUSDC</dd>
              <dt>Description</dt><dd>{r.description || "–"}</dd>
              <dt>Expires</dt><dd>{dt(r.expiresAt, true)}</dd>
              <dt>Checkout</dt><dd><a href={`#/pay/${r.id}`} className="mono">/pay/{r.id}</a></dd>
            </dl>
          </section>
          <section className="sd-panel">
            <h2>Payment method</h2>
            {pub_ ? (
              <dl className="sd-dl"><dt>Type</dt><dd>Public tUSDC transfer</dd><dt>Customer</dt><dd>a public wallet (visible on Snowtrace)</dd></dl>
            ) : (
              <dl className="sd-dl">
                <dt>Type</dt><dd>{r.method === "stocks" ? "Stocks sold at checkout, then an eERC payment" : r.method === "payin3" ? "Pay in 3 against stocks, then an eERC payment" : r.method === "paylater" ? "Pay later against stocks, then an eERC payment" : "eERC private payment"}</dd>
                <dt>Rail</dt><dd><a href={addrUrl(D.encryptedERC)} target="_blank" rel="noreferrer">Ava Labs EncryptedERC</a> · Groth16 proof made in the customer’s browser</dd>
                <dt>Amount on chain</dt><dd className="sd-private">encrypted</dd>
                <dt>Payer</dt><dd className="sd-private">not known to you: Noren’s hub paid you</dd>
                <dt>Your risk</dt><dd>None: paid in full{r.method === "payin3" || r.method === "paylater" ? "; the customer owes the Earn pool, not you" : ""}</dd>
              </dl>
            )}
          </section>
        </div>
      </div>
    </>
  );
}

/* ================================================================== links */
function Links({ rows, onCreate }: { rows: Row[] | null; onCreate: () => void }) {
  const [qr, setQr] = useState<Row | null>(null);
  const links = (rows ?? []).filter((x) => x.status === "open" || x.status === "expired");
  return (
    <>
      <PageHead title="Payment links" sub="Share a link anywhere. Customers pay with stocks, in 3, or privately on Noren’s hosted checkout."><button className="sd-btn primary" onClick={onCreate}><Icon.plus /> Create payment link</button></PageHead>
      <div className="sd-table-wrap">
        {!rows ? <div className="sd-skel-rows"><i /><i /></div> : links.length === 0 ? <Empty title="No open payment links" text="Create one to start accepting private payments. Paid links move to Payments." action={<button className="sd-btn sm primary" onClick={onCreate}><Icon.plus /> Create payment link</button>} /> : (
          <table className="sd-table">
            <thead><tr><th>Link</th><th className="r">Price</th><th>Status</th><th className="hide-s">Created</th><th className="hide-s">Expires</th><th /></tr></thead>
            <tbody>{links.map((x) => (
              <tr key={x.id} onClick={() => go(`#/dashboard/payments/${x.id}`)}>
                <td><div className="sd-linkcell"><b>{x.description || "Payment"}</b><span className="mono">/pay/{x.id}</span></div></td>
                <td className="r num"><b>{cents(x.amountCents)}</b> <span className="sd-muted">tUSDC</span></td>
                <td><Badge s={x.status} /></td>
                <td className="hide-s sd-muted">{dt(x.createdAt)}</td>
                <td className="hide-s sd-muted">{dt(x.expiresAt)}</td>
                <td className="r">{x.status !== "expired" && <span className="sd-row-act"><button className="sd-btn xs" onClick={(e) => { e.stopPropagation(); navigator.clipboard?.writeText(payLink(x.id)); toast("Link copied"); }}>Copy link</button><button className="sd-btn xs" onClick={(e) => { e.stopPropagation(); setQr(x); }}>QR</button></span>}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>
      {qr && <Modal title="Scan to pay" onClose={() => setQr(null)}><div className="sd-qr-wrap"><QR text={payLink(qr.id)} size={220} /><b>{cents(qr.amountCents)} tUSDC</b><span className="sd-muted">{qr.description || "Payment"}</span><Copy text={payLink(qr.id)} label="Copy link" /></div></Modal>}
    </>
  );
}

function CreateLink({ store, token, onClose, onDone }: { store: Store; token: string; onClose: () => void; onDone: (id: string) => void }) {
  const [amount, setAmount] = useState("7.50");
  const [desc, setDesc] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const v = Number(amount || 0);
  const create = async () => {
    setBusy(true); setErr(null);
    try {
      if (!(v > 0)) throw new Error("Enter an amount above 0");
      const r = await merchant.createInvoice(token, store.id, Math.round(v * 100), desc.trim() || "Payment");
      toast("Payment link created"); navigator.clipboard?.writeText(r.url ?? payLink(r.id)).catch(() => {}); onDone(r.id);
    } catch (e) { setErr(msgOf(e)); } finally { setBusy(false); }
  };
  return (
    <Modal wide title="Create a payment link" onClose={onClose} footer={<><span className="sd-muted sm">The link is copied when you create it. It expires after 24 hours.</span><button className="sd-btn" onClick={onClose}>Cancel</button><button className="sd-btn primary" disabled={busy || !(v > 0)} onClick={create}>{busy ? <><span className="spin" /> Creating…</> : "Create link"}</button></>}>
      <div className="sd-builder">
        <div className="sd-builder-form">
          <label className="sd-label" htmlFor="cl-desc">Product or service</label>
          <input id="cl-desc" className="sd-input" maxLength={60} placeholder="Flat white" value={desc} onChange={(e) => setDesc(e.target.value)} autoFocus />
          <p className="sd-help">Only you, Noren’s hub and the customer see this. On chain it travels encrypted.</p>
          <label className="sd-label" htmlFor="cl-amt">Price</label>
          <div className="sd-input-money"><input id="cl-amt" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} /><select value="tUSDC" aria-label="Currency" onChange={() => {}}><option>tUSDC</option></select></div>
          <p className="sd-help">Customers can pay it with stocks, in 3 against their stocks, from a private balance or in tUSDC.</p>
          {err && <p className="sd-error" role="alert">{err}</p>}
        </div>
        <div className="sd-builder-preview" aria-label="Checkout preview">
          <span className="sd-eyebrow">Preview</span>
          <div className="sd-prev">
            <div className="sd-prev-l"><span className="sd-prev-shop"><i>{store.name.slice(0, 1).toUpperCase()}</i>{store.name}</span><small>Pay {store.name}</small><b>{fmt(v)}<em>tUSDC</em></b><span className="sd-prev-line"><span>{desc || "Payment"}</span><span>{fmt(v)}</span></span></div>
            <div className="sd-prev-r"><span>Pay with <em>stocks</em></span><i /><i /><i /><span className="sd-prev-btn">Pay {fmt(v)} with tNVDA</span></div>
          </div>
        </div>
      </div>
    </Modal>
  );
}

/* ================================================================== developers */
function Developers({ sub, store, token, tick, onStores }: { sub?: string; store: Store; token: string; tick: number; onStores: () => void }) {
  const t = sub === "events" ? "events" : "keys";
  return (
    <>
      <PageHead title={t === "keys" ? "API keys" : "Events"} sub={t === "keys" ? "Authenticate requests to Noren’s API from your server." : "Everything that happened to your store."} />
      {t === "keys" ? <StoreKeys store={store} token={token} onChange={onStores} /> : <Events store={store} token={token} tick={tick} />}
    </>
  );
}

function StoreKeys({ store, token, onChange }: { store: Store; token: string; onChange: () => void }) {
  const [fresh, setFresh] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const make = async () => { setBusy(true); try { const r = await merchant.newKey(token, store.id); setFresh(r.secretKey); onChange(); } catch (e) { toast(msgOf(e), "err"); } finally { setBusy(false); } };
  const snippet = `const res = await fetch("https://noren-avax-api.201-18-198-162.sslip.io/api/invoices", {
  method: "POST",
  headers: { authorization: \`Bearer \${process.env.NOREN_SECRET_KEY}\`, "content-type": "application/json" },
  body: JSON.stringify({ amountCents: 1250, description: "Order #1001", successUrl: "https://your-shop.example/thanks" }),
});
const invoice = await res.json(); // redirect the customer to invoice.url`;
  return (
    <>
      <div className="sd-table-wrap">
        <table className="sd-table static">
          <thead><tr><th>Name</th><th>Token</th><th className="hide-s">Created</th><th /></tr></thead>
          <tbody>
            <tr><td><b>Store ID</b><small className="sd-sub">public</small></td><td className="mono">{store.id}</td><td className="hide-s sd-muted">{dt(store.createdAt)}</td><td className="r"><Copy text={store.id} /></td></tr>
            <tr><td><b>Shop on Avalanche</b><small className="sd-sub">NorenMerchants</small></td><td className="mono">#{store.shopId} · {short(store.owner, 6)}</td><td className="hide-s sd-muted"><a href={addrUrl(D.norenMerchants)} target="_blank" rel="noreferrer">contract</a></td><td className="r"><Copy text={store.owner} /></td></tr>
            {store.keys.map((k: ApiKey) => <tr key={k.id}><td><b>Secret key</b><small className="sd-sub">test mode</small></td><td className="mono">{k.prefix}{"•".repeat(18)}</td><td className="hide-s sd-muted">{dt(k.createdAt)}</td><td /></tr>)}
          </tbody>
        </table>
      </div>
      {fresh && <div className="sd-callout"><Icon.lock /><span><b>Copy your new secret key now.</b> It is shown once; Noren keeps only its hash. <code className="mono">{fresh}</code></span><Copy text={fresh} /></div>}
      <div className="sd-row" style={{ marginTop: 14 }}><button className="sd-btn primary" disabled={busy} onClick={make}>{busy ? <span className="spin" /> : <Icon.plus />} Create secret key</button></div>
      <section className="sd-panel">
        <h2>Create a checkout from your server</h2>
        <pre className="sd-code mono">{snippet}</pre>
        <Copy text={snippet} label="Copy" />
      </section>
    </>
  );
}

function Events({ store, token, tick }: { store: Store; token: string; tick: number }) {
  const [list, setList] = useState<NorenEvent[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { merchant.events(token, store.id).then((l) => { setList(l); setErr(null); }).catch((e) => { setErr(msgOf(e)); setList([]); }); }, [store.id, token, tick]);
  return (
    <div className="sd-table-wrap">
      {err ? <div className="sd-callout bad"><span>{err}</span></div> : !list ? <div className="sd-skel-rows"><i /><i /></div> : list.length === 0 ? <Empty title="No events yet" text="invoice.created, invoice.paid and payout.settled show up here." /> : (
        <table className="sd-table static">
          <thead><tr><th>Event</th><th className="hide-s">Payment</th><th>Date</th></tr></thead>
          <tbody>{list.map((e) => <tr key={e.id}><td><code>{e.type}</code></td><td className="hide-s mono">{String(e.data?.id ?? e.data?.invoiceId ?? "–")}</td><td className="sd-muted">{dt(e.created)}</td></tr>)}</tbody>
        </table>
      )}
    </div>
  );
}

/* ================================================================== settings */
function Settings({ store, token, onSaved }: { store: Store; token: string; onSaved: (s: Store) => void }) {
  const [v, setV] = useState(store.name);
  const [busy, setBusy] = useState(false);
  const [acc, setAcc] = useState("");
  const [current, setCurrent] = useState<Address | null>(null);
  const who = useWho();
  useEffect(() => { accountantOf(pub as never, D as never, store.shopId).then((a) => setCurrent(/^0x0{40}$/.test(a) ? null : a)).catch(() => {}); }, [store.shopId, busy]);
  const save = async () => { setBusy(true); try { const s = await merchant.rename(token, store.id, v.trim()); onSaved(s); toast("Business name saved. Your checkout shows it now."); } catch (e) { toast(msgOf(e), "err"); } finally { setBusy(false); } };
  const setAccountant = async () => {
    if (!isAddress(acc)) return toast("Enter an address", "err");
    setBusy(true);
    try { await write(D.norenSettlement!, norenSettlementAbi as Abi, "setAccountant", [BigInt(store.shopId), acc], `name the accountant of shop #${store.shopId}`); toast("Accountant named on NorenSettlement"); setAcc(""); } catch (e) { toast(msgOf(e), "err"); } finally { setBusy(false); }
  };
  const mine = who?.address.toLowerCase() === store.owner.toLowerCase();
  return (
    <>
      <PageHead title="Settings" />
      <section className="sd-panel narrow">
        <h2>Public details</h2>
        <label className="sd-label" htmlFor="bn">Business name</label>
        <div className="sd-row"><input id="bn" className="sd-input" maxLength={48} value={v} placeholder="Takumi Coffee" onChange={(e) => setV(e.target.value)} /><button className="sd-btn primary" disabled={busy || !v.trim() || v.trim() === store.name} onClick={save}>{busy ? <span className="spin" /> : "Save"}</button></div>
        <p className="sd-help">Shown on your hosted checkout. It's the only thing customers learn about you, and they show you nothing at all.</p>
      </section>
      <section className="sd-panel narrow">
        <h2>Accountant</h2>
        <p className="sd-help">Noren’s hub encrypts a copy of every statement to your accountant’s eERC key. {current ? <>Now: <span className="mono">{short(current, 6)}</span>.</> : "None named yet."}</p>
        <div className="sd-row"><input className="sd-input mono" placeholder="0x… (an eERC-registered address)" value={acc} onChange={(e) => setAcc(e.target.value.trim())} /><button className="sd-btn" disabled={busy || !mine} onClick={setAccountant}>Name accountant</button></div>
        {!mine && <p className="sd-help">Sign in with the store’s wallet to change it.</p>}
      </section>
      <section className="sd-panel narrow">
        <h2>Settlement</h2>
        <dl className="sd-dl">
          <dt>Payout wallet</dt><dd className="mono">{short(store.owner, 10)} <Copy text={store.owner} /></dd>
          <dt>Asset</dt><dd>tUSDC in Ava Labs eERC (2 decimals on chain)</dd>
          <dt>Hub</dt><dd className="mono"><a href={addrUrl(D.hub!)} target="_blank" rel="noreferrer">{short(D.hub, 6)}</a> · batches every 3 minutes</dd>
          <dt>Auditor</dt><dd>The eERC auditor can decrypt every batch: <a href="#/auditor">auditor view</a></dd>
        </dl>
      </section>
    </>
  );
}

/* ================================================================== command palette */
function Palette({ rows, onClose, onCreate }: { rows: Row[]; onClose: () => void; onCreate: () => void }) {
  const [q, setQ] = useState("");
  const [i, setI] = useState(0);
  const pages: [string, string][] = [["Home", "#/dashboard"], ["Balances", "#/dashboard/balances"], ["Payments", "#/dashboard/payments"], ["Payment links", "#/dashboard/links"], ["API keys", "#/dashboard/developers"], ["Events", "#/dashboard/developers/events"], ["Settings", "#/dashboard/settings"]];
  const ql = q.toLowerCase();
  const items = useMemo(() => [
    { label: "Create payment link", hint: "Action", run: onCreate },
    ...pages.filter(([t]) => t.toLowerCase().includes(ql)).map(([t, h]) => ({ label: t, hint: "Go to", run: () => { go(h); onClose(); } })),
    ...rows.filter((x) => !q || [x.id, x.description, x.paymentTx, cents(x.amountCents)].some((v) => v && String(v).toLowerCase().includes(ql))).slice(0, 8).map((x) => ({ label: `${cents(x.amountCents)} tUSDC · ${x.description || x.id}`, hint: STATUS[x.status]?.[0] ?? x.status, run: () => { go(`#/dashboard/payments/${x.id}`); onClose(); } })),
  ], [q, rows]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => setI(0), [q]);
  return (
    <div className="sd-modal-bg top" onMouseDown={onClose}>
      <div className="sd-palette" role="dialog" aria-label="Search" onMouseDown={(e) => e.stopPropagation()}>
        <input autoFocus placeholder="Search payments, pages and actions…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setI((x) => Math.min(items.length - 1, x + 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setI((x) => Math.max(0, x - 1)); }
          else if (e.key === "Enter") items[i]?.run();
          else if (e.key === "Escape") onClose();
        }} aria-label="Search" />
        <ul>{items.length === 0 ? <li className="sd-muted pad">Nothing matches “{q}”.</li> : items.map((it, k) => <li key={it.label + k}><button aria-current={k === i} onMouseEnter={() => setI(k)} onClick={it.run}><span>{it.label}</span><em>{it.hint}</em></button></li>)}</ul>
        <footer className="mono"><span>↑↓ to move</span><span>↵ to open</span><span>esc to close</span></footer>
      </div>
    </div>
  );
}
