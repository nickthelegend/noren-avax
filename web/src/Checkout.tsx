import { useCallback, useEffect, useState } from "react";
import { erc20Abi, type Address } from "viem";
import { STOCKS, stockToken, norenStockOracleAbi, norenStockCreditAbi, type StockSym } from "@noren-avax/sdk";
import { api, cents, merchant, short, type Invoice, type Method, type Receipt } from "./lib/api";
import { D, pub, txUrl } from "./lib/chain";
import { isUnlocked, openTestWallet, privateSession, restoreTestWallet, useWho, connectWallet } from "./lib/signer";
import { planFor, runPlan, lotOf, type Paid, type Step } from "./lib/pay";
import { Icon, Logo, msgOf } from "./ui";
import { TxLink } from "./tx";
import { Mark } from "./logos";

function useCountdown(expiry?: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  if (!expiry) return null;
  const left = Math.max(0, expiry * 1000 - now);
  const m = Math.floor(left / 60000), s = Math.floor((left % 60000) / 1000);
  return { left, text: m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m}:${String(s).padStart(2, "0")}` };
}

type Holding = { sym: StockSym; balance: bigint; price8: bigint; fresh: boolean };
const units = (a: bigint, dp = 4) => (Number(a) / 1e18).toLocaleString("en-US", { maximumFractionDigits: dp });
const usd8 = (p: bigint) => (Number(p) / 1e8).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** The four ways to pay. Stocks lead; the first three are private (they end in an eERC payment to Noren's hub). */
const METHODS: { m: "stocks" | "credit" | "private" | "usdc"; title: string; sub: string }[] = [
  { m: "stocks", title: "Pay with stocks", sub: "Private · sold at checkout at the live price, your address never reaches the shop" },
  { m: "credit", title: "Pay in 3 / Pay later", sub: "Private · credit against your stocks, without selling them" },
  { m: "private", title: "Pay privately", sub: "Private · tUSDC from your encrypted balance" },
  { m: "usdc", title: "Pay with tUSDC", sub: "Public · straight from your wallet" },
];

export function Checkout({ id }: { id: string }) {
  useEffect(() => { restoreTestWallet(); }, []);
  const who = useWho();
  const [inv, setInv] = useState<Invoice | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [tab, setTab] = useState<"stocks" | "credit" | "private" | "usdc">(() => {
    const m = new URLSearchParams(location.hash.split("?")[1] ?? "").get("m");
    return m === "usdc" ? "usdc" : m === "private" ? "private" : m === "later" || m === "credit" ? "credit" : "stocks";
  });
  const [later, setLater] = useState<"payin3" | "paylater">("payin3");
  const [sym, setSym] = useState<StockSym>("NVDA");
  const [hold, setHold] = useState<Holding[] | null>(null);
  const [credit, setCredit] = useState<{ available: bigint | null; ltv: number } | null>(null);
  const [priv, setPriv] = useState<bigint | null>(null);
  const [steps, setSteps] = useState<Step[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [paid, setPaid] = useState<Paid | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const method: Method = tab === "credit" ? later : tab;

  const load = useCallback(async () => {
    try { setInv(await merchant.invoice(id)); setLoadErr(null); } catch (e) { setLoadErr(msgOf(e)); }
  }, [id]);
  useEffect(() => { load(); const t = setInterval(load, 6000); return () => clearInterval(t); }, [load]);

  const loadWallet = useCallback(async () => {
    if (!who) { setHold(null); setCredit(null); setPriv(null); return; }
    try {
      const h = await Promise.all(STOCKS.map(async (s) => {
        const token = stockToken(D, s);
        const [balance, last] = await Promise.all([
          pub.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [who.address] }) as Promise<bigint>,
          pub.readContract({ address: D.stockOracle, abi: norenStockOracleAbi, functionName: "last", args: [token] }) as Promise<readonly [bigint, bigint, bigint, boolean]>,
        ]);
        return { sym: s.sym, balance, price8: last[0], fresh: last[3] };
      }));
      setHold(h);
      const [available, ltv] = await Promise.all([
        (pub.readContract({ address: D.stockCredit, abi: norenStockCreditAbi, functionName: "available", args: [who.address] }) as Promise<bigint>).catch(() => null),
        pub.readContract({ address: D.stockCredit, abi: norenStockCreditAbi, functionName: "ltvBps", args: [who.address] }) as Promise<bigint>,
      ]);
      setCredit({ available, ltv: Number(ltv) });
      if (isUnlocked()) setPriv((await privateSession().balance()).cents);
    } catch (e) { setNote(msgOf(e)); }
  }, [who?.address]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { loadWallet(); }, [loadWallet]);
  useEffect(() => { if (hold && !hold.find((h) => h.sym === sym && h.balance > 0n)) { const f = hold.find((h) => h.balance > 0n); if (f) setSym(f.sym); } }, [hold]); // eslint-disable-line react-hooks/exhaustive-deps

  // After paying: the hub's signed receipt (queued → settled in batch #n) and the invoice turning paid.
  useEffect(() => {
    if (!paid || paid.method === "usdc") return;
    let on = true;
    const tick = async () => {
      const c = JSON.parse(localStorage.getItem("noren:claims") ?? "{}")[paid.hash]?.claim ?? paid.claim;
      try { const r = await api<Receipt | { status: "unseen" }>("/receipt", { tx: paid.hash, claim: c }); if (on && "hub" in r) setReceipt(r); } catch { /* keep polling */ }
    };
    tick(); const t = setInterval(tick, 5000);
    return () => { on = false; clearInterval(t); };
  }, [paid]);

  const cd = useCountdown(inv?.expiresAt);
  const shop = inv?.merchantName || "Noren merchant";
  const amount = inv ? BigInt(inv.amountCents) : 0n;
  const expired = inv?.status === "expired" || (cd !== null && cd.left === 0 && inv?.status !== "paid");
  const settled = inv?.status === "paid" || !!paid;
  const back = (base?: string) => { if (!base) return null; try { const u = new URL(base); if (u.protocol !== "https:" && u.protocol !== "http:") return null; u.searchParams.set("noren_invoice", id); return u.toString(); } catch { return null; } };
  const doneUrl = back(inv?.successUrl);
  const cancelUrl = back(inv?.cancelUrl);

  const pay = async () => {
    if (!who || !inv) return;
    setBusy(true); setNote(null); setPaid(null);
    const t0 = performance.now();
    const ok = await runPlan(planFor({ who: who.address, inv, method, sym, onPaid: setPaid }), setSteps);
    if (ok) setTotal((performance.now() - t0) / 1000);
    setBusy(false); load(); loadWallet();
  };

  const h = hold?.find((x) => x.sym === sym);
  const lot = amount > 0n ? lotOf(amount) : 0n;
  const sellEst = h && h.price8 > 0n ? (lot * 10_000n * 10n ** 20n * 10_000n) / (h.price8 * 9_950n) : null;
  const methodTitle = tab === "stocks" ? <>Pay with <em>stocks</em>, privately</> : tab === "credit" ? (later === "payin3" ? <>Pay in <em>3</em>, privately</> : <>Pay <em>later</em>, privately</>) : tab === "usdc" ? <>Pay with <em>tUSDC</em></> : <>Pay <em>privately</em></>;

  return (
    <div className="co-page">
      <div className="co">
        {/* --------------------------------------------------------------- summary */}
        <section className="co-sum">
          <div className="co-sum-in">
            <a className="co-shop" href={doneUrl ?? "#/"}><span className="co-shop-mark" aria-hidden>{shop.slice(0, 1).toUpperCase()}</span><span>{shop}</span></a>
            <span className="co-k">Pay {shop}</span>
            <b className="co-amt">{inv ? cents(inv.amountCents) : <span className="skel-t" />}<em className="lg-row"><Mark id="USDC" size={20} />tUSDC</em></b>
            <ul className="co-lines">
              <li><span>{inv?.description || "Payment"}</span><span>{inv ? cents(inv.amountCents) : "…"}</span></li>
              <li className="faint"><span>Network</span><span className="lg-row"><Mark id="AVAX" size={14} />Avalanche Fuji</span></li>
              <li className="tot"><span>Total due</span><span>{inv ? `${cents(inv.amountCents)} tUSDC` : "…"}</span></li>
            </ul>
            <div className="co-privacy">
              <Icon.eyeOff />
              {method === "usdc" ? <p><b>Only the first three hide you.</b> A tUSDC payment comes straight from your wallet, so {shop} and anyone reading Avalanche can link it to you.</p>
                : <p><b>{shop} never learns who paid.</b> {method === "stocks" ? "Your shares are sold at the live price into your encrypted balance, " : method === "payin3" || method === "paylater" ? "Your stocks back a credit draw into your encrypted balance, " : "You pay from an encrypted balance, "}then an eERC payment to Noren’s hub, which pays {shop} in a batch with other shops. The amount is encrypted on chain.</p>}
            </div>
          </div>
          <footer className="co-foot"><span>Powered by</span><a href="#/"><Logo size={16} /> Noren</a><span className="mono faint">{id}</span></footer>
        </section>

        {/* --------------------------------------------------------------- pay */}
        <section className="co-pay">
          {loadErr && !inv ? (
            <div className="co-state"><Icon.x /><h2>This payment link doesn't work</h2><p>{loadErr}</p></div>
          ) : settled ? (
            <Done inv={inv} paid={paid} receipt={receipt} total={total} shop={shop} doneUrl={doneUrl} />
          ) : expired ? (
            <div className="co-state"><Icon.clock /><h2>This link has expired</h2><p>Ask {shop} for a new one. Nothing was charged.</p></div>
          ) : (
            <>
              <div className="co-pay-h"><h2>{methodTitle}</h2>{cd && <span className="co-timer"><Icon.clock /> {cd.text}</span>}</div>
              {cancelUrl && <a className="co-cancel" href={cancelUrl}><Icon.back /> Back to {shop}</a>}
              <div className="co-methods four" role="tablist" aria-label="Payment method">
                {METHODS.map((x) => (
                  <button key={x.m} role="tab" aria-selected={tab === x.m} disabled={busy} onClick={() => setTab(x.m)}>
                    {x.m === "stocks" ? <span className="co-stack" aria-hidden><Mark id="NVDA" size={20} /><Mark id="TSLA" size={20} /><Mark id="AAPL" size={20} /></span> : x.m === "credit" ? <Icon.layers /> : x.m === "private" ? <Icon.eyeOff /> : <Mark id="USDC" size={20} />}
                    <span><b>{x.title}</b><small>{x.sub}</small></span>
                  </button>
                ))}
              </div>
              {tab === "credit" && (
                <div className="co-sub" role="radiogroup" aria-label="Pay later">
                  <button role="radio" aria-checked={later === "payin3"} disabled={busy} onClick={() => setLater("payin3")}><Icon.layers /> Pay in 3</button>
                  <button role="radio" aria-checked={later === "paylater"} disabled={busy} onClick={() => setLater("paylater")}><Icon.clock /> Pay later · 30 days</button>
                </div>
              )}

              {!who ? (
                <div className="co-fund">
                  <p><b>Connect a wallet to pay.</b> A test wallet lives in this browser and gets free Fuji gas, test tUSDC and test stocks in one tap.</p>
                  <div className="row2">
                    <button className="btn ink" onClick={() => openTestWallet()}><Icon.user /> Use a test wallet</button>
                    <button className="btn line" onClick={() => connectWallet().catch((e) => setNote(msgOf(e)))}>Browser wallet</button>
                  </div>
                </div>
              ) : (tab === "stocks" || tab === "credit") ? (
                <div className="co-credit">
                  <div className="co-stock-pick" role="radiogroup" aria-label="Stock">
                    {(hold ?? STOCKS.map((s) => ({ sym: s.sym, balance: 0n, price8: 0n, fresh: false }))).map((x) => (
                      <button key={x.sym} role="radio" aria-checked={x.sym === sym} data-empty={x.balance === 0n} disabled={busy} onClick={() => setSym(x.sym)} aria-label={`t${x.sym}, ${units(x.balance)} held`}>
                        <Mark id={x.sym} size={30} /><span><b>t{x.sym}{x.price8 > 0n ? <i className="co-px"> ${usd8(x.price8)}</i> : null}</b><small>{units(x.balance)} held</small></span>
                      </button>
                    ))}
                  </div>
                  <dl className="co-quote">
                    {tab === "stocks" ? <>
                      <dt>You sell</dt><dd className="lg-row"><Mark id={sym} size={16} /><b className="num">{sellEst ? units(sellEst, 6) : "…"}</b> t{sym}</dd>
                      <dt>Price</dt><dd>{h?.price8 ? `$${usd8(h.price8)} · NorenStockOracle${h.fresh ? "" : " (refreshed on pay)"}` : "…"}</dd>
                      <dt>Sold</dt><dd>{cents(Number(lot))} tUSDC, a round lot; {cents(Number(lot - amount))} stays in your private balance</dd>
                    </> : <>
                      <dt>Collateral</dt><dd className="lg-row"><Mark id={sym} size={16} />t{sym}, locked, still yours</dd>
                      <dt>Credit available</dt><dd>{credit?.available != null ? `${cents(Number(credit.available / 10_000n))} tUSDC` : "lock stock to open a limit"} · LTV {(credit?.ltv ?? 6000) / 100}%</dd>
                      <dt>Plan</dt><dd>{later === "payin3" ? `3 × ${cents(Number((lot * 101n) / 300n))} tUSDC, two weeks apart` : `${cents(Number((lot * 101n) / 100n))} tUSDC in 30 days`} · 1% fee, no interest</dd>
                      <dt>Draw</dt><dd>{cents(Number(lot))} tUSDC, a round lot; {cents(Number(lot - amount))} stays in your private balance</dd>
                    </>}
                    <dt>{shop} receives</dt><dd className="lg-row"><Mark id="USDC" size={16} />{inv ? cents(inv.amountCents) : "…"} tUSDC, privately</dd>
                  </dl>
                </div>
              ) : (
                <div className="co-bal">
                  <div><span>{tab === "private" ? "Private balance" : "Wallet"}</span><b>{tab === "private" ? (priv !== null ? cents(Number(priv)) : <span className="faint">locked</span>) : "tUSDC"}<em>tUSDC</em></b></div>
                  <div><span>Paid to</span><b className="sm">{tab === "private" ? "Noren hub" : shop}</b></div>
                </div>
              )}

              {steps && (
                <ol className="co-steps">
                  {steps.map((s, i) => (
                    <li key={s.key} data-state={s.state === "done" || s.state === "skip" ? "done" : s.state === "run" ? "now" : s.state === "fail" ? "fail" : "todo"}>
                      <i>{s.state === "done" || s.state === "skip" ? <Icon.check /> : s.state === "run" ? <span className="spin xs" /> : s.state === "fail" ? <Icon.x /> : i + 1}</i>
                      <div><b>{s.title}{s.state === "skip" ? <span className="faint"> · already done</span> : null}</b><span>{s.error ? <span className="err">{s.error}</span> : s.hash ? <a className="tx-link" href={txUrl(s.hash)} target="_blank" rel="noreferrer">{short(s.hash, 8)} <Icon.ext /></a> : s.detail}</span></div>
                    </li>
                  ))}
                </ol>
              )}

              {note && <p className="err" role="status">{note}</p>}
              {who && (
                <button className={`btn ${tab === "stocks" ? "kaki" : "ink"} full xl`} disabled={busy || !inv || inv.status !== "open"} onClick={pay}>
                  {busy ? <><span className="spin" /> {steps?.find((s) => s.state === "run")?.title ?? "Working"}…</>
                    : tab === "stocks" ? <><Icon.chart /> Pay {inv ? cents(inv.amountCents) : ""} with t{sym}</>
                    : tab === "credit" ? <><Icon.lock /> {later === "payin3" ? "Pay in 3" : "Pay later"}, privately</>
                    : tab === "usdc" ? <>Pay {inv ? cents(inv.amountCents) : ""} tUSDC</>
                    : <><Icon.lock /> Pay {inv ? cents(inv.amountCents) : ""} tUSDC privately</>}
                </button>
              )}
              {who && <p className="faint sm center">{who.kind === "guest" ? "Test wallet kept in this browser · Avalanche Fuji, test funds only. Proofs are made on this device." : `${who.label} · Avalanche Fuji. Proofs are made on this device.`}</p>}
            </>
          )}
        </section>
      </div>
    </div>
  );
}

function Done({ inv, paid, receipt, total, shop, doneUrl }: { inv: Invoice | null; paid: Paid | null; receipt: Receipt | null; total: number | null; shop: string; doneUrl: string | null }) {
  const m = paid?.method ?? inv?.method ?? "private";
  const [leaving, setLeaving] = useState<number | null>(null);
  useEffect(() => {
    if (!doneUrl || inv?.status !== "paid") return;
    setLeaving(8);
    const t = setInterval(() => setLeaving((n) => { if (n === null) return n; if (n <= 1) { clearInterval(t); location.assign(doneUrl); return 0; } return n - 1; }), 1000);
    return () => clearInterval(t);
  }, [doneUrl, inv?.status]);
  const title = m === "stocks" ? <>Paid with <em>stocks</em>, privately</> : m === "payin3" ? <>Paid in <em>3</em>, privately</> : m === "paylater" ? <>Paid <em>later</em>, privately</> : m === "usdc" ? <>Paid with <em>tUSDC</em></> : <>Paid <em>privately</em></>;
  const tx = paid?.hash ?? inv?.paymentTx;
  return (
    <div className="co-done">
      <div className="co-check" aria-hidden><svg viewBox="0 0 52 52"><circle cx="26" cy="26" r="24" /><path d="m15 27 7.5 7.5L38 19" /></svg></div>
      <h2>{title}</h2>
      <p>{inv ? cents(inv.amountCents) : ""} tUSDC to {shop}.</p>
      <dl className="kv">
        {paid?.proofMs && <><dt>Proof made on this device</dt><dd>{(paid.proofMs / 1000).toFixed(1)} s, with the transfer</dd></>}
        {total && <><dt>Click to paid</dt><dd>{total.toFixed(1)} s</dd></>}
        <dt>Transaction</dt><dd><TxLink hash={tx} n={8} /></dd>
        {m === "usdc" ? <>
          <dt>Private</dt><dd>no: a public tUSDC transfer</dd>
        </> : <>
          <dt>Amount on chain</dt><dd className="unk">encrypted</dd>
          <dt>{shop} sees</dt><dd className="unk">Customer: Private</dd>
          <dt>Settlement</dt><dd>{inv?.status !== "paid" && !receipt ? "the hub is reading it…" : receipt?.status === "settled" ? <>batch #{receipt.batch} · <TxLink hash={receipt.payoutTx} n={6}>payout</TxLink></> : inv?.batch != null ? <>batch #{inv.batch}</> : receipt ? `in the next batch, ${new Date(receipt.nextSettleAt * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "queued for the next batch"}</dd>
        </>}
        {paid?.plan && <><dt>Plan</dt><dd>{paid.plan.parts === 3 ? "pay in 3" : "pay later"} · <a href="#/app/credit">repay in the Noren app</a></dd></>}
      </dl>
      {doneUrl && inv?.status === "paid" && <a className="btn ink full lg" href={doneUrl}>Return to {shop}{leaving ? ` (${leaving})` : ""} <Icon.arrow /></a>}
      <p className="faint sm">{m === "usdc" ? `A direct transfer on Avalanche Fuji, checked on chain by Noren’s API.` : `${shop} is paid by Noren’s hub in a batch with other shops and sees “Customer: Private”. Your receipt is signed by the hub and kept in this browser.`}</p>
    </div>
  );
}

export type { Address };
