/**
 * Earn. Two things money can do here:
 * - Deposit stock, get credit: lock test stock in NorenStockCredit; it stays yours and backs a credit limit of 60% of
 *   its value, rising to 75% with on-time repayments.
 * - Fund stock credit: supply tUSDC to the pool that pays shops for pay-in-3 and pay-later plans; the 1% plan fees
 *   repaid raise the value of every share. Withdraw what isn't lent out at any time.
 */
import { useState } from "react";
import { erc20Abi, maxUint256, parseUnits, type Abi } from "viem";
import { LTV_LADDER, norenStockCreditAbi, type StockSym } from "@noren-avax/sdk";
import { D, pub } from "../lib/chain";
import { write } from "../lib/signer";
import { msgOf } from "../ui";
import { Mark } from "../logos";
import { Card, Spin } from "./kit";
import type { W, Tab } from "./NorenApp";
import { p8, sh, u6, when } from "./acct";

async function approveIf(token: `0x${string}`, owner: `0x${string}`, spender: `0x${string}`, amount: bigint, what: string) {
  const al = (await pub.readContract({ address: token, abi: erc20Abi, functionName: "allowance", args: [owner, spender] })) as bigint;
  if (al < amount) await write(token, erc20Abi as Abi, "approve", [spender, maxUint256], what);
}

