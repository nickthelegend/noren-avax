import { useState } from 'react';
import type { Abi } from 'viem';
import { norenMerchantsAbi, parseUsdToCents, readShops, scanLogs, withdrawEvent, type ReceivedPayment, type Shop } from '@noren-avax/sdk';
import { D, pub, readable, setName } from '../lib/chain';
import { ago, useLoad, useNow } from '../lib/hooks';
import { linkProps } from '../lib/router';
import { announceTx, isUnlocked, privateSession, unlock, useSignerVersion, useWho, write } from '../lib/signer';
import { Addr, Art, Money, Note, Skeleton, TxLink } from '../ui/kit';

type Book = { payments: (ReceivedPayment & { time: number })[]; balance: bigint; withdrawn: { hash: string; cents: bigint; time: number }[] };

async function blockTimes(blocks: bigint[]) {
  const uniq = [...new Set(blocks.map(String))].map(BigInt);
  const m = new Map<string, number>();
  await Promise.all(uniq.map(async (b) => m.set(String(b), Number((await pub.getBlock({ blockNumber: b })).timestamp))));
  return m;
}

export function Merchant() {
  const who = useWho();
  const ver = useSignerVersion();
  const now = useNow();
  const shops = useLoad(() => readShops(pub as never, D), [ver]);
  const mine: Shop[] = who ? (shops.data ?? []).filter((s) => s.owner.toLowerCase() === who.address.toLowerCase()) : [];
  mine.forEach((s) => setName(s.owner, s.name));
  const shop = mine[0];
  const unlocked = isUnlocked();

  const book = useLoad<Book | null>(
    async () => {
      if (!who || !unlocked) return null;
      const p = privateSession();
      const [payments, bal, wlogs] = await Promise.all([
        p.received(who.address),
        p.balance(),
        scanLogs(pub as never, { address: D.encryptedERC, event: withdrawEvent, args: { user: who.address }, fromBlock: BigInt(D.deployBlock) }),
      ]);
      const times = await blockTimes([...payments.map((x) => x.block), ...wlogs.map((l) => l.blockNumber!)]);
      return {
        payments: payments.map((x) => ({ ...x, time: times.get(String(x.block)) ?? 0 })),
        balance: bal.cents,
        withdrawn: wlogs.map((l) => ({ hash: l.transactionHash!, cents: (l.args.amount as bigint) / 10_000n, time: times.get(String(l.blockNumber)) ?? 0 })),
      };
    },
    [who?.address, unlocked, ver],
  );

  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [lastTx, setLastTx] = useState<string | null>(null);

  async function act(label: string, fn: () => Promise<unknown>) {
    setBusy(label);
    setErr(null);
    try {
      await fn();
    } catch (e) {
      setErr(readable(e));
    } finally {
      setBusy(null);
    }
  }

  const revenue = book.data?.payments.reduce((s, x) => s + (x.cents ?? 0n), 0n) ?? 0n;
  const out = book.data?.withdrawn.reduce((s, x) => s + x.cents, 0n) ?? 0n;

  return (
    <main className="wrap dash">
      <div className="dash-head">
        <div>
          <h1>{shop ? shop.name : 'Noren Merchant'}</h1>
          <p className="sub">{shop ? <>Private revenue on Avalanche Fuji · shop link <a {...linkProps(`/shop/${shop.slug}`)}>/shop/{shop.slug}</a></> : 'Take private payments in tUSDC, or on credit, from any customer.'}</p>
        </div>
        {shop && unlocked && (
          <div className="dash-acts">
            <a className="btn btn-dark" {...linkProps(`/shop/${shop.slug}`)}>
              Open checkout
            </a>
          </div>
        )}
      </div>

      {!who && <Note art="stall" title="Connect the shop’s wallet">The dashboard decrypts revenue with the shop owner’s eERC key, in this tab only.</Note>}
      {who && shops.loading && !shops.data && <Skeleton h={120} />}
      {who && shops.data && !shop && <OpenShop onDone={() => shops.reload()} />}

      {who && shop && !unlocked && (
        <div className="lock-card">
          <Art name="ledger" size={112} />
          <div>
            <h2>Your revenue is encrypted on chain</h2>
            <p>Snowtrace shows who paid {shop.name}, never how much. Sign once to derive the shop’s key and decrypt the payments here, locally.</p>
            <button className="btn btn-dark" disabled={!!busy} onClick={() => act('unlock', unlock)}>
              {busy ? 'Waiting for your signature…' : 'Decrypt revenue'}
            </button>
            {err && <p className="err">{err}</p>}
          </div>
        </div>
      )}

      {who && shop && unlocked && (
        <>
          <div className="kpis">
            <div className="kpi kpi-dark">
              <span>Private revenue</span>
              <b>{book.data ? <Money usd={Number(revenue) / 100} /> : <Skeleton w={140} h={36} />}</b>
              <small>Decrypted in this tab · tUSDC</small>
            </div>
            <div className="kpi">
              <span>Private balance</span>
              <b>{book.data ? <Money usd={Number(book.data.balance) / 100} /> : <Skeleton w={110} h={30} />}</b>
              <small>Ready to withdraw</small>
            </div>
            <div className="kpi">
              <span>Payments</span>
              <b>{book.data ? book.data.payments.length : <Skeleton w={40} h={30} />}</b>
              <small>{book.data?.payments[0] ? `Last ${ago(book.data.payments[0].time, now)}` : 'None yet'}</small>
            </div>
            <div className="kpi">
              <span>Withdrawn</span>
              <b>{book.data ? <Money usd={Number(out) / 100} /> : <Skeleton w={110} h={30} />}</b>
              <small>Public once withdrawn</small>
            </div>
          </div>

          <div className="dash-grid">
            <section className="card">
              <div className="card-h">
                <h2>Payments</h2>
                <span className="chip">{book.loading ? 'Reading Fuji…' : 'Live'}</span>
              </div>
              {book.error && <Note tone="bad" title="Couldn't decrypt payments">{book.error}</Note>}
              {book.data && book.data.payments.length === 0 && (
                <Note art="empty" title="No payments yet">
                  Share <a {...linkProps(`/shop/${shop.slug}`)}>your checkout</a>; private payments show up here as soon as they land on Fuji.
                </Note>
              )}
              {book.data && book.data.payments.length > 0 && (
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>When</th>
                        <th>Customer</th>
                        <th>Order</th>
                        <th className="r">Amount</th>
                        <th className="r">On Snowtrace</th>
                      </tr>
                    </thead>
                    <tbody>
                      {book.data.payments.map((x) => (
                        <tr key={x.tx}>
                          <td>{ago(x.time, now)}</td>
                          <td>
                            <Addr a={x.from} />
                          </td>
                          <td className="memo">{x.memo ?? <span className="faint">No note</span>}</td>
                          <td className="r num">{x.cents != null ? <Money usd={Number(x.cents) / 100} /> : <span className="bad">{x.error ?? 'unreadable'}</span>}</td>
                          <td className="r">
                            <span className="cipher" title="What everyone else sees: an encrypted amount">encrypted</span> <TxLink hash={x.tx} label="tx" />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <aside className="side">
              <section className="card">
                <div className="card-h">
                  <h2>Withdraw</h2>
                </div>
                <p className="muted">Turns private tUSDC into public tUSDC in this wallet. A zero-knowledge proof shows the balance covers it.</p>
                <label className="field">
                  <span>Amount (tUSDC)</span>
                  <input inputMode="decimal" placeholder={book.data ? (Number(book.data.balance) / 100).toFixed(2) : '0.00'} value={amount} onChange={(e) => setAmount(e.target.value)} />
                </label>
                <button
                  className="btn btn-dark wide"
                  disabled={!!busy || !book.data || book.data.balance === 0n}
                  onClick={() =>
                    act('withdraw', async () => {
                      const cents = amount.trim() ? parseUsdToCents(amount) : book.data!.balance;
                      if (cents == null || cents <= 0n) throw Error('Enter an amount like 24.00');
                      const h = await privateSession().withdraw(cents, 'payout');
                      announceTx(h, 'withdraw private revenue');
                      setLastTx(h);
                      setAmount('');
                    })
                  }
                >
                  {busy === 'withdraw' ? 'Proving and withdrawing…' : amount.trim() ? `Withdraw ${amount}` : 'Withdraw all'}
                </button>
                {lastTx && (
                  <p className="ok-line">
                    Withdrawn · <TxLink hash={lastTx} />
                  </p>
                )}
                {err && <p className="err">{err}</p>}
              </section>
              <section className="card snow">
                <div className="card-h">
                  <h2>What Snowtrace sees</h2>
                </div>
                <ul className="seen">
                  <li>
                    <span>Who paid you</span>
                    <b>Visible</b>
                  </li>
                  <li>
                    <span>How much</span>
                    <b className="enc">Encrypted</b>
                  </li>
                  <li>
                    <span>Order note</span>
                    <b className="enc">Encrypted</b>
                  </li>
                  <li>
                    <span>Your balance</span>
                    <b className="enc">Encrypted</b>
                  </li>
                  <li>
                    <span>Withdrawals</span>
                    <b>Visible</b>
                  </li>
                </ul>
                <p className="muted">
                  Your accountant reads the same payments with the <a {...linkProps('/auditor')}>auditor key</a>.
                </p>
              </section>
            </aside>
          </div>
        </>
      )}
    </main>
  );
}

function OpenShop({ onDone }: { onDone: () => void }) {
  const [name, setNameV] = useState('');
  const [slug, setSlug] = useState('');
  const [item, setItem] = useState('');
  const [price, setPrice] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  async function open() {
    setErr(null);
    try {
      const cents = parseUsdToCents(price);
      if (!name.trim() || !/^[a-z0-9-]{3,32}$/.test(slug)) throw Error('Give the shop a name and a link of 3 to 32 lowercase letters, digits or dashes.');
      if (!item.trim() || cents == null || cents <= 0n) throw Error('List a first item with a price like 24.00.');
      const p = privateSession();
      setBusy('Unlocking your key…');
      await unlock();
      if (!(await p.isRegistered())) {
        setBusy('Registering for private payments (proof on this device)…');
        const h = await p.register();
        if (h) announceTx(h, 'register eERC key');
      }
      setBusy('Opening the shop…');
      await write(D.norenMerchants, norenMerchantsAbi as Abi, 'openShop', [name.trim(), slug], 'open shop');
      const shops = await readShops(pub as never, D);
      const s = shops.find((x) => x.slug === slug)!;
      setBusy('Listing the first item…');
      await write(D.norenMerchants, norenMerchantsAbi as Abi, 'listItem', [BigInt(s.id), item.trim(), cents], 'list item');
      onDone();
    } catch (e) {
      setErr(readable(e));
    } finally {
      setBusy(null);
    }
  }
  return (
    <div className="lock-card">
      <Art name="stall" size={120} />
      <div className="open-shop">
        <h2>Open your shop on Noren</h2>
        <p>Customers pay you privately in tUSDC or on credit. Your revenue lands encrypted; only you and the auditor can read it.</p>
        <div className="form-grid">
          <label className="field">
            <span>Shop name</span>
            <input value={name} onChange={(e) => setNameV(e.target.value)} placeholder="Harbor & Loom" maxLength={48} />
          </label>
          <label className="field">
            <span>Checkout link</span>
            <input value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase())} placeholder="harbor-loom" maxLength={32} />
          </label>
          <label className="field">
            <span>First item</span>
            <input value={item} onChange={(e) => setItem(e.target.value)} placeholder="Linen tote" maxLength={64} />
          </label>
          <label className="field">
            <span>Price (tUSDC)</span>
            <input value={price} inputMode="decimal" onChange={(e) => setPrice(e.target.value)} placeholder="24.00" />
          </label>
        </div>
        <button className="btn btn-dark" disabled={!!busy} onClick={open}>
          {busy ?? 'Open shop'}
        </button>
        {err && <p className="err">{err}</p>}
      </div>
    </div>
  );
}

