/**
 * Noren checkout in a pop-up window, the way a shop opens Stripe or PayPal: the shop calls window.open on
 * `#/checkout/<invoiceId>` (the Noren app's own origin, so the customer's wallet, stocks and credit line are here),
 * the customer connects a wallet, picks how to pay and pays, and the window hands the result back to the shop and
 * closes. The hand-back is only a hint: the shop's server reads the invoice from Noren's API before it shows "Paid".
 * Every step is a real Fuji transaction (lib/pay.ts), the same plan as the hosted checkout and the app's Pay tab.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, MotionConfig } from "motion/react";
import "@fontsource-variable/urbanist";
import "@fontsource/space-mono/400.css";
import "@fontsource/space-mono/700.css";
import "./app.css";
import type { StockSym } from "@noren-avax/sdk";
import { cents, merchant, type Invoice, type Method } from "../lib/api";
import { txUrl } from "../lib/chain";
import { connectWallet, openTestWallet, restoreTestWallet } from "../lib/signer";
import { lotOf, planFor, runPlan, type Paid, type Step } from "../lib/pay";
import { Logo, msgOf } from "../ui";
import { TxLink } from "../tx";
import { Mark } from "../logos";
import { Spin, pop, shortHex } from "./kit";
import { useAcct, c2, p8, sh } from "./acct";

type Way = "stocks" | "credit" | "private" | "usdc";
const WAYS: { id: Way; title: string; sub: string; tag: "Private" | "Public" }[] = [
  { id: "stocks", title: "Pay with stocks", sub: "Sold at checkout at a signed market price", tag: "Private" },
  { id: "credit", title: "Pay in 3 / Pay later", sub: "Credit against your stocks, no selling", tag: "Private" },
  { id: "private", title: "Pay privately", sub: "From your encrypted tUSDC balance", tag: "Private" },
  { id: "usdc", title: "Pay with tUSDC", sub: "From your public wallet", tag: "Public" },
];

/** Where the hand-back may go: the shop's own origin, taken from the invoice it created. Never "*". */
const shopOrigin = (inv: Invoice | null) => {
  for (const u of [inv?.successUrl, inv?.cancelUrl]) {
    if (!u) continue;
    try { const x = new URL(u); if (x.protocol === "https:" || x.protocol === "http:") return x.origin; } catch { /* not a URL */ }
  }
  return null;
};

