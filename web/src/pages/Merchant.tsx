import { useState } from 'react';
import type { Abi, Address, Hex } from 'viem';
import {
  accountantOf,
  checkStatement,
  hasHub,
  norenMerchantsAbi,
  norenSettlementAbi,
  parseStatement,
  parseUsdToCents,
  readPayouts,
  readShops,
  scanLogs,
  statementDigest,
  withdrawEvent,
  type ReceivedPayment,
  type Shop,
} from '@noren-avax/sdk';
import { StarterPack } from '../ui/StarterPack';
import { Assistant } from '../ui/Assistant';
import { D, pub, readable, setName } from '../lib/chain';
import { ago, useLoad, useNow } from '../lib/hooks';
import { linkProps } from '../lib/router';
import { announceTx, isUnlocked, privateSession, unlock, useSignerVersion, useWho, write } from '../lib/signer';
import { Addr, Art, Money, Note, Skeleton, TxLink } from '../ui/kit';

/** One order line the shop can read: from a hub statement (paid out in a batch) or a direct payment (older checkouts). */
export type Line = { key: string; tx: Hex; time: number; cents: bigint | null; memo: string | null; from: Address | null; batch: number | null; error?: string };
/** One hub payout to this shop, with the shop's own checks of its statement. */
export type Payout = { tx: Hex; time: number; batch: number | null; cents: bigint | null; cover: boolean; lines: number; problems: string[]; onChain: boolean };
export type Book = { lines: Line[]; payouts: Payout[]; balance: bigint; withdrawn: { hash: string; cents: bigint; time: number }[] };
const VIA_HUB = hasHub(D);

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
      if (!who || !unlocked || !shop) return null;
      const p = privateSession();
      const [payments, bal, wlogs, recorded] = await Promise.all([
        p.received(who.address),
        p.balance(),
        scanLogs(pub as never, { address: D.encryptedERC, event: withdrawEvent, args: { user: who.address }, fromBlock: BigInt(D.deployBlock) }),
        VIA_HUB ? readPayouts(pub as never, D as never, shop.id) : Promise.resolve([]),
      ]);
      const times = await blockTimes([...payments.map((x) => x.block), ...wlogs.map((l) => l.blockNumber!)]);
      const lines: Line[] = [];
      const payouts: Payout[] = [];
      for (const x of payments) {
        const time = times.get(String(x.block)) ?? 0;
        const fromHub = VIA_HUB && x.from.toLowerCase() === D.hub!.toLowerCase();
        const st = fromHub && x.memo ? parseStatement(x.memo) : null;
        if (!st) {
          lines.push({ key: x.tx, tx: x.tx, time, cents: x.cents, memo: x.memo, from: x.from, batch: null, error: x.error });
          continue;
        }
        const rec = recorded.find((r) => r.payoutTx.toLowerCase() === x.tx.toLowerCase());
        const problems = checkStatement(st, x.cents);
        if (rec && rec.digest !== statementDigest(x.memo!)) problems.push('statement does not match the digest recorded on chain');
        payouts.push({ tx: x.tx, time, batch: st.batch, cents: x.cents, cover: st.cover, lines: st.items.length, problems, onChain: !!rec });
        for (const it of st.items) lines.push({ key: `${x.tx}-${it.tx}`, tx: x.tx, time, cents: BigInt(it.cents), memo: `${it.item} · order ${it.order}`, from: null, batch: st.batch });
      }
      return {
        lines: lines.sort((a, b) => b.time - a.time),
        payouts,
        balance: bal.cents,
        withdrawn: wlogs.map((l) => ({ hash: l.transactionHash!, cents: (l.args.amount as bigint) / 10_000n, time: times.get(String(l.blockNumber)) ?? 0 })),
      };
    },
    [who?.address, unlocked, ver, shop?.id],
  );
  const avax = useLoad(() => (who ? pub.getBalance({ address: who.address }) : Promise.resolve(null)), [who?.address, ver]);

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

  const revenue = book.data?.lines.reduce((s, x) => s + (x.cents ?? 0n), 0n) ?? 0n;
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
      {who && avax.data === 0n && <StarterPack address={who.address} />}
      {who && shops.loading && !shops.data && <Skeleton h={120} />}
      {who && shops.data && !shop && <OpenShop onDone={() => shops.reload()} sample={who.kind === 'guest' ? who.address : null} />}

      {who && shop && !unlocked && (
        <div className="lock-card">
          <Art name="ledger" size={112} />
          <div>
            <h2>Your revenue is encrypted on chain</h2>
            <p>{VIA_HUB ? `Snowtrace shows only that Noren’s hub paid ${shop.name}, never who the customers were or how much.` : `Snowtrace shows who paid ${shop.name}, never how much.`} Sign once to derive the shop’s key and decrypt it here, locally.</p>
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
              <b>{book.data ? book.data.lines.length : <Skeleton w={40} h={30} />}</b>
              <small>{book.data?.lines[0] ? `Last ${ago(book.data.lines[0].time, now)}` : 'None yet'}</small>
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
              {book.data && book.data.lines.length === 0 && (
                <Note art="empty" title="No payments yet">
                  Share <a {...linkProps(`/shop/${shop.slug}`)}>your checkout</a>; {VIA_HUB ? 'orders show up here once Noren’s hub pays out the next batch.' : 'private payments show up here as soon as they land on Fuji.'}
                </Note>
              )}
              {book.data && book.data.lines.length > 0 && (
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>When</th>
                        <th>From</th>
                        <th>Order</th>
                        <th className="r">Amount</th>
                        <th className="r">On Snowtrace</th>
                      </tr>
                    </thead>
                    <tbody>
                      {book.data.lines.map((x) => (
                        <tr key={x.key}>
                          <td>{ago(x.time, now)}</td>
                          <td>{x.from ? <Addr a={x.from} /> : <span className="faint">Batch #{x.batch}</span>}</td>
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
              {VIA_HUB && book.data && book.data.payouts.length > 0 && <Payouts payouts={book.data.payouts} now={now} />}
              {VIA_HUB && <Accountant shopId={shop.id} me={who.address} />}
              {book.data && <Assistant shop={shop} book={book.data} />}
              <section className="card snow">
                <div className="card-h">
                  <h2>What Snowtrace sees</h2>
                </div>
                <ul className="seen">
                  <li>
                    <span>Who paid you</span>
                    {VIA_HUB ? <b className="enc">Hidden</b> : <b>Visible</b>}
                  </li>
                  {VIA_HUB && (
                    <li>
                      <span>Noren’s hub paid you</span>
                      <b>Visible</b>
                    </li>
                  )}
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
                  {VIA_HUB ? (
                    <>Customers pay the hub; it pays shops in batches with other shops, some of them zero. Your accountant reads your statements in the <a {...linkProps('/auditor')}>books</a>.</>
                  ) : (
                    <>Your accountant reads the same payments with the <a {...linkProps('/auditor')}>auditor key</a>.</>
                  )}
                </p>
              </section>
            </aside>
          </div>
        </>
      )}
    </main>
  );
}

function OpenShop({ onDone, sample }: { onDone: () => void; sample: Address | null }) {
  // A test wallet gets a ready-to-open sample shop, so trying the merchant side needs no typing.
  const tag = sample ? sample.slice(2, 6).toLowerCase() : '';
  const [name, setNameV] = useState(sample ? `Test shop ${tag}` : '');
  const [slug, setSlug] = useState(sample ? `test-${sample.slice(2, 8).toLowerCase()}` : '');
  const [item, setItem] = useState(sample ? 'Sample print' : '');
  const [price, setPrice] = useState(sample ? '12.00' : '');
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
        <p>{VIA_HUB ? "Customers pay you privately in tUSDC or on credit, through Noren’s hub. Amounts stay encrypted; only you, the hub and the auditor read them." : "Customers pay you privately in tUSDC or on credit. Your revenue lands encrypted; only you and the auditor can read it."}</p>
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


function Payouts({ payouts, now }: { payouts: Payout[]; now: number }) {
  return (
    <section className="card">
      <div className="card-h">
        <h2>Payouts</h2>
        <span className="chip">{payouts.length}</span>
      </div>
      <ul className="seen">
        {payouts.slice(0, 6).map((p) => (
          <li key={p.tx}>
            <span>
              Batch #{p.batch} · {ago(p.time, now)}
              {p.cover ? ' · cover' : ` · ${p.lines} order${p.lines === 1 ? '' : 's'}`}
            </span>
            <b className={p.problems.length ? 'bad' : ''} title={p.problems.join('; ') || 'Statement adds up to the decrypted payout and matches the digest on chain'}>
              {p.cents != null ? <Money usd={Number(p.cents) / 100} /> : '—'} {p.problems.length ? '✗' : p.onChain ? '✓' : ''}
            </b>
          </li>
        ))}
      </ul>
      <p className="muted">✓ means the statement adds up to what your key decrypts and matches the digest in NorenSettlement.</p>
    </section>
  );
}

function Accountant({ shopId, me }: { shopId: number; me: Address }) {
  const ver = useSignerVersion();
  const cur = useLoad(() => accountantOf(pub as never, D as never, shopId), [shopId, ver]);
  const [addr, setAddr] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const none = cur.data === '0x0000000000000000000000000000000000000000';
  async function save(a: string) {
    setBusy(true);
    setErr(null);
    try {
      if (!/^0x[0-9a-fA-F]{40}$/.test(a)) throw Error('Enter the accountant’s address (0x…).');
      await write(D.norenSettlement!, norenSettlementAbi as Abi, 'setAccountant', [BigInt(shopId), a], 'name the shop accountant');
      setAddr('');
      cur.reload();
    } catch (e) {
      setErr(readable(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="card">
      <div className="card-h">
        <h2>Accountant</h2>
      </div>
      <p className="muted">{cur.data == null ? 'Reading NorenSettlement…' : none ? 'Each payout’s statement can be encrypted to your accountant’s key too.' : <>Statements go to <Addr a={cur.data} /> as well.</>}</p>
      <label className="field">
        <span>Accountant address (needs a Noren key)</span>
        <input value={addr} onChange={(e) => setAddr(e.target.value.trim())} placeholder="0x…" spellCheck={false} />
      </label>
      <div className="btn-row">
        <button className="btn btn-dark" disabled={busy || !addr} onClick={() => save(addr)}>
          {busy ? 'Saving on Fuji…' : 'Save'}
        </button>
        <button className="btn btn-quiet" disabled={busy || cur.data?.toLowerCase() === me.toLowerCase()} onClick={() => save(me)}>
          Use this wallet
        </button>
      </div>
      {err && <p className="err">{err}</p>}
    </section>
  );
}
