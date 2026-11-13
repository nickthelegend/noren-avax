/**
 * The Noren app: the customer's side of Noren on Avalanche. Home (balance, Pay, recent activity), then Pay, Earn,
 * Credit, Borrow and Swap. Every number is read live from Fuji or Noren's API; anything missing says "Setup required".
 */
import { useEffect, useState } from "react";
import { AnimatePresence, motion, MotionConfig } from "motion/react";
import "@fontsource-variable/urbanist";
import "@fontsource/space-mono/400.css";
import "@fontsource/space-mono/700.css";
import "./app.css";
import { claimStockPack, getStarterPack, stockPackClaimed } from "../lib/api";
import { connectWallet, disconnect, openTestWallet, restoreTestWallet } from "../lib/signer";
import { Logo, msgOf } from "../ui";
import { Mark } from "../logos";
import { shortHex, spring } from "./kit";
import { useAcct, u6, sh, type Acct } from "./acct";
import { HomeTab } from "./HomeTab";
import { PayTab } from "./PayTab";
import { EarnTab } from "./EarnTab";
import { CreditTab } from "./CreditTab";
import { BorrowTab } from "./BorrowTab";
import { SwapTab } from "./SwapTab";

export const TABS = ["home", "pay", "earn", "credit", "borrow", "swap"] as const;
export type Tab = (typeof TABS)[number];
const LABEL: Record<Tab, string> = { home: "Home", pay: "Pay", earn: "Earn", credit: "Credit", borrow: "Borrow", swap: "Swap" };
const tabFromHash = (): Tab => { const m = /^#\/(?:app|credit)\/(\w+)/.exec(location.hash); return (TABS as readonly string[]).includes(m?.[1] ?? "") ? (m![1] as Tab) : "home"; };
export type W = { acct: Acct; reload: () => void };

export function NorenApp() {
  useEffect(() => { restoreTestWallet(); }, []);
  const [tab, setTab] = useState<Tab>(tabFromHash);
  useEffect(() => { const on = () => setTab(tabFromHash()); addEventListener("hashchange", on); return () => removeEventListener("hashchange", on); }, []);
  const go = (t: Tab) => { history.replaceState(null, "", `#/app/${t}`); setTab(t); scrollTo({ top: 0 }); };
  const { who, acct, err, reload } = useAcct();
  const [menu, setMenu] = useState(false);
  const w: W | null = acct ? { acct, reload } : null;

  return (
    <MotionConfig reducedMotion="user">
      <div className="nk">
        <header className="nk-nav">
          <a className="nk-brand" href="#/"><Logo size={30} /><span>Noren</span><small>app</small></a>
          <nav className="nk-tabs" role="tablist" aria-label="Noren app">
            {TABS.map((t) => (
              <button key={t} role="tab" aria-label={LABEL[t]} aria-selected={tab === t} onClick={() => go(t)}>
                {tab === t && <motion.span className="nk-tab-pill" layoutId="nk-tab-pill" transition={spring} />}
                <span className="nk-tab-l">{LABEL[t]}</span>
              </button>
            ))}
          </nav>
          <div className="nk-right">
            <span className="nk-nets" aria-label="Network"><span className="nk-net"><i className="on" /><Mark id="AVAX" size={16} />Avalanche Fuji</span></span>
            <div className="nk-prof">
              <button className="nk-chip" onClick={() => setMenu((o) => !o)} aria-expanded={menu} aria-haspopup="dialog"><i className="nk-ava" aria-hidden />{who ? shortHex(who.address, 6) : "Signed out"}</button>
              {menu && <Profile acct={acct} onClose={() => setMenu(false)} reload={reload} />}
            </div>
          </div>
        </header>

        <main className="nk-main">
          {!who ? <div className="nk-col"><SignIn /></div> : err && !acct ? <div className="nk-col"><div className="nk-err" role="alert">{err}</div></div> : !w ? <div className="nk-col"><div className="nk-skel"><i /><i /><i /></div></div> : (
            <AnimatePresence mode="wait" initial={false}>
              <motion.div key={`${tab}:${who.address}`} className={`nk-pane${tab === "home" ? " wide" : ""}`} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.2, ease: [0.2, 0.7, 0.2, 1] }}>
                {tab === "home" && <HomeTab w={w} go={go} />}
                {tab === "pay" && <PayTab w={w} />}
                {tab === "earn" && <EarnTab w={w} go={go} />}
                {tab === "credit" && <CreditTab w={w} go={go} />}
                {tab === "borrow" && <BorrowTab w={w} />}
                {tab === "swap" && <SwapTab w={w} />}
              </motion.div>
            </AnimatePresence>
          )}
        </main>
        <p className={`nk-foot${tab === "home" ? " wide" : ""}`}>Avalanche Fuji testnet only. Test stocks are priced from Yahoo Finance quotes signed by Noren’s price relayer; tUSDC and tWBTC are test tokens. No real money moves.</p>
      </div>
    </MotionConfig>
  );
}

