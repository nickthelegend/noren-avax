/**
 * Home: one balance (private tUSDC, public tUSDC, test stocks at their oracle price, credit available), the things
 * people do (Pay, Send privately, Earn, Credit, Swap), an in-app Pay and recent activity from this browser's
 * receipts. Every number is read live from Fuji.
 */
import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { cents, claimStockPack, getStarterPack, savedClaims, stockPackClaimed } from "../lib/api";
import { sentTxs, unlock } from "../lib/signer";
import { msgOf } from "../ui";
import { TxLink } from "../tx";
import { Mark } from "../logos";
import type { W, Tab } from "./NorenApp";
import { PayInvoice, WAYS } from "./PayInvoice";
import { Empty, shortHex } from "./kit";
import { c2, u6 } from "./acct";

const ago = (t: number) => { const s = Math.max(0, Math.floor(Date.now() / 1000) - t); return s < 60 ? "just now" : s < 3600 ? `${Math.floor(s / 60)} min ago` : s < 86400 ? `${Math.floor(s / 3600)} h ago` : new Date(t * 1000).toLocaleDateString([], { month: "short", day: "numeric" }); };

export function HomeTab({ w, go }: { w: W; go: (t: Tab) => void }) {
  const a = w.acct;
  const payRef = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [acts, setActs] = useState(() => activity(a.address));
  useEffect(() => { setActs(activity(a.address)); }, [a]);
  const available = a.credit?.available ?? null;
  const total = a.usdc + (a.priv ?? 0n) * 10_000n + a.stocks6;
  const toPay = () => { payRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }); setTimeout(() => document.getElementById("nk-paylink")?.focus(), 350); };
  const ACTIONS: { k: string; label: string; short?: string; sub: string; icon: string; on: () => void; primary?: boolean }[] = [
    { k: "pay", label: "Pay", sub: "Scan or paste a link", icon: "M4 7h16M4 12h10M4 17h7", on: toPay, primary: true },
    { k: "send", label: "Pay with stocks", short: "Stocks", sub: "Sold at checkout, privately", icon: "M5 18l5-6 4 3 5-8", on: toPay },
    { k: "credit", label: "Credit", sub: "Borrow against stock", icon: "M4 8h16v10H4zM4 12h16", on: () => go("credit") },
    { k: "earn", label: "Earn", sub: "Fund stock credit", icon: "M12 3v18M5 10l7-7 7 7", on: () => go("earn") },
    { k: "swap", label: "Swap", sub: "Stocks ⇄ tUSDC", icon: "M7 7h11l-3-3M17 17H6l3 3", on: () => go("swap") },
  ];
  return (
    <div className="nk-home">
      <div className="nk-home-main">
        <p className="nk-home-tag">Noren lets merchants accept stablecoins, stocks or credit — privately. Pay any Noren checkout with your stocks, in 3 against them, or from a private balance.</p>
        <section className="nk-wallet" aria-label="Your balance">
          <div className="nk-wallet-top"><small>Total balance</small><span className="nk-wallet-addr nk-mono">{shortHex(a.address, 6)}</span></div>
          <b className="nk-wallet-total"><i>$</i>{u6(total)}</b>
          <p className="nk-wallet-note">tUSDC at $1, test stocks at their NorenStockOracle price{a.priv === null ? "; your private balance is still locked" : ""}. Avalanche Fuji.</p>
          <div className="nk-wallet-split">
            <div className="priv"><small className="lg-row"><Mark id="AVAX" size={14} />Private · eERC</small><b>{a.priv !== null ? c2(a.priv) : <button className="nk-unlock" disabled={busy} onClick={async () => { setBusy(true); setErr(null); try { await unlock(); w.reload(); } catch (e) { setErr(msgOf(e)); } finally { setBusy(false); } }}>{busy ? "…" : "Unlock"}</button>}</b><em>tUSDC, encrypted on chain</em></div>
            <div><small className="lg-row"><Mark id="USDC" size={14} />Public</small><b>{u6(a.usdc)}</b><em>tUSDC</em></div>
            <div><small className="lg-row"><Mark id="NVDA" size={14} />Stocks</small><b>{u6(a.stocks6)}</b><em>{a.stocks.filter((s) => s.balance > 0n).map((s) => `t${s.sym}`).join(", ") || "no stock yet"}</em></div>
            <div><small className="lg-row"><Icon />Credit available</small><b>{available !== null ? u6(available) : "–"}</b><em>{a.credit?.collateral.some((c) => c.amount > 0n) ? `against your stocks · LTV ${a.credit.ltvBps / 100}%` : "lock stock in Credit"}</em></div>
          </div>
          {err && <div className="nk-err">{err}</div>}
        </section>

        {(a.avax === 0n || a.stocks.every((x) => x.balance === 0n)) && (
          <div className="nk-setup nk-start" role="status">
            <span className="nk-tag">New wallet</span>
            <b>Get test funds and test stocks in one tap.</b>
            <p>NorenGasStation sends gas, 100 tUSDC and 0.01 tWBTC; NorenStockStarter sends 2 tNVDA, 1 tTSLA, 2 tAAPL, 1 tMSFT and 1 tSPY. Fuji test tokens only.</p>
            <button className="nk-btn ink" disabled={busy} onClick={async () => { setBusy(true); setErr(null); try { if (a.avax === 0n) await getStarterPack(a.address); if (!(await stockPackClaimed(a.address))) await claimStockPack(); w.reload(); } catch (e) { setErr(msgOf(e)); } finally { setBusy(false); } }}>{busy ? "Sending on Fuji…" : "Get test funds and stocks"}</button>
          </div>
        )}

        <nav className="nk-actions" aria-label="Actions">
          {ACTIONS.map((x, i) => (
            <motion.button key={x.k} className={x.primary ? "primary" : ""} onClick={x.on} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.03 * i, duration: 0.25 }}>
              <i aria-hidden><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={x.icon} /></svg></i>
              <b><span className="lg">{x.label}</span><span className="sm">{x.short ?? x.label}</span></b><small>{x.sub}</small>
            </motion.button>
          ))}
        </nav>

        <section className="nk-card nk-paycard" aria-label="Pay" ref={payRef}>
          <div className="nk-card-h"><div><b>Pay</b><p>Scan or paste a Noren link. Paying with stocks happens right here.</p></div><span className="nk-pill live"><Mark id="AVAX" size={16} />Fuji</span></div>
          <div className="nk-pad"><PayInvoice w={w} /></div>
        </section>
      </div>

      <aside className="nk-home-side">
        <section className="nk-card" aria-label="Recent activity">
          <div className="nk-card-h"><div><b>Recent activity</b><p>Your receipts and transactions from this browser</p></div></div>
          <div className="nk-pad">
            {!acts.length ? <Empty title="Nothing yet" text="Get test funds from your wallet menu (top right), then pay a link: it shows up here." /> : (
              <ul className="nk-acts">
                {acts.slice(0, 8).map((x) => (
                  <li key={x.id} data-kind={x.kind}>
                    <span className="nk-act-ic" aria-hidden><Mark id={x.mark} size={22} /></span>
                    <div><b>{x.title}</b><small>{x.detail} · {ago(x.at)}</small></div>
                    <div className="r">{x.amount && <b>{x.amount}</b>}<TxLink hash={x.tx} n={4} /></div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
        <section className="nk-card" aria-label="Four ways to pay">
          <div className="nk-card-h"><div><b>Four ways to pay</b><p>The same at every Noren checkout</p></div></div>
          <ol className="nk-fourways">
            {WAYS.map((m, i) => <li key={m.id}><i>{i + 1}</i><div><b>{m.title}</b><small>{m.sub}</small></div><span className={`nk-way-tag ${m.tag === "Public" ? "" : "ok"}`}>{m.tag}</span></li>)}
          </ol>
          <p className="nk-fine" style={{ padding: "0 14px 10px" }}>Payments are private by default. Selling stock, a credit draw and top-ups are public in round lots of 50; who you paid is not.</p>
        </section>
      </aside>
    </div>
  );
}

const Icon = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><path d="M4 8h16v10H4zM4 12h16" /></svg>;

type Act = { id: string; kind: string; title: string; detail: string; at: number; tx: string; amount?: string; mark: string };
function activity(address: string): Act[] {
  const claims = savedClaims();
  const out: Act[] = [];
  for (const [tx, c] of Object.entries(claims)) out.push({ id: tx, kind: "pay", title: `Paid ${c.shop}`, detail: `${c.method === "stocks" ? "with stocks" : c.method === "payin3" ? "in 3" : c.method === "paylater" ? "later" : "privately"} · ${c.item}`, at: Math.floor(c.at / 1000), tx, amount: `−${cents(Number(c.cents))}`, mark: c.method === "stocks" ? "NVDA" : "AVAX" });
  for (const t of sentTxs(address)) if (!claims[t.hash as `0x${string}`]) out.push({ id: t.hash, kind: "tx", title: t.what.replace(/^./, (m) => m.toUpperCase()), detail: "Avalanche Fuji", at: t.at, tx: t.hash, mark: /t(NVDA|TSLA|AAPL|MSFT|SPY)/.exec(t.what)?.[1] ?? "AVAX" });
  return out.sort((a, b) => b.at - a.at);
}
