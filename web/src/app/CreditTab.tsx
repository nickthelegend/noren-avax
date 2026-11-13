/**
 * Credit against stocks: your limit (NorenStockCredit on Avalanche Fuji), how it is made (lock stock → limit at your
 * LTV → pay in 3 or pay later at a checkout → repay on time → the LTV rises), your plans with their installments, and
 * your repayment record. Every number is read from the contract.
 */
import { useState } from "react";
import { erc20Abi, maxUint256, type Abi } from "viem";
import { LTV_LADDER, norenStockCreditAbi, type StockSym } from "@noren-avax/sdk";
import { D, pub } from "../lib/chain";
import { write } from "../lib/signer";
import { msgOf } from "../ui";
import { TxLink } from "../tx";
import { Mark } from "../logos";
import { Card, Empty, Spin } from "./kit";
import type { W, Tab } from "./NorenApp";
import { p8, sh, u6, type Acct } from "./acct";

const day = (t: number) => new Date(t * 1000).toLocaleDateString([], { month: "short", day: "numeric" });

export function CreditTab({ w, go }: { w: W; go: (t: Tab) => void }) {
  const a = w.acct, c = a.credit;
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ t: string; bad?: boolean } | null>(null);
  const run = async (k: string, f: () => Promise<unknown>, ok: string) => { setBusy(k); setNote(null); try { await f(); setNote({ t: ok }); w.reload(); } catch (e) { setNote({ t: msgOf(e), bad: true }); } finally { setBusy(null); } };
  const locked = c?.collateral.filter((x) => x.amount > 0n) ?? [];
  const open = c?.plans.filter((p) => !p.closed) ?? [];
  const done = c?.plans.filter((p) => p.closed) ?? [];
  const value = c?.value ?? null;
  const steps: { t: string; d: string; on: boolean; act?: [string, () => void] }[] = [
    { t: "Lock stock as collateral", d: locked.length ? `${locked.map((x) => `${sh(x.amount)} t${x.sym}`).join(", ")} · ${u6(value)} tUSDC of value` : "Your shares stay yours in NorenStockCredit", on: locked.length > 0, act: ["Lock", () => go("earn")] },
    { t: `Credit limit: ${u6(c?.limit)} tUSDC (${(c?.ltvBps ?? 6000) / 100}%)`, d: "Value at NorenStockOracle prices × your LTV; a stale price stops new credit", on: (c?.limit ?? 0n) > 0n },
    { t: "Pay in 3 or pay later at a checkout", d: "A round lot is drawn from the Earn pool into your private balance; the shop is paid privately", on: (c?.plans.length ?? 0) > 0, act: ["Pay", () => go("pay")] },
    { t: "Repay on time, your limit grows", d: "Every on-time installment adds 5 points of LTV, up to 75%", on: (c?.onTime ?? 0) > 0 },
  ];
  return (
    <div className="nk-col">
      <div className="nk-hero" aria-label="Your credit limit">
        <small>Credit limit · NorenStockCredit on Avalanche Fuji</small>
        <b>{c?.limit != null ? <><i>$</i>{u6(c.limit)}</> : "–"}</b>
        <p>{!c ? "Reading your position…" : c.limit == null ? "A stock price is over an hour old. Paying refreshes it from the signed relayer report." : locked.length === 0 ? "No stock locked yet. Your limit is your locked stock’s value at your LTV, starting at 60%." : `LTV ${c.ltvBps / 100}% · ${u6(c.available)} tUSDC available · ${u6(c.owed)} owed`}</p>
      </div>

      <Card title="Stock → credit, in four steps" sub="Borrow against your shares without selling them">
        <div className="nk-pad">
          <ul className="nk-items">{steps.map((s, i) => <li key={s.t} data-done={s.on}><span className="nk-check">{s.on ? "✓" : i + 1}</span><div><b>{s.t}</b><small>{s.d}</small></div>{s.act && <button className="nk-btn xs r" onClick={s.act[1]}>{s.act[0]}</button>}</li>)}</ul>
        </div>
      </Card>

      <Card title="Raise your limit" sub="On-time installments are recorded by NorenStockCredit; each one adds 5 points of LTV" pill={<span className="nk-pill">{c?.onTime ?? 0} on time</span>}>
        <div className="nk-pad">
          <ul className="nk-items" aria-label="Credit limit by repayment record">
            {LTV_LADDER.map((ltv, i) => {
              const reached = (c?.ltvBps ?? 6000) >= ltv;
              const cap = value != null ? (value * BigInt(ltv)) / 10_000n : null;
              return (
                <li key={ltv} data-done={reached}>
                  <span className="nk-check">{reached ? "✓" : i + 1}</span>
                  <div><b>{i === 0 ? "Any locked stock" : `${i} on-time installment${i === 1 ? "" : "s"}`}</b><small>{ltv / 100}% LTV{(c?.ltvBps ?? 6000) === ltv ? " · you are here" : ""}</small></div>
                  <span className="r"><b>${cap != null ? u6(cap) : "–"}</b><small>{i > 0 && cap != null && value ? `+${(((ltv - 6000) / 6000) * 100).toFixed(1)}%` : "tUSDC"}</small></span>
                </li>
              );
            })}
          </ul>
          <div className="nk-stats" aria-label="Repayment record">
            <div className="nk-stat"><small>On-time installments</small><b className={c?.onTime ? "ok" : ""}>{c?.onTime ?? 0}</b></div>
            <div className="nk-stat"><small>Late installments</small><b className={c?.late ? "warn" : ""}>{c?.late ?? 0}</b></div>
            <div className="nk-stat"><small>Plans completed</small><b>{done.length}</b></div>
            <div className="nk-stat"><small>Owed</small><b>{u6(c?.owed)}</b></div>
          </div>
        </div>
      </Card>

      <Card title="Your plans" sub="Pay in 3: three installments two weeks apart. Pay later: one payment in 30 days. 1% fee, no interest.">
        <div className="nk-pad">
          {!c?.plans.length ? <Empty title="No plans yet" text="Choose “Pay in 3 / Pay later” at a Noren checkout." /> : (
            <ul className="nk-plans">
              {[...open, ...done].map((p) => {
                const part = p.total / BigInt(p.parts);
                return (
                  <li key={String(p.id)} data-closed={p.closed}>
                    <div className="nk-plan-h"><b>{p.parts === 3 ? "Pay in 3" : "Pay later"} · {u6(p.principal)} tUSDC</b><small>plan #{String(p.id)} · opened {day(p.start)} · {p.closed ? "repaid" : `${u6(p.total - p.repaid)} left`}</small></div>
                    <ol className="nk-inst">
                      {Array.from({ length: p.parts }, (_, i) => {
                        const paid = i < p.paid;
                        const due = p.start + p.interval * (i + 1);
                        return <li key={i} data-paid={paid}><b>{u6(i === p.parts - 1 ? p.total - part * BigInt(p.parts - 1) : part)}</b><small>{paid ? "Paid" : `Due ${day(due)}`}</small></li>;
                      })}
                    </ol>
                    {!p.closed && <button className="nk-cta" disabled={!!busy || a.usdc < p.next} onClick={() => run(`pay${p.id}`, async () => {
                      const allowance = (await pub.readContract({ address: D.tUSDC, abi: erc20Abi, functionName: "allowance", args: [a.address, D.stockCredit] })) as bigint;
                      if (allowance < p.next) await write(D.tUSDC, erc20Abi as Abi, "approve", [D.stockCredit, maxUint256], "approve tUSDC for NorenStockCredit");
                      return write(D.stockCredit, norenStockCreditAbi as Abi, "payInstallment", [p.id], `repay installment ${p.paid + 1} of plan #${p.id}: ${u6(p.next)} tUSDC`);
                    }, "Installment repaid on time. Your LTV went up 5 points.")}>{busy === `pay${p.id}` ? <><Spin /> Repaying…</> : a.usdc < p.next ? `Needs ${u6(p.next)} tUSDC in your wallet` : `Repay ${u6(p.next)} tUSDC now`}</button>}
                  </li>
                );
              })}
            </ul>
          )}
          {note && <div className={note.bad ? "nk-err" : "nk-note"} role="status">{note.t}</div>}
          <p className="nk-fine">Repayments are public tUSDC transfers to NorenStockCredit. A position whose debt passes 85% of its collateral value can be liquidated (5% bonus). The tUSDC lent comes from the Earn pool.</p>
        </div>
      </Card>

      <Collateral a={a} reload={w.reload} />
    </div>
  );
}