export function SignIn() {
  const [err, setErr] = useState<string | null>(null);
  return (
    <section className="nk-signin" aria-labelledby="nk-signin-h">
      <div className="nk-signin-mark"><Logo size={56} /></div>
      <h1 id="nk-signin-h">Pay with stocks, privately</h1>
      <p>Connect a wallet to pay any Noren checkout with your stocks, in 3 against them, or from a private balance.</p>
      <button className="nk-cta" onClick={() => openTestWallet()}>Use a test wallet</button>
      {err && <div className="nk-err" role="alert">{err}</div>}
      <div className="nk-signin-alt"><button className="nk-cta soft" onClick={() => connectWallet().catch((e) => setErr(msgOf(e)))}>Use a browser wallet</button></div>
      <ul className="nk-signin-notes">
        <li>The test wallet is a Fuji key kept in this browser. One tap gets it gas, 100 tUSDC and test stocks.</li>
        <li>Payments are eERC transfers to Noren’s hub: amounts are encrypted, and the shop never learns who paid.</li>
      </ul>
    </section>
  );
}

function Profile({ acct, onClose, reload }: { acct: Acct | null; onClose: () => void; reload: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ t: string; bad?: boolean } | null>(null);
  const run = async (k: string, f: () => Promise<string>) => { setBusy(k); setNote(null); try { setNote({ t: await f() }); reload(); } catch (e) { setNote({ t: msgOf(e), bad: true }); } finally { setBusy(null); } };
  useEffect(() => { const k = (e: KeyboardEvent) => e.key === "Escape" && onClose(); addEventListener("keydown", k); return () => removeEventListener("keydown", k); }, [onClose]);
  const nvda = acct?.stocks.find((s) => s.sym === "NVDA");
  return (
    <div className="nk-menu" role="dialog" aria-label="Your wallet">
      {acct && <div className="nk-menu-row"><small>Your address on Avalanche Fuji</small><span>{acct.address}</span></div>}
      <div className="nk-bal" aria-label="Balances">
        <span>{acct ? (Number(acct.avax) / 1e18).toLocaleString("en-US", { maximumFractionDigits: 5 }) : "…"}<em><Mark id="AVAX" size={14} />AVAX</em></span>
        <span>{acct ? u6(acct.usdc) : "…"}<em><Mark id="USDC" size={14} />tUSDC</em></span>
        <span>{nvda ? sh(nvda.balance) : "…"}<em><Mark id="NVDA" size={14} />tNVDA</em></span>
      </div>
      <button className="nk-btn" disabled={!!busy || !acct || acct.avax > 0n} onClick={() => run("gas", async () => { await getStarterPack(acct!.address); return "NorenGasStation sent gas, 100 tUSDC and 0.01 tWBTC."; })}>{busy === "gas" ? "Sending…" : acct && acct.avax > 0n ? "Starter pack: this wallet has gas" : "Get test funds (gas, tUSDC, tWBTC)"}</button>
      <button className="nk-btn" disabled={!!busy || !acct || acct.avax === 0n} onClick={() => run("stock", async () => { if (await stockPackClaimed(acct!.address)) throw Error("This wallet already took its stock pack."); await claimStockPack(); return "NorenStockStarter sent 2 tNVDA, 1 tTSLA, 2 tAAPL, 1 tMSFT and 1 tSPY."; })}>{busy === "stock" ? "Sending…" : "Get test stocks"}</button>
      {note && <div className={note.bad ? "nk-err" : "nk-note"} role="status">{note.t}</div>}
      <button className="nk-btn ghost" onClick={() => { disconnect(); onClose(); }}>Disconnect</button>
      <button className="nk-x" onClick={onClose} aria-label="Close">×</button>
    </div>
  );
}
