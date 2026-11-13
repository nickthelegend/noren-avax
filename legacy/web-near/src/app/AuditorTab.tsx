import { useState } from 'react';
import type { Address, Hex } from 'viem';
import { auditBatch, encryptedErcAbi, hasHub, privateTransferEvent, readBatches, readPayouts, readShops, scanLogs, type AuditEntry, type AuditorStatement } from '@noren-avax/sdk';
import { D, nameOf, pub, readable, setName } from '../lib/chain';
import { ago, useLoad, useNow } from '../lib/hooks';
import { isUnlocked, privateSession, unlock, useSignerVersion, useWho } from '../lib/signer';
import { AddrLink, Card, Empty, Pill, Row, TxRef, cents, short, usd } from './common';
import { RecordedBatches } from './AccountantTab';
import type { Market } from './market';

const VIA_HUB = hasHub(D);
type BatchCheck = { batchId: number; at: number; tx: Hex; payments: number; paidIn: bigint; paidOut: bigint; shops: number; cover: number; problems: string[] };

export function AuditorTab({ market }: { market: Market }) {
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
    setName(auditor, 'Auditor');
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
      return rows.map((r) => ({ ...r, time: t.get(String(r.block)) ?? 0 })).sort((a, b) => b.time - a.time);
    },
    [isAuditor, unlocked, ver],
  );
  const batches = useLoad<BatchCheck[] | null>(
    async () => {
      if (!isAuditor || !unlocked || !VIA_HUB || !audit.data) return null;
      const p = privateSession();
      const [bs, payouts] = await Promise.all([readBatches(pub as never, D as never), readPayouts(pub as never, D as never)]);
      const amount = new Map(audit.data.filter((r) => r.kind === 'Transfer').map((r) => [r.tx.toLowerCase(), r.cents]));
      return bs
        .map((b) => {
          let aud: AuditorStatement | null = null;
          try {
            aud = JSON.parse(p.readNote(b.forAuditor)) as AuditorStatement;
          } catch {
            aud = null;
          }
          if (!aud) return { batchId: b.batchId, at: b.at, tx: b.tx, payments: b.payments.length, paidIn: 0n, paidOut: 0n, shops: b.payoutTxs.length, cover: 0, problems: ['auditor copy does not decrypt with this key'] };
          const r = auditBatch(b, aud, payouts.filter((x) => x.batchId === b.batchId), (tx) => amount.get(tx.toLowerCase()) ?? null);
          return { batchId: b.batchId, at: b.at, tx: b.tx, payments: b.payments.length, ...r };
        })
        .sort((a, b) => b.batchId - a.batchId);
    },
    [isAuditor, unlocked, audit.data],
  );
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const byShop = new Map<string, bigint>();
  for (const r of audit.data ?? []) if (r.kind === 'Transfer' && r.to && r.cents != null) byShop.set(r.to, (byShop.get(r.to) ?? 0n) + r.cents);
  const checked = batches.data?.filter((b) => !b.problems.length).length ?? 0;

  return (
    <>
      <div className="nk-home-main">
        <section className="nk-hero nc-hero" aria-live="polite">
          <small>Auditor key · eERC on Avalanche Fuji</small>
          <b>{isAuditor && unlocked ? (audit.data ? audit.data.length : '…') : meta.data ? meta.data.transfers : meta.error ? '—' : '…'}</b>
          <p>
            {isAuditor && unlocked
              ? 'eERC movements decrypted in this tab with the auditor key: payments, top-ups and withdrawals.'
              : 'Encrypted payments on Fuji. Every one carries a second ciphertext for the auditor key set on the eERC contract; only that key opens it.'}
          </p>
          <div className="nc-tiles">
            <span>
              <em>Auditor</em>
              {meta.data ? short(meta.data.auditor) : '—'}
            </span>
            <span>
              <em>Payments</em>
              {meta.data ? meta.data.transfers : '—'}
            </span>
            <span>
              <em>Shops</em>
              {meta.data ? meta.data.shops.length : '—'}
            </span>
            <span>
              <em>Batches checked</em>
              {batches.data ? `${checked} / ${batches.data.length}` : '—'}
            </span>
          </div>
          {isAuditor && !unlocked && (
            <button
              className="nk-cta kaki na-hero-cta"
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
          )}
          {err && <p className="nk-err">{err}</p>}
        </section>
        {meta.error && <p className="nk-err">Couldn’t read the eERC contract: {meta.error}</p>}

        {!isAuditor && (
          <Card title="The auditor’s ledger" art="shield" sub="The ledger decrypts in this tab with the auditor key; nothing is sent anywhere." pill={<Pill>Auditor</Pill>}>
            {!who ? (
              <Empty art="shield" title="Connect the auditor’s wallet" action={<button className="nk-btn na-kaki" onClick={market.connect}>Connect a wallet</button>}>
                Shop accountants read their statements in the Accountant tab.
              </Empty>
            ) : meta.data ? (
              <Empty art="warning" title="This wallet isn’t the auditor">
                The auditor ciphertexts are encrypted to {nameOf(meta.data.auditor)} ({short(meta.data.auditor)}). Any other key gets noise.
              </Empty>
            ) : (
              <Empty art="hourglass" title="Reading the eERC contract…" />
            )}
          </Card>
        )}

        {isAuditor && unlocked && (
          <Card title="Ledger" sub="Payments and withdrawals from their auditor ciphertexts; top-ups are public deposits" pill={<Pill tone={audit.error ? 'bad' : 'live'}>{audit.loading ? 'Reading Fuji…' : 'Decrypted'}</Pill>}>
            {audit.error && <div className="nk-pad"><p className="nk-err">{audit.error}</p></div>}
            {audit.data && audit.data.length === 0 && <Empty title="Nothing to audit yet">No eERC activity since the deploy block.</Empty>}
            {audit.data && audit.data.length > 0 && (
              <ul className="nk-acts nc-acts na-wrap">
                {audit.data.slice(0, 16).map((r) => (
                  <Row
                    key={`${r.tx}-${r.kind}`}
                    kind={r.kind === 'Transfer' ? 'private-pay' : r.kind === 'Deposit' ? 'shield' : undefined}
                    state={r.cents != null || r.kind === 'Deposit' ? 'success' : 'rejected'}
                    title={r.kind === 'Transfer' ? `Payment: ${nameOf(r.from)} → ${r.to ? nameOf(r.to) : '—'}` : r.kind === 'Deposit' ? `Top-up by ${nameOf(r.from)}` : `Withdrawal by ${nameOf(r.from)}`}
                    sub={`${ago(r.time, now)}${r.error ? ` · ${r.error}` : ''}`}
                    right={
                      <span className="r">
                        <b>{r.cents != null ? usd(cents(r.cents)) : '—'}</b>
                        <TxRef hash={r.tx} />
                      </span>
                    }
                  />
                ))}
              </ul>
            )}
          </Card>
        )}
      </div>
      <aside className="nk-home-side">
        {isAuditor && unlocked && VIA_HUB ? (
          <Card title="Settlement batches" sub="✓ every payment once, each payout equals its statement, in = out" pill={<Pill>{batches.data ? batches.data.length : '…'}</Pill>}>
            {batches.error && <p className="nk-err">{batches.error}</p>}
            {batches.data && batches.data.length === 0 && <Empty title="No batches yet" />}
            {batches.data && batches.data.length > 0 && (
              <ul className="nk-acts nc-acts">
                {batches.data.slice(0, 8).map((b) => (
                  <Row
                    key={b.batchId}
                    state={b.problems.length ? 'rejected' : 'success'}
                    title={`#${b.batchId} · ${usd(cents(b.paidOut))} out`}
                    sub={b.problems.length ? b.problems.join('; ') : `${b.payments} in · ${b.shops} shops (${b.cover} cover) · ${ago(b.at, now)}`}
                    right={<TxRef hash={b.tx} />}
                  />
                ))}
              </ul>
            )}
          </Card>
        ) : (
          <RecordedBatches shops={meta.data?.shops} />
        )}
        {isAuditor && unlocked && (
          <Card title={VIA_HUB ? 'Received by address' : 'Revenue by shop'} sub="Decrypted payment totals">
            {byShop.size === 0 ? (
              <Empty title="No payments decrypted yet" />
            ) : (
              <ul className="nk-acts nc-acts">
                {[...byShop.entries()].map(([a, c]) => (
                  <Row key={a} title={nameOf(a)} sub={<AddrLink a={a} className="mono" />} right={<span className="r"><b>{usd(cents(c))}</b></span>} />
                ))}
              </ul>
            )}
          </Card>
        )}
        <Card title="Who can read what" art="medal" sub="Same payment, four views">
          <ul className="nk-acts nc-acts">
            <Row kind="shield" title="Customer" sub="Their own payments" right={<span className="nk-pill live">All</span>} />
            <Row kind="shield" title="Shop" sub="Its orders and payouts" right={<span className="nk-pill live">Own</span>} />
            <Row kind="shield" title="Accountant" sub="Statements a shop sends" right={<span className="nk-pill live">Named</span>} />
            <Row kind="shield" title="Auditor" sub="Every amount, this tab" right={<span className="nk-pill live">All</span>} />
            <Row state="skip" title="Snowtrace" sub="Addresses, top-ups, withdrawals" right={<span className="nk-pill">No payments</span>} />
          </ul>
        </Card>
      </aside>
    </>
  );
}