export function PopupCheckout({ id }: { id: string }) {
  useEffect(() => { restoreTestWallet(); document.title = "Noren checkout"; }, []);
  const { who, acct, err: acctErr, reload } = useAcct();
  const [inv, setInv] = useState<Invoice | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [way, setWay] = useState<Way>("stocks");
  const [later, setLater] = useState<"payin3" | "paylater">("payin3");
  const [sym, setSym] = useState<StockSym>("NVDA");
  const [steps, setSteps] = useState<Step[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [paid, setPaid] = useState<Paid | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [closing, setClosing] = useState<number | null>(null);
  const told = useRef(false);
  const method: Method = way === "credit" ? later : way;
  const opener = typeof window !== "undefined" && !!window.opener && !window.opener.closed;

  const load = useCallback(async () => {
    try { setInv(await merchant.invoice(id)); setLoadErr(null); } catch (e) { setLoadErr(msgOf(e)); }
  }, [id]);
  // Poll until Noren's hub has confirmed the payment (it reads Fuji every 10 s), then stop.
  useEffect(() => { load(); if (inv?.status === "paid" || inv?.status === "expired") return; const t = setInterval(load, paid ? 2500 : 6000); return () => clearInterval(t); }, [load, paid, inv?.status]);

  const shop = inv?.merchantName || "the shop";
  const origin = shopOrigin(inv);
  const tell = useCallback((status: "paid" | "cancelled") => {
    if (!origin || !opener) return;
    try { window.opener.postMessage({ source: "noren", type: "noren:checkout", status, invoiceId: id, method: status === "paid" ? (paid?.method ?? inv?.method ?? null) : null }, origin); } catch { /* the shop window went away */ }
  }, [origin, opener, id, paid?.method, inv?.method]);

  // Paid here and confirmed by Noren: hand the result back to the shop, then close on our own.
  useEffect(() => {
    if (told.current || !paid || inv?.status !== "paid") return;
    told.current = true;
    tell("paid");
    if (!opener) return;
    setClosing(3);
    const t = setInterval(() => setClosing((n) => { if (n === null) return n; if (n <= 1) { clearInterval(t); window.close(); return 0; } return n - 1; }), 1000);
    return () => clearInterval(t);
  }, [paid, inv?.status, tell, opener]);

  // Keep the stock choice on one this wallet can use for the chosen way.
  const lockedOf = (x: StockSym) => acct?.credit?.collateral.find((c) => c.sym === x)?.amount ?? 0n;
  useEffect(() => {
    if (!acct) return;
    const credit = way === "credit";
    const usable = acct.stocks.filter((x) => x.balance > 0n || (credit && lockedOf(x.sym) > 0n));
    const locked = credit ? acct.stocks.find((x) => lockedOf(x.sym) > 0n) : undefined;
    if (locked && lockedOf(sym) === 0n) setSym(locked.sym);
    else if (usable.length && !usable.find((x) => x.sym === sym)) setSym(usable[0]!.sym);
  }, [acct?.stocks, acct?.credit, way]); // eslint-disable-line react-hooks/exhaustive-deps

  const pay = async () => {
    if (!who || !inv) return;
    setBusy(true); setNote(null); setPaid(null);
    const t0 = performance.now();
    const ok = await runPlan(planFor({ who: who.address, inv, method, sym, onPaid: setPaid }), setSteps);
    if (ok) setTotal((performance.now() - t0) / 1000);
    setBusy(false); reload(); load();
  };
  const cancel = () => { tell("cancelled"); if (opener) window.close(); else if (inv?.cancelUrl) location.assign(inv.cancelUrl); };

  const amount = inv ? BigInt(inv.amountCents) : 0n;
  const lot = amount > 0n ? lotOf(amount) : 0n;
  const st = acct?.stocks.find((s) => s.sym === sym);
  const sellEst = st && st.price8 > 0n ? (lot * 10_000n * 10n ** 20n * 10_000n) / (st.price8 * 9_950n) : null;
  const avail = acct?.credit?.available ?? null;
  const ltv = acct?.credit?.ltvBps ?? 6000;
  const done = !!paid || inv?.status === "paid";
  const running = busy || (!!steps && !done);
  const plan = useMemo(() => later === "payin3" ? `3 × ${cents(Number((lot * 101n) / 300n))} tUSDC, two weeks apart` : `${cents(Number((lot * 101n) / 100n))} tUSDC in 30 days`, [later, lot]);

  return (
    <MotionConfig reducedMotion="user">
      <div className="nk nk-pop">
        <header className="nk-pop-h">
          <span className="nk-brand"><Logo size={26} /><span>Noren</span><small>checkout</small></span>
          {who ? <span className="nk-chip sm" title={who.address}><i className="nk-ava" aria-hidden />{shortHex(who.address, 6)}</span>
            : <span className="nk-net"><i className="on" /><Mark id="AVAX" size={14} />Avalanche Fuji</span>}
        </header>

        <main className="nk-pop-main">
          {loadErr && !inv ? <div className="nk-err" role="alert">This payment doesn’t open: {loadErr}</div> : !inv ? <div className="nk-skel"><i /><i /><i /></div> : (
            <>
              <section className="nk-pop-sum" aria-label="What you are paying">
                <span className="nk-inv-mark" aria-hidden>{shop.slice(0, 1).toUpperCase()}</span>
                <div><small>Pay {shop}</small><b>{cents(inv.amountCents)} <em>tUSDC</em></b><small className="nk-pop-desc">{inv.description || "Payment"}</small></div>
                <span className={`nk-pill ${done ? "live" : inv.status === "expired" ? "bad" : ""}`}>{done ? (inv.status === "paid" ? "paid" : "confirming") : inv.status}</span>
              </section>

              <AnimatePresence mode="popLayout" initial={false}>
                {done ? (
                  <motion.section key="done" className="nk-pop-done" role="status" {...pop}>
                    <div className="nk-pop-check" aria-hidden><svg viewBox="0 0 52 52"><circle cx="26" cy="26" r="24" /><path d="m15 27 7.5 7.5L38 19" /></svg></div>
                    <b>{(() => { const m = paid?.method ?? inv.method; return m === "stocks" ? "Paid with stocks, privately" : m === "payin3" ? "Paid in 3, privately" : m === "paylater" ? "Paid later, privately" : m === "usdc" ? "Paid with tUSDC" : "Paid privately"; })()}</b>
                    <p>{cents(inv.amountCents)} tUSDC to {shop}.{(paid?.method ?? inv.method) !== "usdc" ? ` ${shop} sees “Customer: Private”; the amount is encrypted on Avalanche.` : ""}</p>
                    <dl className="nk-rows">
                      {paid?.sold && <><dt>Sold at checkout</dt><dd>{sh(paid.sold.amount, 6)} t{paid.sold.sym} at ${p8(paid.sold.price8)}</dd></>}
                      {paid?.plan && <><dt>Plan</dt><dd>{paid.plan.parts === 3 ? "Pay in 3" : "Pay later"} · repay in the Noren app</dd></>}
                      {paid?.proofMs && <><dt>Proof made on this device</dt><dd>{(paid.proofMs / 1000).toFixed(1)} s</dd></>}
                      {total !== null && <><dt>Tap to paid</dt><dd>{total.toFixed(1)} s</dd></>}
                      <dt>Transaction</dt><dd><TxLink hash={paid?.hash ?? inv.paymentTx} n={6} /></dd>
                      <dt>Noren</dt><dd>{inv.status === "paid" ? "confirmed: the hub decrypted it" : <><Spin /> the hub is reading it…</>}</dd>
                    </dl>
                    {inv.status === "paid" && (opener ? <p className="nk-pop-back">{closing ? `Back to ${shop} in ${closing}…` : `Back to ${shop}`}</p>
                      : inv.successUrl ? <a className="nk-cta" href={inv.successUrl}>Return to {shop}</a> : null)}
                  </motion.section>
                ) : inv.status !== "open" ? (
                  <motion.p key="closed" className="nk-err" {...pop}>This payment is {inv.status}. Nothing was charged; ask {shop} for a new one.</motion.p>
                ) : !who ? (
                  <motion.section key="connect" className="nk-pop-connect" {...pop}>
                    <span className="nk-pop-step">1 · Connect</span>
                    <b>Connect a wallet to pay {shop}</b>
                    <p>Pay with your stocks, in 3 against them, or from a private balance. {shop} never learns which wallet paid.</p>
                    <button className="nk-cta" onClick={() => openTestWallet()}>Use a test wallet</button>
                    <button className="nk-cta soft" onClick={() => connectWallet().catch((e) => setNote(msgOf(e)))}>Browser wallet</button>
                    <small>The test wallet is a Fuji key kept in this browser; checkout gets it gas and test stocks on the way.</small>
                  </motion.section>
                ) : (
                  <motion.section key="pay" className="nk-pop-pay" {...pop}>
                    {!running && <>
                      <span className="nk-pop-step">2 · Choose how to pay</span>
                      <div className="nk-ways nk-pop-ways" role="radiogroup" aria-label="Ways to pay">
                        {WAYS.map((m) => (
                          <button key={m.id} type="button" role="radio" aria-checked={way === m.id} className={`nk-way ${way === m.id ? "on" : ""}`} onClick={() => setWay(m.id)}>
                            {m.id === "stocks" ? <Mark id="NVDA" size={24} /> : m.id === "credit" ? <Mark id="TSLA" size={24} /> : m.id === "usdc" ? <Mark id="USDC" size={24} /> : <Mark id="AVAX" size={24} />}
                            <div><b>{m.title}</b><small>{m.id === "private" && acct?.priv != null ? `Private balance ${c2(acct.priv)} tUSDC` : m.sub}</small></div>
                            <span className={`nk-way-tag ${m.tag === "Public" ? "" : "ok"}`}>{m.tag}</span>
                          </button>
                        ))}
                      </div>
                      {way === "credit" && (
                        <div className="nk-seg" role="radiogroup" aria-label="Plan">
                          <button role="radio" aria-checked={later === "payin3"} onClick={() => setLater("payin3")}>Pay in 3</button>
                          <button role="radio" aria-checked={later === "paylater"} onClick={() => setLater("paylater")}>Pay later · 30 days</button>
                        </div>
                      )}
                      {(way === "stocks" || way === "credit") && (
                        <div className="nk-stockpick nk-pop-stocks" role="radiogroup" aria-label="Stock">
                          {(acct?.stocks ?? []).map((s) => (
                            <button key={s.sym} type="button" role="radio" aria-checked={s.sym === sym} data-empty={s.balance === 0n && !(way === "credit" && lockedOf(s.sym) > 0n) && !!acct && acct.avax > 0n} onClick={() => setSym(s.sym)}>
                              <Mark id={s.sym} size={22} /><span><b>t{s.sym}</b><small>{way === "credit" && lockedOf(s.sym) > 0n ? `${sh(lockedOf(s.sym), 2)} locked` : `${sh(s.balance, 2)} held`}</small></span>
                            </button>
                          ))}
                          {!acct && <div className="nk-skel"><i /></div>}
                        </div>
                      )}
                    </>}
                    {(way === "stocks" || way === "credit") && st && (
                      <dl className="nk-rows nk-pop-quote">
                        {way === "stocks" ? <>
                          <dt>You sell</dt><dd><b>{sellEst ? sh(sellEst, 4) : "…"}</b> t{sym}</dd>
                          <dt>Signed price</dt><dd>${p8(st.price8)} · NorenStockOracle</dd>
                          <dt>Sold</dt><dd>{cents(Number(lot))} tUSDC, a round lot{lot > amount ? `; ${cents(Number(lot - amount))} stays yours, private` : ""}</dd>
                        </> : <>
                          <dt>Collateral</dt><dd>t{sym}, locked, still yours</dd>
                          <dt>Credit</dt><dd>{avail != null && avail > 0n ? `${c2(avail / 10_000n)} tUSDC free` : "locks just enough"} · LTV {ltv / 100}%</dd>
                          <dt>Plan</dt><dd>{plan} · 1% fee</dd>
                        </>}
                        <dt>{shop} gets</dt><dd>{cents(inv.amountCents)} tUSDC, privately</dd>
                      </dl>
                    )}
                    {steps && (
                      <ol className="nk-steps nk-pop-steps" aria-label="Payment steps">
                        {steps.map((s, i) => <li key={s.key} data-state={s.state === "done" || s.state === "skip" ? "done" : s.state === "run" ? "now" : "todo"}><i>{s.state === "done" || s.state === "skip" ? "✓" : s.state === "fail" ? "!" : i + 1}</i><span>{s.title}{s.hash ? <> · <a href={txUrl(s.hash)} target="_blank" rel="noreferrer">tx</a></> : s.state === "skip" ? " · not needed" : ""}{s.error ? <em className="nk-err-t"> {s.error}</em> : null}</span></li>)}
                      </ol>
                    )}
                    {acctErr && !acct && <p className="nk-err" role="alert">{acctErr}</p>}
                    <button className={`nk-cta${way === "stocks" ? " kaki" : ""}`} disabled={busy || !acct} onClick={pay}>
                      {busy ? <><Spin /> {steps?.find((s) => s.state === "run")?.title ?? "Working"}…</>
                        : way === "stocks" ? `Pay ${cents(inv.amountCents)} with t${sym}`
                        : way === "credit" ? `${later === "payin3" ? "Pay in 3" : "Pay later"} against t${sym}`
                        : way === "usdc" ? `Pay ${cents(inv.amountCents)} tUSDC` : `Pay ${cents(inv.amountCents)} tUSDC privately`}
                    </button>
                  </motion.section>
                )}
              </AnimatePresence>
              {note && <p className="nk-err" role="alert">{note}</p>}
            </>
          )}
        </main>
        <footer className="nk-pop-f">
          {inv && !done && <button className="nk-pop-cancel" onClick={cancel} disabled={busy}>Cancel and return to {shop}</button>}
          <span>Avalanche Fuji · test funds only · proofs made on this device</span>
        </footer>
      </div>
    </MotionConfig>
  );
}
