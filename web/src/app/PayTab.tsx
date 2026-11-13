/** Pay: pay a Noren link, and your receipts (signed by Noren's hub) with where each payment is in settlement. */
import { useEffect, useState } from "react";
import type { Hex } from "viem";
import { api, cents, savedClaims, type Receipt } from "../lib/api";
import { TxLink } from "../tx";
import { Card, Empty } from "./kit";
import { PayInvoice } from "./PayInvoice";
import type { W } from "./NorenApp";

export function PayTab({ w }: { w: W }) {
  const claims = Object.entries(savedClaims()).sort((a, b) => b[1].at - a[1].at).slice(0, 8);
  const [rc, setRc] = useState<Record<string, Receipt | null>>({});
  useEffect(() => {
    let on = true;
    Promise.all(claims.map(async ([tx, c]) => [tx, await api<Receipt | { status: "unseen" }>("/receipt", { tx, claim: c.claim }).then((r) => ("hub" in r ? r : null)).catch(() => null)] as const)).then((xs) => on && setRc(Object.fromEntries(xs)));
    return () => { on = false; };
  }, [w.acct]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="nk-col">
      <Card title="Pay" sub="Paste or scan a Noren link. Stocks, credit against stocks, or your private balance.">
        <div className="nk-pad"><PayInvoice w={w} /></div>
      </Card>
      <Card title="Your receipts" sub="Signed by Noren’s hub, kept in this browser. Only you hold the claim that proves each payment.">
        <div className="nk-pad">
          {!claims.length ? <Empty title="No payments yet" text="Pay a link above; its receipt shows up here." /> : (
            <ul className="nk-items">{claims.map(([tx, c]) => { const r = rc[tx]; return (
              <li key={tx} data-done={r?.status === "settled"}>
                <span className="nk-check">{r?.status === "settled" ? "✓" : ""}</span>
                <div><b>{c.shop} · {cents(Number(c.cents))} tUSDC</b><small>{c.item} · {c.method} · {r ? (r.status === "settled" ? `settled in batch #${r.batch}` : r.status) : "the hub is reading it"}</small></div>
                <span className="r"><TxLink hash={tx as Hex} n={4} /></span>
              </li>
            ); })}</ul>
          )}
        </div>
      </Card>
    </div>
  );
}