export function EarnTab({ w, go }: { w: W; go: (t: Tab) => void }) {
  const a = w.acct;
  const [sym, setSym] = useState<StockSym>(() => a.stocks.find((s) => s.balance > 0n)?.sym ?? "NVDA");
  const [amt, setAmt] = useState("1");
  const [sup, setSup] = useState("50");
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ t: string; bad?: boolean; k: string } | null>(null);
  const s = a.stocks.find((x) => x.sym === sym)!;
  let wei = 0n; try { wei = parseUnits(amt || "0", 18); } catch { wei = 0n; }
  const value6 = (wei * s.price8) / 10n ** 20n;
  const ltv = a.credit?.ltvBps ?? 6000;
  const run = async (k: string, f: () => Promise<unknown>, ok: string) => { setBusy(k); setNote(null); try { await f(); setNote({ t: ok, k }); w.reload(); } catch (e) { setNote({ t: msgOf(e), bad: true, k }); } finally { setBusy(null); } };
  const pool = a.pool;
  let sup6 = 0n; try { sup6 = parseUnits(sup || "0", 6); } catch { sup6 = 0n; }
  return (
    <div className="nk-col">
      <Card title="Deposit stock, get credit" sub="Lock test stock instead of selling it. It stays yours and backs a credit limit." pill={<span className="nk-pill live"><Mark id="AVAX" size={14} />Fuji</span>}>
        <div className="nk-pad">
          <div className="nk-earn-top">
            <div><small>You deposit</small><b>${u6(value6)}</b><span>of t{sym}</span></div>
            <i aria-hidden>→</i>
            <div><small>Credit today</small><b>${u6((value6 * BigInt(ltv)) / 10_000n)}</b><span>{ltv / 100}% LTV</span></div>
            <i aria-hidden>→</i>
            <div><small>Up to</small><b>${u6((value6 * 7500n) / 10_000n)}</b><span>75% with on-time repayments</span></div>
          </div>
          <div className="nk-ltv" aria-label="LTV ladder">{LTV_LADDER.map((l, i) => <span key={l} data-on={ltv >= l}><b>{l / 100}%</b><small>{i === 0 ? "any deposit" : `${i} on time`}</small></span>)}</div>
          <div className="nk-stockpick" role="radiogroup" aria-label="Stock">
            {a.stocks.map((x) => <button key={x.sym} type="button" role="radio" aria-checked={x.sym === sym} data-empty={x.balance === 0n} onClick={() => setSym(x.sym)}><Mark id={x.sym} size={22} /><span><b>t{x.sym}</b><small>{sh(x.balance)} · ${p8(x.price8)}</small></span></button>)}
          </div>
          <div className="nk-box">
            <label htmlFor="nk-lock">Amount of t{sym}</label>
            <div className="nk-row"><input id="nk-lock" inputMode="decimal" value={amt} onChange={(e) => setAmt(e.target.value.replace(/[^0-9.]/g, ""))} /><button className="nk-btn" onClick={() => setAmt(String(Number(s.balance) / 1e18))}>Max</button></div>
            <div className="nk-sub"><span>{sh(s.balance)} held · price ${p8(s.price8)} · quote {s.marketTime ? when(s.marketTime) : "–"}{s.fresh ? "" : " · report over an hour old"}</span><span /></div>
          </div>
          <button className="nk-cta" disabled={!!busy || wei === 0n || wei > s.balance} onClick={() => run("lock", async () => { await approveIf(s.token, a.address, D.stockCredit, wei, `approve t${sym} for NorenStockCredit`); await write(D.stockCredit, norenStockCreditAbi as Abi, "lock", [s.token, wei], `lock ${amt} t${sym} as collateral`); }, `Locked ${amt} t${sym}. Your credit limit grew.`)}>{busy === "lock" ? <><Spin /> Locking…</> : wei > s.balance ? `You hold ${sh(s.balance)} t${sym}` : `Lock ${amt || 0} t${sym}`}</button>
          {note?.k === "lock" && <div className={note.bad ? "nk-err" : "nk-note"} role="status">{note.t} {!note.bad && <button className="nk-btn xs" onClick={() => go("credit")}>See credit</button>}</div>}
          <p className="nk-fine">Prices: NorenStockOracle, Yahoo Finance quotes signed by Noren’s price relayer (Chainlink has no equity feeds on Fuji). Reads refuse a report over an hour old.</p>
        </div>
      </Card>

      <Card title="Fund stock credit" sub="Supply tUSDC to the pool that pays shops for pay-in-3 and pay-later plans. Plan fees raise your share’s value.">
        <div className="nk-pad">
          <div className="nk-stats">
            <div className="nk-stat"><small>Pool</small><b>{u6(pool?.totalAssets)}</b></div>
            <div className="nk-stat"><small>Lent out</small><b>{u6(pool?.outstanding)}</b></div>
            <div className="nk-stat"><small>Fees earned</small><b className="ok">{u6(pool?.fees)}</b></div>
            <div className="nk-stat"><small>Yours</small><b>{u6(pool?.myValue)}</b></div>
          </div>
          <div className="nk-box">
            <label htmlFor="nk-sup">Supply tUSDC</label>
            <div className="nk-row"><input id="nk-sup" inputMode="decimal" value={sup} onChange={(e) => setSup(e.target.value.replace(/[^0-9.]/g, ""))} /><button className="nk-btn" onClick={() => setSup(String(Number(a.usdc) / 1e6))}>Max</button></div>
            <div className="nk-sub"><span>{u6(a.usdc)} tUSDC in your wallet</span><span /></div>
          </div>
          <div className="nk-row2">
            <button className="nk-cta" disabled={!!busy || sup6 === 0n || sup6 > a.usdc} onClick={() => run("sup", async () => { await approveIf(D.tUSDC, a.address, D.stockCredit, sup6, "approve tUSDC for the Earn pool"); await write(D.stockCredit, norenStockCreditAbi as Abi, "supply", [sup6], `supply ${sup} tUSDC to the Earn pool`); }, `Supplied ${sup} tUSDC.`)}>{busy === "sup" ? <><Spin /> Supplying…</> : `Supply ${sup || 0} tUSDC`}</button>
            <button className="nk-cta soft" disabled={!!busy || !pool?.myShares} onClick={() => run("wd", () => write(D.stockCredit, norenStockCreditAbi as Abi, "withdraw", [pool!.myShares], "withdraw from the Earn pool"), "Withdrawn to your wallet.")}>{busy === "wd" ? <><Spin /> Withdrawing…</> : "Withdraw all"}</button>
          </div>
          {note && note.k !== "lock" && <div className={note.bad ? "nk-err" : "nk-note"} role="status">{note.t}</div>}
          <p className="nk-fine">No headline APY: what you earn is the 1% fees borrowers actually repay. Withdrawals wait for cash the pool hasn’t lent out.</p>
        </div>
      </Card>
    </div>
  );
}
