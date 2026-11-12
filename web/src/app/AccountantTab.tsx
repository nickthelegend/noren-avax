import { useState } from 'react';
import type { Abi, Address, Hex } from 'viem';
import { accountantOf, hasHub, norenSettlementAbi, parseStatement, readPayouts, readShops, statementDigest, type Shop } from '@noren-avax/sdk';
import { D, pub, readable, setName } from '../lib/chain';
import { ago, useLoad, useNow } from '../lib/hooks';
import { isUnlocked, privateSession, unlock, useSignerVersion, useWho, write } from '../lib/signer';
import { AddrLink, Card, Empty, Pill, Row, TxRef, cents, usd } from './common';
import { HubCard } from './MerchantTab';
import type { Market } from './market';

const VIA_HUB = hasHub(D);
type Stmt = { shop: string; batch: number; at: number; payoutTx: Hex; orders: number; total: bigint; cover: boolean; ok: boolean; why: string };
type Batch = { batch: number; at: string; record: Hex; payments: Hex[]; payouts: { shop: number; tx: Hex; accountant: boolean }[] };
export const BATCHES: Batch[] = ((D as unknown as { hubBatches?: Batch[] }).hubBatches ?? []).slice().reverse();
const ZERO = '0x0000000000000000000000000000000000000000';

