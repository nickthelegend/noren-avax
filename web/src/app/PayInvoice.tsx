/**
 * Pay a Noren invoice from inside the app: paste or scan a payment link, see who you're paying, pick a way and pay.
 * The same four ways as the hosted checkout, run here with lib/pay.ts: every step is a real Fuji transaction.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { StockSym } from "@noren-avax/sdk";
import { cents, merchant, type Invoice, type Method } from "../lib/api";
import { txUrl } from "../lib/chain";
import { planFor, runPlan, type Paid, type Step } from "../lib/pay";
import { msgOf } from "../ui";
import { TxLink } from "../tx";
import { Mark } from "../logos";
import { Spin, pop } from "./kit";
import type { W } from "./NorenApp";
import { c2, p8, sh } from "./acct";

export const invoiceIdIn = (s: string) => /(?:#\/pay\/|^)(in[a-z0-9]{6,14})\b/i.exec(s.trim())?.[1];

/** The four ways to pay, stocks first. The checkout uses the same ids (`#/pay/<id>?m=<id>`). */
export const WAYS = [
  { id: "stocks", title: "Pay with stocks", sub: "Your test stock, sold at a signed market price into your private balance. The shop never learns who paid.", tag: "Private" },
  { id: "payin3", title: "Pay in 3 / Pay later", sub: "Credit against your stocks, without selling them. Paid to the shop privately.", tag: "Private" },
  { id: "private", title: "Pay privately", sub: "tUSDC from your encrypted balance.", tag: "Private" },
  { id: "usdc", title: "Pay with tUSDC", sub: "From your public wallet.", tag: "Public" },
] as const;

function useScanner(onText: (t: string) => void) {
  const video = useRef<HTMLVideoElement>(null);
  const [on, setOn] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const stop = useCallback(() => { stream.current?.getTracks().forEach((t) => t.stop()); stream.current = null; setOn(false); }, []);
  useEffect(() => stop, [stop]);
  const start = async () => {
    setErr(null);
    const BD = (globalThis as { BarcodeDetector?: new (o: { formats: string[] }) => { detect: (v: HTMLVideoElement) => Promise<{ rawValue: string }[]> } }).BarcodeDetector;
    if (!BD) { setErr("This browser can't read QR codes from the camera. Paste the link instead."); return; }
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      setOn(true);
      await new Promise((r) => setTimeout(r, 50));
      if (!video.current) return;
      video.current.srcObject = stream.current; await video.current.play();
      const det = new BD({ formats: ["qr_code"] });
      const tick = async () => {
        if (!stream.current || !video.current) return;
        const hit = (await det.detect(video.current).catch(() => []))[0]?.rawValue;
        if (hit && invoiceIdIn(hit)) { onText(hit); stop(); return; }
        requestAnimationFrame(tick);
      };
      tick();
    } catch (e) { setErr(`Camera: ${msgOf(e)}`); stop(); }
  };
  return { video, on, err, start, stop };
}

