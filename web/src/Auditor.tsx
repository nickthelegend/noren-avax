/**
 * The public side of Noren's settlement on Avalanche: every batch the hub recorded on NorenSettlement, with the
 * customer payments it settled and the payouts it made (amounts encrypted). The eERC auditor holds the key that
 * decrypts the auditor ciphertext every eERC transfer carries; "Read the amounts" does that here, in the browser, for
 * the auditor's own wallet only (anyone else's key decrypts nothing, and the page says so).
 */
import { useEffect, useState } from "react";
import { readBatches, type AuditEntry, type BatchRecord } from "@noren-avax/sdk";
import { D, addrUrl, pub } from "./lib/chain";
import { connectWallet, hasAuditorKey, openAuditorKey, privateSession, unlock, useWho } from "./lib/signer";
import { Icon, Logo, msgOf } from "./ui";
import { TxLink } from "./tx";

const HOURS = 6;
const same = (a?: string | null, b?: string | null) => !!a && !!b && a.toLowerCase() === b.toLowerCase();
const cents = (c: bigint | null) => (c === null ? "–" : (Number(c) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const short = (a?: string | null) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "");

function AuditorLedger() {
  const who = useWho();
  const [rows, setRows] = useState<(AuditEntry & { at?: number })[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const isAuditor = same(who?.address, D.auditor);
  const read = async () => {
    setBusy(true); setErr(null); setRows(null);
    try {
      await unlock();
      const head = await pub.getBlockNumber();
      const from = head > BigInt(HOURS * 3600) ? head - BigInt(HOURS * 3600) : 0n; // Fuji: about a block a second
      const all = (await privateSession().audit(from)).filter((r) => r.kind !== "Deposit");
      const top = all.slice(0, 12);
      const times = await Promise.all(top.map((r) => pub.getBlock({ blockNumber: r.block }).then((b) => Number(b.timestamp)).catch(() => undefined)));
      setRows(top.map((r, i) => ({ ...r, at: times[i] })));
    } catch (e) { setErr(msgOf(e)); } finally { setBusy(false); }
  };
  return (
    <section className="aud-ledger" aria-labelledby="aud-ledger-h">
      <div className="aud-ledger-h">
        <div>
          <h2 id="aud-ledger-h">Read the amounts <span className="sd-muted">· eERC auditor</span></h2>
          <p>Every eERC transfer carries a copy of its amount encrypted to the auditor’s key ({short(D.auditor)}). Decrypted here, in this browser; the key never leaves it.</p>
        </div>
        <div className="aud-ledger-act">
          {!who ? (
            hasAuditorKey()
              ? <button className="sd-btn primary" onClick={() => { try { openAuditorKey(); } catch (e) { setErr(msgOf(e)); } }}>Open with this browser’s auditor key</button>
              : <button className="sd-btn" onClick={() => connectWallet().catch((e) => setErr(msgOf(e)))}>Connect the auditor’s wallet</button>
          ) : !isAuditor ? (
            <span className="sd-muted">{who.label} is not the eERC auditor, so it can’t read these amounts.</span>
          ) : (
            <button className="sd-btn primary" disabled={busy} onClick={read}>{busy ? <><span className="spin xs" /> Decrypting…</> : rows ? "Read again" : `Decrypt the last ${HOURS} hours`}</button>
          )}
        </div>
      </div>
      {err && <div className="sd-callout bad"><span>{err}</span></div>}
      {rows && (
        <table className="sd-table static aud-ledger-t">
          <thead><tr><th>When (UTC)</th><th>Transfer</th><th>From → to</th><th className="r">Amount</th><th>Transaction</th></tr></thead>
          <tbody>{rows.map((r) => {
            const toHub = same(r.to, D.hub), fromHub = same(r.from, D.hub);
            return (
              <tr key={`${r.tx}-${r.kind}-${r.from}`}>
                <td className="sd-muted">{r.at ? new Date(r.at * 1000).toLocaleString("en-GB", { timeZone: "UTC", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : `block ${r.block}`}</td>
                <td>{r.kind === "Withdraw" ? "Withdrawal" : toHub ? "Payment to Noren’s hub" : fromHub ? (r.cents === 0n ? "Cover payout ($0)" : "Payout to a shop") : "Private transfer"}</td>
                <td className="mono">{toHub ? `${short(r.from)} → hub` : fromHub ? `hub → ${short(r.to)}` : `${short(r.from)} → ${short(r.to)}`}</td>
                <td className="r"><b>{cents(r.cents)}</b> <span className="sd-muted">tUSDC</span></td>
                <td><TxLink hash={r.tx} /></td>
              </tr>
            );
          })}</tbody>
        </table>
      )}
      {rows && !rows.length && <p className="sd-muted">No eERC transfers in the last {HOURS} hours.</p>}
    </section>
  );
}

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
          <AuditorLedger />
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