export function AccountantTab({ market }: { market: Market }) {
  const who = useWho();
  const ver = useSignerVersion();
  const now = useNow();
  const shops = useLoad(() => readShops(pub as never, D), [ver]);
  shops.data?.forEach((s) => setName(s.owner, s.name));
  const mine = who ? (shops.data ?? []).filter((s) => s.owner.toLowerCase() === who.address.toLowerCase()) : [];
  // Shops that named this wallet as their accountant in NorenSettlement.
  const books = useLoad<Shop[] | null>(
    async () => {
      if (!who || !VIA_HUB) return [];
      if (!shops.data) return null; // still reading the shops
      const list = await Promise.all(shops.data.map(async (s) => ((await accountantOf(pub as never, D as never, s.id)).toLowerCase() === who.address.toLowerCase() ? s : null)));
      return list.filter((x): x is Shop => !!x);
    },
    [who?.address, shops.data?.length, ver],
  );
  const unlocked = isUnlocked();
  const isAccountant = (books.data?.length ?? 0) > 0;
  const statements = useLoad<Stmt[] | null>(
    async () => {
      if (!isAccountant || !unlocked || !who) return null;
      const p = privateSession();
      const out: Stmt[] = [];
      for (const shop of books.data!) {
        for (const r of await readPayouts(pub as never, D as never, shop.id)) {
          if (r.accountant.toLowerCase() !== who.address.toLowerCase() || r.forAccountant === '0x') continue;
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
      return out.sort((a, b) => b.at - a.at);
    },
    [isAccountant, unlocked, ver, books.data?.length],
  );
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const total = statements.data?.reduce((a, s) => a + s.total, 0n) ?? 0n;
  const passed = statements.data?.filter((s) => s.ok).length ?? 0;

  return (
    <>
      <div className="nk-home-main">
        {isAccountant ? (
          <section className="nk-hero nc-hero" aria-live="polite">
            <small>Statements · {books.data!.map((b) => b.name).join(', ')}</small>
            <b>
              {unlocked ? (
                <>
                  <i>$</i>
                  {statements.data ? (Number(total) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '…'}
                </>
              ) : (
                'Encrypted'
              )}
            </b>
            <p>{unlocked ? 'Paid out to the shops that named you, read from statements encrypted to your key. Each statement’s hash is on chain.' : `Each payout to ${books.data!.map((b) => b.name).join(', ')} carries a statement encrypted to your key. Sign once to read them here.`}</p>
            {unlocked ? (
              <div className="nc-tiles">
                <span>
                  <em>Statements</em>
                  {statements.data ? statements.data.length : '—'}
                </span>
                <span>
                  <em>Shops</em>
                  {books.data!.length}
                </span>
                <span>
                  <em>Checks passed</em>
                  {statements.data ? `${passed} / ${statements.data.length}` : '—'}
                </span>
                <span>
                  <em>Last</em>
                  {statements.data?.[0] ? ago(statements.data[0].at, now) : '—'}
                </span>
              </div>
            ) : (
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
                {busy ? 'Waiting for your signature…' : 'Read my statements'}
              </button>
            )}
            {err && <p className="nk-err">{err}</p>}
          </section>
        ) : (
          <Card title="Books your accountant can read" art="receipt" sub="A shop names an accountant in NorenSettlement. Every payout then carries a statement encrypted to that key, with its hash on chain." pill={<Pill>Accountant</Pill>}>
            {!who ? (
              <Empty art="shield" title="Connect the accountant’s or the shop’s wallet" action={<button className="nk-btn na-kaki" onClick={market.connect}>Connect a wallet</button>}>
                The accountant reads statements here; the shop owner names the accountant here.
              </Empty>
            ) : shops.error && !shops.data ? (
              <Empty art="warning" title="Couldn’t read NorenMerchants">{shops.error}</Empty>
            ) : !books.data ? (
              <Empty art="hourglass" title="Reading NorenSettlement…" />
            ) : mine.length === 0 ? (
              <Empty title="No shop has named this wallet">
                Ask the shop to name {who.label} as its accountant in its Accountant tab. Statements sent before that stay with the shop.
              </Empty>
            ) : null}
          </Card>
        )}

        {isAccountant && unlocked && (
          <Card title="Statements for you" sub="Decrypted with your key; ✓ = adds up and matches the digest on chain" pill={<Pill tone={statements.error ? 'bad' : 'live'}>{statements.loading ? 'Reading Fuji…' : 'Decrypted'}</Pill>}>
            {statements.error && <div className="nk-pad"><p className="nk-err">{statements.error}</p></div>}
            {statements.data && statements.data.length === 0 && <Empty title="No statements yet">Each batch that pays these shops sends you a copy, encrypted to your key.</Empty>}
            {statements.data && statements.data.length > 0 && (
              <ul className="nk-acts nc-acts na-wrap">
                {statements.data.slice(0, 14).map((x) => (
                  <Row
                    key={x.payoutTx}
                    state={x.ok ? 'success' : 'rejected'}
                    title={`${x.shop} · batch #${x.batch}`}
                    sub={`${x.cover ? 'cover payout' : `${x.orders} order${x.orders === 1 ? '' : 's'}`} · ${ago(x.at, now)} · ${x.why}`}
                    right={
                      <span className="r">
                        <b>{usd(cents(x.total))}</b>
                        <TxRef hash={x.payoutTx} />
                      </span>
                    }
                  />
                ))}
              </ul>
            )}
          </Card>
        )}

        {mine.map((s) => (
          <NameAccountant key={s.id} shop={s} me={who!.address} />
        ))}
      </div>
      <aside className="nk-home-side">
        <RecordedBatches shops={shops.data} />
        <HubCard />
      </aside>
    </>
  );
}

function NameAccountant({ shop, me }: { shop: Shop; me: Address }) {
  const ver = useSignerVersion();
  const cur = useLoad(() => accountantOf(pub as never, D as never, shop.id), [shop.id, ver]);
  const [addr, setAddr] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const none = cur.data === ZERO;
  async function save(a: string) {
    setBusy(true);
    setErr(null);
    try {
      if (!/^0x[0-9a-fA-F]{40}$/.test(a)) throw Error('Enter the accountant’s address (0x…).');
      await write(D.norenSettlement!, norenSettlementAbi as Abi, 'setAccountant', [BigInt(shop.id), a], 'name the shop accountant');
      setAddr('');
      cur.reload();
    } catch (e) {
      setErr(readable(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card title={`${shop.name}’s accountant`} art="medal" sub={cur.data == null ? 'Reading NorenSettlement…' : none ? 'Not named yet. Each payout’s statement can be encrypted to your accountant’s key too.' : <>Statements also go to <AddrLink a={cur.data} />.</>} pill={<Pill tone={none ? undefined : 'live'}>{none ? 'None' : 'Named'}</Pill>}>
      <div className="nk-pad">
        <div className="nk-box">
          <label htmlFor={`na-acc-${shop.id}`}>
            <span>Accountant address</span>
            <span className="mono">needs a Noren key</span>
          </label>
          <input id={`na-acc-${shop.id}`} className="nc-addr" value={addr} onChange={(e) => setAddr(e.target.value.trim())} placeholder="0x…" spellCheck={false} disabled={busy} />
        </div>
        <button className="nk-cta" disabled={busy || !addr} onClick={() => save(addr)}>
          {busy ? 'Saving on Fuji…' : 'Name this accountant'}
        </button>
        <button className="nk-btn na-wide" disabled={busy || cur.data?.toLowerCase() === me.toLowerCase()} onClick={() => save(me)}>
          Use this wallet
        </button>
        {err && <p className="nk-err">{err}</p>}
      </div>
    </Card>
  );
}

/** Hub batches recorded by the judge run (deployments/fuji.json), each opening its record on Snowtrace. */
export function RecordedBatches({ shops }: { shops?: Shop[] }) {
  if (!BATCHES.length) return null;
  const name = (id: number) => shops?.[id]?.name ?? `shop #${id}`;
  return (
    <Card title="Recorded batches" sub="Settled on Avalanche Fuji by Noren’s hub" pill={<Pill>{BATCHES.length}</Pill>}>
      <ul className="nk-acts nc-acts">
        {BATCHES.map((b) => (
          <Row
            key={b.record}
            title={`Batch #${b.batch}: ${b.payments.length} in, ${b.payouts.length} payouts`}
            sub={`${b.payouts.map((p) => name(p.shop)).join(', ')} · ${b.payouts.filter((p) => p.accountant).length} statement${b.payouts.filter((p) => p.accountant).length === 1 ? '' : 's'} for an accountant`}
            right={<TxRef hash={b.record} />}
          />
        ))}
      </ul>
    </Card>
  );
}