export function PayInvoice({ w, initial }: { w: W; initial?: string }) {
  const [text, setText] = useState(initial ?? "");
  const id = invoiceIdIn(text);
  const [inv, setInv] = useState<Invoice | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [way, setWay] = useState<Method>("stocks");
  const [sym, setSym] = useState<StockSym>("NVDA");
  const [steps, setSteps] = useState<Step[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [paid, setPaid] = useState<Paid | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const scan = useScanner((t) => setText(t));
  useEffect(() => { if (initial) setText(initial); }, [initial]);
  const refresh = useCallback(async () => {
    if (!id) { setInv(null); setLoadErr(null); return; }
    try { setInv(await merchant.invoice(id)); setLoadErr(null); } catch (e) { setInv(null); setLoadErr(msgOf(e)); }
  }, [id]);
  useEffect(() => { setSteps(null); setPaid(null); setTotal(null); refresh(); }, [refresh]);
  useEffect(() => { if (!id || paid) return; const t = setInterval(refresh, 6000); return () => clearInterval(t); }, [id, paid, refresh]);
  const lockedOf = (x: StockSym) => w.acct.credit?.collateral.find((c) => c.sym === x)?.amount ?? 0n;
  // Selling needs shares in the wallet; credit can also use shares already locked as collateral.
  useEffect(() => {
    const usable = (x: { sym: StockSym; balance: bigint }) => x.balance > 0n || ((way === "payin3" || way === "paylater") && lockedOf(x.sym) > 0n);
    const ok = w.acct.stocks.filter(usable);
    // Credit: prefer a stock that is already locked as collateral.
    const locked = (way === "payin3" || way === "paylater") ? w.acct.stocks.find((x) => lockedOf(x.sym) > 0n) : undefined;
    if (locked && lockedOf(sym) === 0n) setSym(locked.sym);
    else if (ok.length && !ok.find((x) => x.sym === sym)) setSym(ok[0]!.sym);
  }, [w.acct.stocks, way]); // eslint-disable-line react-hooks/exhaustive-deps

  const shop = inv?.merchantName || "this shop";
  const pay = async () => {
    if (!inv) return;
    setBusy(true);
    const t0 = performance.now();
    const ok = await runPlan(planFor({ who: w.acct.address, inv, method: way, sym, onPaid: setPaid }), setSteps);
    if (ok) setTotal((performance.now() - t0) / 1000);
    setBusy(false); w.reload(); refresh();
  };
  const credit = way === "payin3" || way === "paylater";
  const stock = w.acct.stocks.find((s) => s.sym === sym);

  return (
    <div className="nk-payin">
      <div className="nk-box">
        <label htmlFor="nk-paylink">Payment link or invoice</label>
        <div className="nk-row nk-row-link">
          <input id="nk-paylink" placeholder="Paste a Noren link: …/#/pay/in…" value={text} onChange={(e) => setText(e.target.value.trim())} autoComplete="off" spellCheck={false} />
          <button type="button" className="nk-btn" onClick={scan.on ? scan.stop : scan.start} aria-pressed={scan.on}>{scan.on ? "Stop" : "Scan"}</button>
        </div>
        <div className="nk-sub"><span>{text && !id ? "That isn't a Noren payment link" : "A link, a QR code or an invoice ID"}</span><span /></div>
        {scan.on && <video ref={scan.video} className="nk-scan" muted playsInline aria-label="Camera preview" />}
        {scan.err && <p className="nk-err" role="alert">{scan.err}</p>}
      </div>

      <AnimatePresence mode="popLayout" initial={false}>
        {id && (
          <motion.div key={id} className="nk-invoice" {...pop}>
            {loadErr ? <div className="nk-err" role="alert">{loadErr}</div> : !inv ? <div className="nk-skel"><i /><i /></div> : (
              <>
                <div className="nk-inv-h">
                  <span className="nk-inv-mark" aria-hidden>{shop.slice(0, 1).toUpperCase()}</span>
                  <div><small>Pay {shop}</small><b>{cents(inv.amountCents)} <em>tUSDC</em></b><small>{inv.description || "Payment"} · <span className="nk-mono">{inv.id}</span></small></div>
                  <span className={`nk-pill ${inv.status === "paid" ? "live" : inv.status === "expired" ? "bad" : ""}`}>{inv.status}</span>
                </div>

                {paid || inv.status === "paid" ? (
                  <div className="nk-paid" role="status">
                    <b>{paid ? (paid.method === "stocks" ? "Paid with stocks, privately" : paid.method === "payin3" ? "Paid in 3, privately" : paid.method === "paylater" ? "Paid later, privately" : paid.method === "usdc" ? "Paid with tUSDC" : "Paid privately") : "Already paid"}</b>
                    <p>{cents(inv.amountCents)} tUSDC to {shop}.{paid && paid.method !== "usdc" ? ` ${shop} sees “Customer: Private”; the amount is encrypted on chain.` : ""}</p>
                    <dl className="nk-rows">
                      {paid?.proofMs && <><dt>Proof made on this device</dt><dd>{(paid.proofMs / 1000).toFixed(1)} s, with the transfer</dd></>}
                      {total !== null && <><dt>Tap to paid</dt><dd>{total.toFixed(1)} s</dd></>}
                      {paid?.sold && <><dt>Sold</dt><dd>{sh(paid.sold.amount, 6)} t{paid.sold.sym} at ${p8(paid.sold.price8)}</dd></>}
                      {paid?.plan && <><dt>Plan</dt><dd>{paid.plan.parts === 3 ? "Pay in 3" : "Pay later"} · repay in <a href="#/app/credit">Credit</a></dd></>}
                      <dt>Transaction</dt><dd><TxLink hash={paid?.hash ?? inv.paymentTx} n={6} /></dd>
                    </dl>
                  </div>
                ) : inv.status !== "open" ? <p className="nk-err">This link is {inv.status}. Ask the shop for a new one; nothing was charged.</p> : (
                  <>
                    <div className="nk-ways" role="radiogroup" aria-label="Ways to pay">
                      {WAYS.map((m) => {
                        const on = m.id === "payin3" ? credit : way === m.id;
                        return (
                          <button key={m.id} type="button" role="radio" aria-checked={on} className={`nk-way ${on ? "on" : ""}`} disabled={busy} onClick={() => setWay(m.id === "payin3" ? (credit ? way : "payin3") : m.id)}>
                            {m.id === "stocks" ? <Mark id="NVDA" size={26} /> : m.id === "payin3" ? <Mark id="TSLA" size={26} /> : m.id === "usdc" ? <Mark id="USDC" size={26} /> : <Mark id="AVAX" size={26} />}
                            <div><b>{m.title}</b><small>{m.sub}</small>{m.id === "private" && <small className="nk-mono">Private balance {w.acct.priv !== null ? `${c2(w.acct.priv)} tUSDC` : "locked until you pay"}</small>}</div>
                            <span className={`nk-way-tag ${m.tag === "Public" ? "" : "ok"}`}>{m.tag}</span>
                          </button>
                        );
                      })}
                    </div>
                    {credit && (
                      <div className="nk-seg" role="radiogroup" aria-label="Plan">
                        <button role="radio" aria-checked={way === "payin3"} onClick={() => setWay("payin3")}>Pay in 3</button>
                        <button role="radio" aria-checked={way === "paylater"} onClick={() => setWay("paylater")}>Pay later · 30 days</button>
                      </div>
                    )}
                    {(way === "stocks" || credit) && (
                      <div className="nk-stockpick" role="radiogroup" aria-label="Stock">
                        {w.acct.stocks.map((s) => (
                          <button key={s.sym} type="button" role="radio" aria-checked={s.sym === sym} data-empty={s.balance === 0n && !(credit && lockedOf(s.sym) > 0n)} disabled={busy} onClick={() => setSym(s.sym)}>
                            <Mark id={s.sym} size={22} /><span><b>t{s.sym}</b><small>{credit && lockedOf(s.sym) > 0n ? `${sh(lockedOf(s.sym))} locked` : sh(s.balance)} · ${p8(s.price8)}</small></span>
                          </button>
                        ))}
                      </div>
                    )}
                    {steps && (
                      <ol className="nk-steps" aria-label="Payment steps">
                        {steps.map((s, i) => <li key={s.key} data-state={s.state === "done" || s.state === "skip" ? "done" : s.state === "run" ? "now" : "todo"}><i>{s.state === "done" || s.state === "skip" ? "✓" : s.state === "fail" ? "!" : i + 1}</i><span>{s.title}{s.hash ? <> · <a href={txUrl(s.hash)} target="_blank" rel="noreferrer">tx</a></> : s.state === "skip" ? " · not needed" : ""}{s.error ? <em className="nk-err-t"> {s.error}</em> : null}</span></li>)}
                      </ol>
                    )}
                    <button className="nk-cta" disabled={busy} onClick={pay}>
                      {busy ? <><Spin /> {steps?.find((s) => s.state === "run")?.title ?? "Working"}…</> : way === "stocks" ? `Pay ${cents(inv.amountCents)} with t${sym}` : credit ? `${way === "payin3" ? "Pay in 3" : "Pay later"} against t${sym}${stock ? "" : ""}` : way === "usdc" ? `Pay ${cents(inv.amountCents)} tUSDC` : `Pay ${cents(inv.amountCents)} tUSDC privately`}
                    </button>
                  </>
                )}
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
