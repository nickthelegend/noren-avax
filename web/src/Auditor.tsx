/**
 * The public side of Noren's settlement on Avalanche: every batch the hub recorded on NorenSettlement, with the
 * customer payments it settled and the payouts it made (amounts encrypted). The eERC auditor holds the key that
 * decrypts each batch's auditor copy; anyone can see that the batches exist and when.
 */
import { useEffect, useState } from "react";
import { readBatches, type BatchRecord } from "@noren-avax/sdk";
import { D, addrUrl, pub } from "./lib/chain";
import { Icon, Logo, msgOf } from "./ui";
import { TxLink } from "./tx";

export function Auditor() {
  const [b, setB] = useState<BatchRecord[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { readBatches(pub as never, D as never).then((x) => setB([...x].reverse())).catch((e) => setErr(msgOf(e))); }, []);
  return (
    <div className="sd aud">
      <div className="sd-testbar">Noren · settlement record on Avalanche Fuji. Test tokens only.</div>
      <div className="sd-body" style={{ marginLeft: 0 }}>
        <header className="sd-top"><a className="site-brand" href="#/"><Logo /><span>Noren</span></a><div className="sd-top-r"><a className="sd-btn sm" href="#/dashboard">Noren Merchant <Icon.arrow /></a></div></header>
        <main className="sd-main">
          <div className="sd-head"><div><h1>Settlement batches</h1><p>Every batch Noren’s hub recorded on <a href={addrUrl(D.norenSettlement!)} target="_blank" rel="noreferrer">NorenSettlement</a>. Payments in and payouts out are eERC transfers: anyone sees that they happened, only the shop, its accountant and the eERC auditor can read the amounts.</p></div></div>
          <div className="sd-table-wrap">
            {err ? <div className="sd-callout bad"><span>{err}</span></div> : !b ? <div className="sd-skel-rows"><i /><i /><i /></div> : (
              <table className="sd-table static">
                <thead><tr><th>Batch</th><th>When</th><th className="r">Payments in</th><th className="r">Payouts</th><th>Record</th></tr></thead>
                <tbody>{b.map((x) => (
                  <tr key={x.batchId}>
                    <td><b>#{x.batchId}</b></td>
                    <td className="sd-muted">{new Date(x.at * 1000).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</td>
                    <td className="r">{x.payments.length}</td>
                    <td className="r">{x.payoutTxs.length}</td>
                    <td><TxLink hash={x.tx} /></td>
                  </tr>
                ))}</tbody>
              </table>
            )}
          </div>
          <p className="sd-foot-n">Hub account <a className="mono" href={addrUrl(D.hub!)} target="_blank" rel="noreferrer">{D.hub}</a>. Zero-value cover payouts make every batch pay at least three shops.</p>
        </main>
      </div>
    </div>
  );
}
