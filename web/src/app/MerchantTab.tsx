import { useState, type ReactNode } from 'react';
import type { Abi, Address, Hex } from 'viem';
import {
  checkStatement,
  hasHub,
  norenMerchantsAbi,
  parseStatement,
  parseUsdToCents,
  readPayouts,
  readShops,
  scanLogs,
  statementDigest,
  withdrawEvent,
  type Shop,
} from '@noren-avax/sdk';
import { api, type HubStatus } from '../lib/api';
import { D, pub, readable, setName } from '../lib/chain';
import { ago, useLoad, useNow } from '../lib/hooks';
import { linkProps } from '../lib/router';
import { announceTx, isUnlocked, privateSession, unlock, useSignerVersion, useWho, write } from '../lib/signer';
import { Icon } from '../ui/nk/brand';
import { Art3d } from '../ui/nk/Art3d';
import { Mark } from '../ui/nk/marks';
import { AddrLink, Card, Empty, Pill, Row, TxBtn, TxRef, cents, usd } from './common';
import { StarterCard } from './CreditSheet';
import { Assistant } from './Assistant';
import type { Market } from './market';

/** One order line the shop can read: from a hub statement (paid out in a batch) or a direct payment (older checkouts). */
export type Line = { key: string; tx: Hex; time: number; cents: bigint | null; memo: string | null; from: Address | null; batch: number | null; error?: string };
/** One hub payout to this shop, with the shop's own checks of its statement. */
export type Payout = { tx: Hex; time: number; batch: number | null; cents: bigint | null; cover: boolean; lines: number; problems: string[]; onChain: boolean };
export type Book = { lines: Line[]; payouts: Payout[]; balance: bigint; withdrawn: { hash: string; cents: bigint; time: number }[] };
const VIA_HUB = hasHub(D);
type Demo = { title: string; as: string; txs: { hash: Hex; what: string }[] };
const DEMOS = Object.values((D as unknown as { demo?: Record<string, Demo> }).demo ?? {});

async function blockTimes(blocks: bigint[]) {
  const uniq = [...new Set(blocks.map(String))].map(BigInt);
  const m = new Map<string, number>();
  await Promise.all(uniq.map(async (b) => m.set(String(b), Number((await pub.getBlock({ blockNumber: b })).timestamp))));
  return m;
}

/** The hub's public status: when the next batch pays shops. */
export function useHub() {
  return useLoad(() => api<HubStatus>('/hub'), [], 20_000);
}