function Collateral({ a, reload }: { a: Acct; reload: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const locked = a.credit?.collateral.filter((x) => x.amount > 0n) ?? [];
  if (!locked.length) return null;
  const unlock = async (sym: StockSym, amount: bigint) => { setBusy(sym); setErr(null); try { await write(D.stockCredit, norenStockCreditAbi as Abi, "unlock", [a.stocks.find((s) => s.sym === sym)!.token, amount], `unlock ${sh(amount)} t${sym}`); reload(); } catch (e) { setErr(msgOf(e)); } finally { setBusy(null); } };
  return (
    <Card title="Locked collateral" sub="Still your shares. Unlock any time your debt stays under your limit.">
      <div className="nk-pad">
        <ul className="nk-items">{locked.map((x) => { const s = a.stocks.find((y) => y.sym === x.sym)!; return (
          <li key={x.sym} data-done><span className="nk-check"><Mark id={x.sym} size={18} /></span><div><b>{sh(x.amount)} t{x.sym}</b><small>${p8(s.price8)} · {u6((x.amount * s.price8) / 10n ** 20n)} tUSDC</small></div><button className="nk-btn xs r" disabled={!!busy} onClick={() => unlock(x.sym, x.amount)}>{busy === x.sym ? "…" : "Unlock all"}</button></li>
        ); })}</ul>
        {err && <div className="nk-err">{err}</div>}
      </div>
    </Card>
  );
}

export { TxLink };
