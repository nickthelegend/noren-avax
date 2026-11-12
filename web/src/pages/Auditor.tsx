import { useState } from 'react';
import { encryptedErcAbi, privateTransferEvent, readShops, scanLogs, type AuditEntry } from '@noren-avax/sdk';
import type { Address } from 'viem';
import { D, pub, readable, setName } from '../lib/chain';
import { ago, useLoad, useNow } from '../lib/hooks';
import { isUnlocked, privateSession, unlock, useSignerVersion, useWho } from '../lib/signer';
import { Addr, Art, Money, Note, Skeleton, TxLink } from '../ui/kit';

export function Auditor() {
  const who = useWho();
  const ver = useSignerVersion();
  const now = useNow();
  const meta = useLoad(async () => {
    const [auditor, shops, transfers] = await Promise.all([
      pub.readContract({ address: D.encryptedERC, abi: encryptedErcAbi, functionName: 'auditor' }) as Promise<Address>,
      readShops(pub as never, D),
      scanLogs(pub as never, { address: D.encryptedERC, event: privateTransferEvent, fromBlock: BigInt(D.deployBlock) }),
    ]);
    shops.forEach((s) => setName(s.owner, s.name));
    return { auditor, shops, transfers: transfers.length };
  }, []);
  const isAuditor = !!who && !!meta.data && who.address.toLowerCase() === meta.data.auditor.toLowerCase();
  const unlocked = isUnlocked();
  const audit = useLoad<(AuditEntry & { time: number })[] | null>(
    async () => {
      if (!isAuditor || !unlocked) return null;
      const rows = await privateSession().audit();
      const blocks = [...new Set(rows.map((r) => String(r.block)))];
      const t = new Map<string, number>();
      await Promise.all(blocks.map(async (b) => t.set(b, Number((await pub.getBlock({ blockNumber: BigInt(b) })).timestamp))));
      return rows.map((r) => ({ ...r, time: t.get(String(r.block)) ?? 0 }));
    },
    [isAuditor, unlocked, ver],
  );
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const byShop = new Map<string, bigint>();
  for (const r of audit.data ?? []) if (r.kind === 'Transfer' && r.to && r.cents != null) byShop.set(r.to, (byShop.get(r.to) ?? 0n) + r.cents);

  return (
    <main className="wrap dash">
      <div className="dash-head">
        <div>
          <h1>Auditor</h1>
          <p className="sub">Every private payment carries a second ciphertext for the auditor key set on the eERC contract. Only that key opens it.</p>
        </div>
      </div>
      {meta.error && <Note tone="bad" art="warning" title="Couldn't read the eERC contract">{meta.error}</Note>}
      <div className="kpis kpis-3">
        <div className="kpi kpi-dark">
          <span>Auditor key</span>
          <b className="kpi-addr">{meta.data ? <Addr a={meta.data.auditor} /> : <Skeleton w={140} />}</b>
          <small>Set by the eERC owner on Fuji</small>
        </div>
        <div className="kpi">
          <span>Encrypted payments</span>
          <b>{meta.data ? meta.data.transfers : <Skeleton w={40} h={30} />}</b>
          <small>PrivateTransfer events since deploy</small>
        </div>
        <div className="kpi">
          <span>Shops</span>
          <b>{meta.data ? meta.data.shops.length : <Skeleton w={40} h={30} />}</b>
          <small>On NorenMerchants</small>
        </div>
      </div>

      {!who && <Note art="ledger" title="Connect the auditor’s wallet">The ledger below decrypts in this tab with the auditor key; nothing is sent anywhere.</Note>}
      {who && meta.data && !isAuditor && (
        <Note art="ledger" title="This wallet isn’t the auditor">
          The auditor ciphertexts are encrypted to <Addr a={meta.data.auditor} />. Any other key gets noise, which is the point.
        </Note>
      )}
      {isAuditor && !unlocked && (
        <div className="lock-card">
          <Art name="ledger" size={112} />
          <div>
            <h2>Open the books</h2>
            <p>Sign once to derive the auditor key. The ledger is decrypted from Fuji logs in this tab.</p>
            <button
              className="btn btn-dark"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setErr(null);
                try {
                  await unlock();
                } catch (e) {
                  setErr(readable(e));
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? 'Waiting for your signature…' : 'Decrypt the ledger'}
            </button>
            {err && <p className="err">{err}</p>}
          </div>
        </div>
      )}
      {isAuditor && unlocked && (
        <div className="dash-grid">
          <section className="card">
            <div className="card-h">
              <h2>Ledger</h2>
              <span className="chip">{audit.loading ? 'Reading Fuji…' : 'Decrypted'}</span>
            </div>
            {audit.error && <Note tone="bad" title="Couldn't decrypt">{audit.error}</Note>}
            {audit.data && audit.data.length === 0 && <Note art="empty" title="Nothing to audit yet">No eERC activity since the deploy block.</Note>}
            {audit.data && audit.data.length > 0 && (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>When</th>
                      <th>Kind</th>
                      <th>From</th>
                      <th>To</th>
                      <th className="r">Amount</th>
                      <th className="r">Tx</th>
                    </tr>
                  </thead>
                  <tbody>
                    {audit.data.map((r) => (
                      <tr key={`${r.tx}-${r.kind}`}>
                        <td>{ago(r.time, now)}</td>
                        <td>
                          <span className={`kind kind-${r.kind.toLowerCase()}`}>{r.kind === 'Transfer' ? 'Payment' : r.kind === 'Deposit' ? 'Top-up' : 'Withdrawal'}</span>
                        </td>
                        <td>
                          <Addr a={r.from} />
                        </td>
                        <td>{r.to ? <Addr a={r.to} /> : <span className="faint">—</span>}</td>
                        <td className="r num">{r.cents != null ? <Money usd={Number(r.cents) / 100} /> : <span className="bad">{r.error}</span>}</td>
                        <td className="r">
                          <TxLink hash={r.tx} label="tx" />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="muted small">Payments and withdrawals are decrypted from their auditor ciphertexts; top-ups are public ERC-20 deposits.</p>
          </section>
          <aside className="side">
            <section className="card">
              <div className="card-h">
                <h2>Revenue by shop</h2>
              </div>
              {byShop.size === 0 ? (
                <p className="muted">No payments decrypted yet.</p>
              ) : (
                <ul className="seen">
                  {[...byShop.entries()].map(([a, c]) => (
                    <li key={a}>
                      <span>
                        <Addr a={a} />
                      </span>
                      <b>
                        <Money usd={Number(c) / 100} />
                      </b>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </aside>
        </div>
      )}
    </main>
  );
}
