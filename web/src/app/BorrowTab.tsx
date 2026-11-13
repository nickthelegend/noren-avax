/**
 * Borrow against crypto: NorenCredit lends tUSDC against tWBTC or AVAX at Chainlink's Fuji prices (BTC/USD, AVAX/USD),
 * with a health factor and liquidation. A stale Chainlink round stops new credit.
 */
import { useEffect, useState } from "react";
import { erc20Abi, maxUint256, parseUnits, type Abi } from "viem";
import { norenCreditAbi, readPosition, readPrices, type CreditPosition, type Prices } from "@noren-avax/sdk";
import { D, pub } from "../lib/chain";
import { write } from "../lib/signer";
import { msgOf } from "../ui";
import { Mark } from "../logos";
import { Card, Spin } from "./kit";
import type { W } from "./NorenApp";
import { u6 } from "./acct";

export function BorrowTab({ w }: { w: W }) {
  const a = w.acct;
  const [pos, setPos] = useState<CreditPosition | null>(null);
  const [px, setPx] = useState<Prices | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ t: string; bad?: boolean } | null>(null);
  const [amt, setAmt] = useState("20");
  useEffect(() => { let on = true; Promise.all([readPosition(pub as never, D, a.address), readPrices(pub as never, D)]).then(([p, q]) => on && (setPos(p), setPx(q), setErr(null))).catch((e) => on && setErr(msgOf(e))); return () => { on = false; }; }, [a]);
  const run = async (k: string, f: () => Promise<unknown>, ok: string) => { setBusy(k); setNote(null); try { await f(); setNote({ t: ok }); w.reload(); } catch (e) { setNote({ t: msgOf(e), bad: true }); } finally { setBusy(null); } };
  let v6 = 0n; try { v6 = parseUnits(amt || "0", 6); } catch { v6 = 0n; }
  const health = pos ? (pos.debt === 0n ? "∞" : (Number(pos.health) / 1e18).toFixed(2)) : "…";
  return (
    <div className="nk-col">
      <div className="nk-hero" aria-label="Borrow">
        <small>Borrow against crypto · NorenCredit · Chainlink prices on Fuji</small>
        <b>{pos ? <><i>$</i>{u6(pos.available)}</> : "…"}</b>
        <p>{err ?? (pos ? `available · ${u6(pos.debt)} tUSDC owed · health ${health}` : "Reading your position…")}</p>
      </div>
      <Card title="Collateral" sub="tWBTC from the starter pack, priced by Chainlink BTC / USD">
        <div className="nk-pad">
          <div className="nk-stats">
            <div className="nk-stat"><small>BTC / USD</small><b>{px ? `$${(Number(px.btc) / 1e8).toLocaleString("en-US", { maximumFractionDigits: 0 })}` : "…"}</b></div>
            <div className="nk-stat"><small>AVAX / USD</small><b>{px ? `$${(Number(px.avax) / 1e8).toFixed(2)}` : "…"}</b></div>
            <div className="nk-stat"><small>Locked tWBTC</small><b>{pos ? (Number(pos.btc) / 1e8).toString() : "…"}</b></div>
            <div className="nk-stat"><small>Collateral value</small><b>{u6(pos?.collateralValue)}</b></div>
          </div>
          {px?.stale && <div className="nk-err">{px.stale}</div>}
          <button className="nk-cta soft" disabled={!!busy || a.wbtc === 0n} onClick={() => run("lock", async () => {
            const al = (await pub.readContract({ address: D.tWBTC, abi: erc20Abi, functionName: "allowance", args: [a.address, D.norenCredit] })) as bigint;
            if (al < a.wbtc) await write(D.tWBTC, erc20Abi as Abi, "approve", [D.norenCredit, maxUint256], "approve tWBTC");
            await write(D.norenCredit, norenCreditAbi as Abi, "depositCollateral", [D.tWBTC, a.wbtc], `lock ${Number(a.wbtc) / 1e8} tWBTC as collateral`);
          }, "tWBTC locked.")}>{busy === "lock" ? <><Spin /> Locking…</> : <><Mark id="BTC" size={18} /> Lock {Number(a.wbtc) / 1e8} tWBTC</>}</button>
        </div>
      </Card>
      <Card title="Borrow tUSDC" sub="To your wallet. Interest accrues; repay any time.">
        <div className="nk-pad">
          <div className="nk-box"><label htmlFor="nk-borrow">Amount</label><div className="nk-row"><input id="nk-borrow" inputMode="decimal" value={amt} onChange={(e) => setAmt(e.target.value.replace(/[^0-9.]/g, ""))} /></div></div>
          <div className="nk-row2">
            <button className="nk-cta" disabled={!!busy || v6 === 0n} onClick={() => run("borrow", () => write(D.norenCredit, norenCreditAbi as Abi, "borrow", [v6, a.address], `borrow ${amt} tUSDC`), `Borrowed ${amt} tUSDC.`)}>{busy === "borrow" ? <><Spin /> Borrowing…</> : `Borrow ${amt || 0}`}</button>
            <button className="nk-cta soft" disabled={!!busy || !pos?.debt} onClick={() => run("repay", async () => {
              const al = (await pub.readContract({ address: D.tUSDC, abi: erc20Abi, functionName: "allowance", args: [a.address, D.norenCredit] })) as bigint;
              if (al < pos!.debt + 1_000_000n) await write(D.tUSDC, erc20Abi as Abi, "approve", [D.norenCredit, maxUint256], "approve tUSDC");
              await write(D.norenCredit, norenCreditAbi as Abi, "repay", [a.address, pos!.debt + pos!.debt / 1000n + 1n], "repay in full");
            }, "Repaid.")}>{busy === "repay" ? <><Spin /> Repaying…</> : "Repay in full"}</button>
          </div>
          {note && <div className={note.bad ? "nk-err" : "nk-note"} role="status">{note.t}</div>}
          <p className="nk-fine">Want to keep your shares and still spend? Credit against stocks is in Credit; it pays shops privately.</p>
        </div>
      </Card>
    </div>
  );
}