export function MerchantTab({ market }: { market: Market }) {
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
        payouts: payouts.sort((a, b) => b.time - a.time),
        balance: bal.cents,
        withdrawn: wlogs.map((l) => ({ hash: l.transactionHash!, cents: (l.args.amount as bigint) / 10_000n, time: times.get(String(l.blockNumber)) ?? 0 })),
      };
    },
    [who?.address, unlocked, ver, shop?.id],
  );
  const avax = useLoad(() => (who ? pub.getBalance({ address: who.address }) : Promise.resolve(null)), [who?.address, ver]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const revenue = book.data?.lines.reduce((s, x) => s + (x.cents ?? 0n), 0n) ?? 0n;
  const out = book.data?.withdrawn.reduce((s, x) => s + x.cents, 0n) ?? 0n;
  const recorded = DEMOS.find((d) => d.as === 'merchant')?.txs[0];

  let main: ReactNode;
  if (!who)
    main = (
      <Card title="Take private payments" art="stall" sub="Customers pay your shop in tUSDC or on credit. Only you, your accountant and the auditor can read the amounts." pill={<Pill>Merchant</Pill>}>
        <Empty art="shield" title="Connect the shop’s wallet" action={<button className="nk-btn na-kaki" onClick={market.connect}>Connect a wallet</button>}>
          Or pick the test wallet to open your own shop in one tap. Revenue decrypts in this tab only.
        </Empty>
        {recorded && (
          <div className="nk-pad">
            <div className="nc-proof">
              <b>A shop has done this on Fuji</b>
              <p>Harbor &amp; Loom decrypted its revenue in the browser and withdrew 24.00 tUSDC. Only the withdrawal is public.</p>
              <TxBtn hash={recorded.hash} />
            </div>
          </div>
        )}
      </Card>
    );
  else if (shops.loading && !shops.data) main = <Card title="Your shop" art="stall" sub="Reading NorenMerchants on Fuji…" />;
  else if (!shop) main = <OpenShop onDone={() => shops.reload()} sample={who.kind === 'guest' ? who.address : null} />;
  else if (!unlocked)
    main = (
      <section className="nk-hero nc-hero na-hero-lock">
        <small>Private revenue · {shop.name} on Avalanche Fuji</small>
        <b>Encrypted</b>
        <p>{VIA_HUB ? `Snowtrace shows only that Noren’s hub paid ${shop.name}, never who the customers were or how much.` : `Snowtrace shows who paid ${shop.name}, never how much.`} Sign once to derive the shop’s key and decrypt it here, locally.</p>
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
          {busy ? 'Waiting for your signature…' : 'Decrypt revenue'}
        </button>
        {err && <p className="nk-err">{err}</p>}
      </section>
    );
  else
    main = (
      <>
        <section className="nk-hero nc-hero" aria-live="polite">
          <small>Private revenue · {shop.name} on Avalanche Fuji</small>
          <b>
            <i>$</i>
            {book.data ? (Number(revenue) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '…'}
          </b>
          <p>
            Decrypted in this tab with the shop’s key. Checkout link{' '}
            <a className="na-on-dark" {...linkProps(`/shop/${shop.slug}`)}>
              /shop/{shop.slug}
            </a>
            .
          </p>
          <div className="nc-tiles">
            <span>
              <em>Private balance</em>
              {book.data ? usd(cents(book.data.balance)) : '—'}
            </span>
            <span>
              <em>Orders</em>
              {book.data ? book.data.lines.length : '—'}
            </span>
            <span>
              <em>Withdrawn</em>
              {book.data ? usd(cents(out)) : '—'}
            </span>
            <span>
              <em>Last order</em>
              {book.data?.lines[0] ? ago(book.data.lines[0].time, now) : '—'}
            </span>
          </div>
        </section>
        <Card title="Orders" sub={VIA_HUB ? 'From the statements Noren’s hub sent with each payout, decrypted here' : 'Private payments, decrypted here'} pill={<Pill tone={book.error ? 'bad' : 'live'}>{book.loading ? 'Reading Fuji…' : book.error ? 'Error' : 'Decrypted'}</Pill>}>
          {book.error && <div className="nk-pad"><p className="nk-err">Couldn’t decrypt payments: {book.error}</p></div>}
          {book.data && book.data.lines.length === 0 && (
            <Empty title="No orders yet" action={<a className="nk-btn" {...linkProps(`/shop/${shop.slug}`)}>Open your checkout</a>}>
              {VIA_HUB ? 'Orders show up here once Noren’s hub pays out the next batch.' : 'Private payments show up here as soon as they land on Fuji.'}
            </Empty>
          )}
          {book.data && book.data.lines.length > 0 && (
            <ul className="nk-acts nc-acts na-wrap">
              {book.data.lines.slice(0, 12).map((x) => (
                <Row
                  key={x.key}
                  kind="private-pay"
                  state={x.cents != null ? 'success' : 'rejected'}
                  title={x.memo ?? 'No note'}
                  sub={`${x.batch != null ? `Batch #${x.batch}` : x.from ? `From ${x.from.slice(0, 6)}…` : 'Direct'} · ${ago(x.time, now)} · Snowtrace: encrypted`}
                  right={
                    <span className="r">
                      <b>{x.cents != null ? usd(cents(x.cents)) : x.error ?? 'unreadable'}</b>
                      <a className="mono na-tx" href={`https://testnet.snowtrace.io/tx/${x.tx}`} target="_blank" rel="noreferrer">
                        tx <Icon.ext />
                      </a>
                    </span>
                  }
                />
              ))}
            </ul>
          )}
        </Card>
        {book.data && <Assistant shop={shop} book={book.data} />}
      </>
    );

  return (
    <>
      <div className="nk-home-main">
        {who && avax.data === 0n && <StarterCard address={who.address} />}
        {main}
      </div>
      <aside className="nk-home-side">
        {who && shop && unlocked && book.data && <Withdraw balance={book.data.balance} />}
        {VIA_HUB && book.data && book.data.payouts.length > 0 && <Payouts payouts={book.data.payouts} now={now} />}
        {(!who || !shop || !unlocked) && <HubCard />}
        <SnowtraceSees />
      </aside>
    </>
  );
}

export function HubCard() {
  const hub = useHub();
  const now = useNow(1000);
  const h = hub.data;
  const left = h ? Math.max(0, Math.round(h.nextSettleAt - now / 1000)) : null;
  return (
    <Card title="The settlement hub" art="hourglass" sub={D.hub ? <AddrLink a={D.hub} /> : 'Not deployed'} pill={<Pill tone={hub.error || h?.error ? 'bad' : 'live'}>{hub.error ? 'Offline' : h?.error ? 'Error' : h ? 'Live' : 'Loading'}</Pill>}>
      {hub.error && <p className="nk-err">{hub.error}</p>}
      <div className="nk-stats nc-side-stats">
        <div className="nk-stat">
          <small>Next batch</small>
          <b>{left == null ? '—' : left === 0 || h?.settling ? 'Now' : `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`}</b>
        </div>
        <div className="nk-stat">
          <small>Queued</small>
          <b>{h ? h.queued : '—'}</b>
        </div>
        <div className="nk-stat">
          <small>Every</small>
          <b>{h ? `${Math.round(h.everySec / 60)} min` : '—'}</b>
        </div>
        <div className="nk-stat">
          <small>Cover payouts</small>
          <b>{h ? `≥ ${h.coverMin}` : '—'}</b>
        </div>
      </div>
      <p className="nc-fine">Customers pay the hub; each batch pays shops from it, with zero-value cover payouts so a payout can’t be matched to a payment. {h?.lastBatchAt ? `Last batch ${ago(h.lastBatchAt, now)}.` : ''}</p>
    </Card>
  );
}

function SnowtraceSees() {
  const rows: [string, string, boolean][] = VIA_HUB
    ? [
        ['Who paid the shop', 'Hidden', true],
        ['Noren’s hub paid the shop', 'Visible', false],
        ['How much', 'Encrypted', true],
        ['Order note', 'Encrypted', true],
        ['Shop balance', 'Encrypted', true],
        ['Withdrawals', 'Visible', false],
      ]
    : [
        ['Who paid', 'Visible', false],
        ['How much', 'Encrypted', true],
        ['Order note', 'Encrypted', true],
        ['Withdrawals', 'Visible', false],
      ];
  return (
    <Card title="What Snowtrace sees" sub="The public explorer’s view of your shop" art="shield">
      <ul className="nk-acts nc-acts">
        {rows.map(([k, v, hidden]) => (
          <Row key={k} kind={hidden ? 'shield' : undefined} state={hidden ? 'success' : 'skip'} title={k} right={<span className={`nk-pill ${hidden ? 'live' : ''}`}>{v}</span>} />
        ))}
      </ul>
    </Card>
  );
}

function Withdraw({ balance }: { balance: bigint }) {
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [tx, setTx] = useState<string | null>(null);
  return (
    <Card title="Withdraw" sub="Moves private tUSDC to this wallet’s public balance. The amount becomes public." art="receipt">
      <div className="nk-pad">
        <div className="nk-box">
          <label htmlFor="na-wd">
            <span>Amount</span>
            <span className="mono">{usd(cents(balance))} private</span>
          </label>
          <div className="nk-row">
            <input id="na-wd" inputMode="decimal" value={amount} placeholder={(Number(balance) / 100).toFixed(2)} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))} />
            <span className="nk-token" data-static="true">
              <Mark id="USDC" size={28} />
              tUSDC
            </span>
          </div>
        </div>
        <button
          className="nk-cta"
          disabled={busy || balance === 0n}
          onClick={async () => {
            setBusy(true);
            setErr(null);
            try {
              const c = amount.trim() ? parseUsdToCents(amount) : balance;
              if (c == null || c <= 0n) throw Error('Enter an amount like 24.00');
              const h = await privateSession().withdraw(c, 'payout');
              announceTx(h, 'withdraw private revenue');
              setTx(h);
              setAmount('');
            } catch (e) {
              setErr(readable(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? 'Proving and withdrawing…' : balance === 0n ? 'Nothing to withdraw' : amount.trim() ? `Withdraw ${amount}` : 'Withdraw all'}
        </button>
        {err && <p className="nk-err">{err}</p>}
        {tx && (
          <div className="nc-receipt" role="status">
            <div className="nc-receipt-h">
              <Art3d k="success" size={44} />
              <b>Withdrawn on Fuji</b>
            </div>
            <TxBtn hash={tx} />
          </div>
        )}
      </div>
    </Card>
  );
}

function Payouts({ payouts, now }: { payouts: Payout[]; now: number }) {
  return (
    <Card title="Payouts" sub="Each one checked against what your key decrypts and the digest on chain" pill={<Pill>{payouts.length}</Pill>}>
      <ul className="nk-acts nc-acts">
        {payouts.slice(0, 6).map((p) => (
          <Row
            key={p.tx}
            state={p.problems.length ? 'rejected' : 'success'}
            title={`Batch #${p.batch} · ${p.cents != null ? usd(cents(p.cents)) : '—'}`}
            sub={`${p.cover ? 'cover payout' : `${p.lines} order${p.lines === 1 ? '' : 's'}`} · ${ago(p.time, now)}${p.problems.length ? ` · ${p.problems.join('; ')}` : p.onChain ? ' · matches chain' : ''}`}
            right={<TxRef hash={p.tx} />}
          />
        ))}
      </ul>
    </Card>
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
      const c = parseUsdToCents(price);
      if (!name.trim() || !/^[a-z0-9-]{3,32}$/.test(slug)) throw Error('Give the shop a name and a link of 3 to 32 lowercase letters, digits or dashes.');
      if (!item.trim() || c == null || c <= 0n) throw Error('List a first item with a price like 24.00.');
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
      await write(D.norenMerchants, norenMerchantsAbi as Abi, 'listItem', [BigInt(s.id), item.trim(), c], 'list item');
      onDone();
    } catch (e) {
      setErr(readable(e));
    } finally {
      setBusy(null);
    }
  }
  const field = (id: string, label: string, v: string, set: (s: string) => void, ph: string, mono = false) => (
    <div className="nk-box">
      <label htmlFor={id}>{label}</label>
      <input id={id} className={mono ? 'nc-addr' : 'nc-addr na-sans'} value={v} onChange={(e) => set(e.target.value)} placeholder={ph} disabled={!!busy} />
    </div>
  );
  return (
    <Card title="Open your shop on Noren" art="stall" sub={VIA_HUB ? 'Customers pay you privately through Noren’s hub. Amounts stay encrypted; only you, the hub and the auditor read them.' : 'Customers pay you privately. Only you and the auditor can read your revenue.'} pill={<Pill>NorenMerchants</Pill>}>
      <div className="nk-pad">
        <div className="na-form-grid">
          {field('na-name', 'Shop name', name, setNameV, 'Harbor & Loom')}
          {field('na-slug', 'Checkout link · /shop/…', slug, (s) => setSlug(s.toLowerCase()), 'harbor-loom', true)}
          {field('na-item', 'First item', item, setItem, 'Linen tote')}
          {field('na-price', 'Price in tUSDC', price, setPrice, '24.00')}
        </div>
        <button className="nk-cta" disabled={!!busy} onClick={open}>
          {busy ?? 'Open shop'}
        </button>
        {err && <p className="nk-err">{err}</p>}
        <p className="nc-fine">Opening registers this wallet’s eERC key (a proof made on this device), then opens the shop and lists the item: three Fuji transactions.</p>
      </div>
    </Card>
  );
}
