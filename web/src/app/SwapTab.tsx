/** Swap: buy or sell test stocks against tUSDC at NorenStockDesk, at the oracle price ± 0.5%. Public. */
import { useEffect, useState } from "react";
import { erc20Abi, maxUint256, parseUnits, type Abi } from "viem";
import { norenStockDeskAbi, type StockSym } from "@noren-avax/sdk";
import { D, pub } from "../lib/chain";
import { write } from "../lib/signer";
import { msgOf } from "../ui";
import { Mark } from "../logos";
import { Card, Spin } from "./kit";
import type { W } from "./NorenApp";
import { p8, sh, u6, when } from "./acct";

export function SwapTab({ w }: { w: W }) {
  const a = w.acct;
  const [side, setSide] = useState<"buy" | "sell">("sell");
  const [sym, setSym] = useState<StockSym>("NVDA");
  const [amt, setAmt] = useState("0.1");
  const [out, setOut] = useState<bigint | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ t: string; bad?: boolean } | null>(null);
  const s = a.stocks.find((x) => x.sym === sym)!;
  let input = 0n; try { input = parseUnits(amt || "0", side === "sell" ? 18 : 6); } catch { input = 0n; }
  useEffect(() => {
    if (!input) { setOut(null); return; }
    let on = true;
    pub.readContract({ address: D.stockDesk, abi: norenStockDeskAbi, functionName: side === "sell" ? "quoteSell" : "quoteBuy", args: [s.token, input] }).then((r) => on && setOut((r as readonly [bigint, bigint])[0])).catch(() => on && setOut(null));
    return () => { on = false; };
  }, [side, sym, amt]); // eslint-disable-line react-hooks/exhaustive-deps
  const go = async () => {
    setBusy(true); setNote(null);
    try {
      const token = side === "sell" ? s.token : D.tUSDC;
      const al = (await pub.readContract({ address: token, abi: erc20Abi, functionName: "allowance", args: [a.address, D.stockDesk] })) as bigint;
      if (al < input) await write(token, erc20Abi as Abi, "approve", [D.stockDesk, maxUint256], `approve ${side === "sell" ? `t${sym}` : "tUSDC"} for the stock desk`);
      const min = out ? (out * 995n) / 1000n : 0n;
      await write(D.stockDesk, norenStockDeskAbi as Abi, side, [s.token, input, min, a.address], side === "sell" ? `sell ${amt} t${sym}` : `buy t${sym} with ${amt} tUSDC`);
      setNote({ t: side === "sell" ? `Sold ${amt} t${sym}.` : `Bought t${sym}.` }); w.reload();
    } catch (e) { setNote({ t: msgOf(e), bad: true }); } finally { setBusy(false); }
  };
  const have = side === "sell" ? s.balance : a.usdc;
  return (
    <div className="nk-col">
      <Card title="Swap" sub="Stocks ⇄ tUSDC at NorenStockDesk: the signed oracle price ± 0.5%. Swaps are public." pill={<span className="nk-pill live"><Mark id="AVAX" size={14} />Fuji</span>}>
        <div className="nk-pad">
          <div className="nk-seg" role="radiogroup" aria-label="Side"><button role="radio" aria-checked={side === "sell"} onClick={() => { setSide("sell"); setAmt("0.1"); }}>Sell stock</button><button role="radio" aria-checked={side === "buy"} onClick={() => { setSide("buy"); setAmt("20"); }}>Buy stock</button></div>
          <div className="nk-stockpick" role="radiogroup" aria-label="Stock">
            {a.stocks.map((x) => <button key={x.sym} type="button" role="radio" aria-checked={x.sym === sym} onClick={() => setSym(x.sym)}><Mark id={x.sym} size={22} /><span><b>t{x.sym}</b><small>{sh(x.balance)} · ${p8(x.price8)}</small></span></button>)}
          </div>
          <div className="nk-box">
            <label htmlFor="nk-swap">You pay</label>
            <div className="nk-row"><input id="nk-swap" inputMode="decimal" value={amt} onChange={(e) => setAmt(e.target.value.replace(/[^0-9.]/g, ""))} /><span className="nk-unit lg-row"><Mark id={side === "sell" ? sym : "USDC"} size={18} />{side === "sell" ? `t${sym}` : "tUSDC"}</span></div>
            <div className="nk-sub"><span>{side === "sell" ? `${sh(have)} held` : `${u6(have)} in wallet`}</span><span /></div>
          </div>
          <div className="nk-box">
            <label>You receive</label>
            <div className="nk-row"><b className="nk-out">{out === null ? "–" : side === "sell" ? u6(out) : sh(out, 6)}</b><span className="nk-unit lg-row"><Mark id={side === "sell" ? "USDC" : sym} size={18} />{side === "sell" ? "tUSDC" : `t${sym}`}</span></div>
            <div className="nk-sub"><span>NorenStockOracle ${p8(s.price8)} · quote {s.marketTime ? when(s.marketTime) : "–"} · Yahoo Finance via Noren’s signed relayer</span><span /></div>
          </div>
          <button className="nk-cta" disabled={busy || !input || input > have || out === null} onClick={go}>{busy ? <><Spin /> Swapping…</> : input > have ? "Not enough balance" : side === "sell" ? `Sell t${sym}` : `Buy t${sym}`}</button>
          {note && <div className={note.bad ? "nk-err" : "nk-note"} role="status">{note.t}</div>}
        </div>
      </Card>
    </div>
  );
}
