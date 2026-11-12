import { useState } from 'react';
import {
  accountantOf,
  auditBatch,
  encryptedErcAbi,
  hasHub,
  parseStatement,
  privateTransferEvent,
  readBatches,
  readPayouts,
  readShops,
  scanLogs,
  statementDigest,
  type AuditEntry,
  type AuditorStatement,
  type Shop,
} from '@noren-avax/sdk';
import type { Address, Hex } from 'viem';
import { D, pub, readable, setName } from '../lib/chain';
import { ago, useLoad, useNow } from '../lib/hooks';
import { isUnlocked, privateSession, unlock, useSignerVersion, useWho } from '../lib/signer';
import { Addr, Art, Money, Note, Skeleton, TxLink } from '../ui/kit';

const VIA_HUB = hasHub(D);
type BatchCheck = { batchId: number; at: number; tx: Hex; payments: number; paidIn: bigint; paidOut: bigint; shops: number; cover: number; problems: string[] };
type Stmt = { shop: string; batch: number; at: number; payoutTx: Hex; orders: number; total: bigint; cover: boolean; ok: boolean; why: string };

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
  // Shops that named this wallet as their accountant in NorenSettlement.
  const books = useLoad<Shop[]>(
    async () => {
      if (!who || !meta.data || !VIA_HUB) return [];
      const mine = await Promise.all(meta.data.shops.map(async (s) => ((await accountantOf(pub as never, D as never, s.id)).toLowerCase() === who.address.toLowerCase() ? s : null)));
      return mine.filter((x): x is Shop => !!x);
    },
    [who?.address, meta.data?.shops.length],
  );
  const isAccountant = (books.data?.length ?? 0) > 0;
  const statements = useLoad<Stmt[] | null>(
    async () => {
      if (!isAccountant || !unlocked) return null;
      const p = privateSession();
      const out: Stmt[] = [];
      for (const shop of books.data!) {
        for (const r of await readPayouts(pub as never, D as never, shop.id)) {
          if (r.accountant.toLowerCase() !== who!.address.toLowerCase() || r.forAccountant === '0x') continue;
          const at = Number((await pub.getBlock({ blockNumber: r.block })).timestamp);
          try {
            const text = p.readNote(r.forAccountant);
            const st = parseStatement(text);
            const digestOk = statementDigest(text) === r.digest;
            const sumOk = !!st && st.items.reduce((a, it) => a + BigInt(it.cents), 0n) === BigInt(st.total);
            out.push({ shop: shop.name, batch: r.batchId, at, payoutTx: r.payoutTx, orders: st?.items.length ?? 0, total: BigInt(st?.total ?? 0), cover: !!st?.cover, ok: digestOk && sumOk, why: !digestOk ? 'digest differs from the chain' : !sumOk ? 'lines do not add up' : 'matches the digest on chain' });
          } catch (e) {
            out.push({ shop: shop.name, batch: r.batchId, at, payoutTx: r.payoutTx, orders: 0, total: 0n, cover: false, ok: false, why: `cannot decrypt: ${(e as Error).message}` });
          }
        }
      }
      return out;
    },
    [isAccountant, unlocked, ver, books.data?.length],
  );
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
  const batches = useLoad<BatchCheck[] | null>(
    async () => {
      if (!isAuditor || !unlocked || !VIA_HUB || !audit.data) return null;
      const p = privateSession();
      const [bs, payouts] = await Promise.all([readBatches(pub as never, D as never), readPayouts(pub as never, D as never)]);
      const amount = new Map(audit.data.filter((r) => r.kind === 'Transfer').map((r) => [r.tx.toLowerCase(), r.cents]));
      return bs.map((b) => {
        let aud: AuditorStatement | null = null;
        try {
          aud = JSON.parse(p.readNote(b.forAuditor)) as AuditorStatement;
        } catch {
          aud = null;
        }
        if (!aud) return { batchId: b.batchId, at: b.at, tx: b.tx, payments: b.payments.length, paidIn: 0n, paidOut: 0n, shops: b.payoutTxs.length, cover: 0, problems: ['auditor copy does not decrypt with this key'] };
        const r = auditBatch(b, aud, payouts.filter((x) => x.batchId === b.batchId), (tx) => amount.get(tx.toLowerCase()) ?? null);
        return { batchId: b.batchId, at: b.at, tx: b.tx, payments: b.payments.length, ...r };
      });
    },
    [isAuditor, unlocked, audit.data],
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

      {!who && <Note art="ledger" title={VIA_HUB ? 'Connect the auditor’s or an accountant’s wallet' : 'Connect the auditor’s wallet'}>The ledger below decrypts in this tab with the auditor key; nothing is sent anywhere.</Note>}
      {who && meta.data && !isAuditor && books.data && !isAccountant && (
        <Note art="ledger" title="This wallet isn’t the auditor">
          The auditor ciphertexts are encrypted to <Addr a={meta.data.auditor} />. Any other key gets noise, which is the point.
          {VIA_HUB && <> A shop can name any Noren key as its accountant in Merchant; that key reads the shop’s statements here.</>}
        </Note>
      )}
      {(isAuditor || isAccountant) && !unlocked && (
        <div className="lock-card">
          <Art name="ledger" size={112} />
          <div>
            <h2>Open the books</h2>
            <p>{isAuditor ? 'Sign once to derive the auditor key. The ledger is decrypted from Fuji logs in this tab.' : `Sign once to derive your key and read the statements ${books.data!.map((b) => b.name).join(', ')} sent you.`}</p>
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
              {busy ? 'Waiting for your signature…' : isAuditor ? 'Decrypt the ledger' : 'Read my statements'}
            </button>
            {err && <p className="err">{err}</p>}
          </div>
        </div>
      )}
      {isAccountant && unlocked && (
        <section className="card">
          <div className="card-h">
            <h2>Statements for you</h2>
            <span className="chip">{statements.loading ? 'Reading Fuji…' : 'Decrypted'}</span>
          </div>
          {statements.error && <Note tone="bad" title="Couldn't read the statements">{statements.error}</Note>}
          {statements.data && statements.data.length === 0 && (
            <Note art="empty" title="No statements yet">Each settlement batch that pays {books.data!.map((b) => b.name).join(', ')} sends you a copy, encrypted to your key.</Note>
          )}
          {statements.data && statements.data.length > 0 && (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Shop</th>
                    <th>Batch</th>
                    <th>Orders</th>
                    <th className="r">Paid out</th>
                    <th className="r">Check</th>
                  </tr>
                </thead>
                <tbody>
                  {statements.data.map((x) => (
                    <tr key={x.payoutTx}>
                      <td>{ago(x.at, now)}</td>
                      <td>{x.shop}</td>
                      <td>
                        #{x.batch} <TxLink hash={x.payoutTx} label="payout" />
                      </td>
                      <td>{x.cover ? <span className="faint">cover</span> : x.orders}</td>
                      <td className="r num">
                        <Money usd={Number(x.total) / 100} />
                      </td>
                      <td className="r" title={x.why}>
                        {x.ok ? <span className="chip chip-ok">✓ on chain</span> : <span className="chip chip-bad">✗</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="muted small">The hub encrypts each statement to your key and commits its hash on chain; the shop and the auditor can check the amounts against the eERC ciphertexts.</p>
        </section>
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
            {VIA_HUB && (
              <section className="card">
                <div className="card-h">
                  <h2>Settlement batches</h2>
                  <span className="chip">{batches.data ? batches.data.length : '…'}</span>
                </div>
                {batches.error && <p className="err">{batches.error}</p>}
                {batches.data && batches.data.length === 0 && <p className="muted">No batches yet.</p>}
                {batches.data && batches.data.length > 0 && (
                  <ul className="seen">
                    {batches.data.slice(0, 8).map((b) => (
                      <li key={b.batchId} title={b.problems.join('; ') || 'Every payment once, each payout matches its statement, paid in = paid out'}>
                        <span>
                          #{b.batchId} · {b.payments} in · {b.shops} shops ({b.cover} cover)
                        </span>
                        <b className={b.problems.length ? 'bad' : ''}>
                          <Money usd={Number(b.paidOut) / 100} /> {b.problems.length ? '✗' : '✓'}
                        </b>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="muted">✓: every payment appears once, each payout equals its statement, and what came in went out.</p>
              </section>
            )}
            <section className="card">
              <div className="card-h">
                <h2>{VIA_HUB ? 'Received by address' : 'Revenue by shop'}</h2>
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
