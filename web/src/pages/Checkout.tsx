import { useMemo, useState } from 'react';
import { erc20Abi, verifyMessage, type Abi, type Hex } from 'viem';
import { hasHub, hubNote, norenCreditAbi, norenTokenAbi, readPosition, readShops, readWallet, receiptText, settledIn, type Shop } from '@noren-avax/sdk';
import { api, getStarterPack, saveClaim, type HubStatus, type Receipt } from '../lib/api';
import { D, pub, readable, setName } from '../lib/chain';
import { useLoad, useNow } from '../lib/hooks';
import { StarterPack } from '../ui/StarterPack';
import { linkProps } from '../lib/router';
import { announceTx, isUnlocked, privateSession, unlock, useSignerVersion, useWho, write } from '../lib/signer';
import { Art, Money, Note, Skeleton, Steps, TxLink, type Step } from '../ui/kit';

type Method = 'private' | 'credit';
type Plan = { key: string; title: string; detail: string; needed: () => Promise<boolean>; run: () => Promise<Hex | null> };

const usdcOf = (cents: bigint) => cents * 10_000n;
const orderId = () => Math.random().toString(36).slice(2, 8).toUpperCase();
const claimSecret = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
const VIA_HUB = hasHub(D);
const hhmm = (sec: number) => new Date(sec * 1000).toISOString().slice(11, 16);

export function Checkout({ slug }: { slug: string }) {
  const who = useWho();
  const ver = useSignerVersion();
  const shops = useLoad(() => readShops(pub as never, D), []);
  const shop: Shop | undefined = shops.data?.find((s) => s.slug === slug);
  if (shop) setName(shop.owner, shop.name);
  const items = shop?.items.filter((i) => i.active) ?? [];
  const [itemId, setItemId] = useState(0);
  const item = items.find((i) => i.id === itemId) ?? items[0];
  const [method, setMethod] = useState<Method>('private');
  const [steps, setSteps] = useState<Step[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState<{ hash: Hex; cents: bigint; item: string; method: Method; order: string; claim: string } | null>(null);

  const acct = useLoad(
    async () => {
      if (!who) return null;
      const p = privateSession();
      const [wallet, registered, position, avax] = await Promise.all([
        readWallet(pub as never, D, who.address),
        p.isRegistered(),
        readPosition(pub as never, D, who.address).catch((e) => ({ error: readable(e) })),
        pub.getBalance({ address: who.address }),
      ]);
      const priv = isUnlocked() && registered ? (await p.balance()).cents : null;
      return { wallet, registered, position, priv, avax };
    },
    [who?.address, ver],
  );

  const position = acct.data && !('error' in acct.data.position) ? acct.data.position : null;
  const positionErr = acct.data && 'error' in acct.data.position ? acct.data.position.error : null;
  const price = item?.priceCents ?? 0n;

  const plan = useMemo((): Plan[] => {
    if (!who || !shop || !item) return [];
    const p = () => privateSession();
    const order = orderId();
    const claim = claimSecret();
    // Through the hub, the note (encrypted to the hub) says which shop; without one, straight to the shop.
    const payee = VIA_HUB ? D.hub! : shop.owner;
    const memo = VIA_HUB ? hubNote({ shopId: shop.id, order, claim, item: item.name }) : `${item.name} · order ${order}`;
    const common: Plan[] = [
      {
        key: 'pack',
        title: 'Get test funds',
        detail: 'NorenGasStation sends gas, 100 tUSDC and 0.01 tWBTC to this new wallet in one transaction.',
        needed: async () => VIA_HUB && (await pub.getBalance({ address: who.address })) === 0n,
        run: () => getStarterPack(who.address),
      },
      {
        key: 'unlock',
        title: 'Unlock your private balance',
        detail: 'Sign a message once; your eERC key is derived from it and stays in this tab.',
        needed: async () => !isUnlocked(),
        run: async () => {
          await unlock();
          return null;
        },
      },
      {
        key: 'register',
        title: 'Register for private payments',
        detail: 'A zero-knowledge proof made on this device registers your public key with the eERC Registrar.',
        needed: async () => !(await p().isRegistered()),
        run: async () => {
          const h = await p().register();
          if (h) announceTx(h, 'register eERC key');
          return h;
        },
      },
    ];
    const pay: Plan = {
      key: 'pay',
      title: VIA_HUB ? `Pay ${shop.name} through Noren` : `Pay ${shop.name} privately`,
      detail: VIA_HUB
        ? `Proves the payment on this device and sends ${(Number(price) / 100).toFixed(2)} tUSDC, encrypted, to Noren’s settlement hub. Only the hub learns it is for ${shop.name}.`
        : `Proves the payment on this device and sends ${(Number(price) / 100).toFixed(2)} tUSDC as an encrypted amount, with the order note encrypted to the shop.`,
      needed: async () => true,
      run: async () => {
        const h = await p().pay(payee, price, memo);
        announceTx(h, VIA_HUB ? `private payment via Noren for ${shop.name}` : `private payment to ${shop.name}`);
        if (VIA_HUB) saveClaim(h, claim, { shop: shop.name, item: item.name, cents: String(price), order });
        setReceipt({ hash: h, cents: price, item: item.name, method, order, claim });
        return h;
      },
    };
    if (method === 'private') {
      let topUp = 0n;
      return [
        ...common,
        {
          key: 'faucet',
          title: 'Get test tUSDC',
          detail: 'Draws 250 test tUSDC from the faucet (once a day).',
          needed: async () => {
            const bal = (await p().balance()).cents;
            if (bal >= price) return false;
            const w = await readWallet(pub as never, D, who.address);
            return w.usdc < usdcOf(price - bal);
          },
          run: () => write(D.tUSDC, norenTokenAbi as Abi, 'faucet', [], 'tUSDC faucet'),
        },
        {
          key: 'shield',
          title: 'Top up your private balance',
          detail: 'Moves public tUSDC into eERC. The top-up is public; the payments made from it are not.',
          needed: async () => {
            const bal = (await p().balance()).cents;
            if (bal >= price) return false;
            const w = await readWallet(pub as never, D, who.address);
            const short = usdcOf(price - bal);
            // Top up a round amount so the deposit doesn't reveal the price.
            const round = ((short + 49_999_999n) / 50_000_000n) * 50_000_000n;
            topUp = w.usdc >= round ? round : short;
            return true;
          },
          run: async () => {
            const r = await p().shield(topUp);
            if (r.approve) announceTx(r.approve, 'approve tUSDC for eERC');
            announceTx(r.deposit, 'top up private balance');
            return r.deposit;
          },
        },
        pay,
      ];
    }
    return [
      ...common,
      {
        key: 'collateral',
        title: 'Add collateral: 0.01 test tWBTC',
        detail: 'Draws test tWBTC from the faucet and locks it in NorenCredit, priced by Chainlink BTC / USD.',
        needed: async () => {
          const pos = await readPosition(pub as never, D, who.address);
          return pos.available < usdcOf(price);
        },
        run: async () => {
          const w = await readWallet(pub as never, D, who.address);
          if (w.wbtc < 1_000_000n) await write(D.tWBTC, norenTokenAbi as Abi, 'faucet', [], 'tWBTC faucet');
          const allowance = await pub.readContract({ address: D.tWBTC, abi: erc20Abi, functionName: 'allowance', args: [who.address, D.norenCredit] });
          if (allowance < 1_000_000n) await write(D.tWBTC, erc20Abi as Abi, 'approve', [D.norenCredit, 2n ** 255n], 'approve tWBTC');
          return write(D.norenCredit, norenCreditAbi as Abi, 'depositCollateral', [D.tWBTC, 1_000_000n], 'lock 0.01 tWBTC as collateral');
        },
      },
      {
        key: 'borrow',
        title: `Borrow ${(Number(price) / 100).toFixed(2)} tUSDC on credit`,
        detail: 'NorenCredit checks the Chainlink price is fresh and your limit holds, then lends from the pool.',
        needed: async () => true,
        run: () => write(D.norenCredit, norenCreditAbi as Abi, 'borrow', [usdcOf(price), who.address], `borrow ${(Number(price) / 100).toFixed(2)} tUSDC`),
      },
      {
        key: 'shield',
        title: 'Move the credit into your private balance',
        detail: 'Deposits the borrowed tUSDC into eERC so the payment itself is encrypted.',
        needed: async () => true,
        run: async () => {
          const r = await p().shield(usdcOf(price));
          if (r.approve) announceTx(r.approve, 'approve tUSDC for eERC');
          announceTx(r.deposit, 'credit into private balance');
          return r.deposit;
        },
      },
      pay,
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [who?.address, shop?.owner, item?.id, method, price]);

  async function run() {
    setBusy(true);
    setReceipt(null);
    const st: Step[] = plan.map((s) => ({ key: s.key, title: s.title, detail: s.detail, state: 'todo' }));
    setSteps([...st]);
    for (let i = 0; i < plan.length; i++) {
      st[i] = { ...st[i]!, state: 'run' };
      setSteps([...st]);
      try {
        if (!(await plan[i]!.needed())) {
          st[i] = { ...st[i]!, state: 'skip' };
        } else {
          const h = await plan[i]!.run();
          st[i] = { ...st[i]!, state: 'done', hash: h ?? undefined };
        }
        setSteps([...st]);
      } catch (e) {
        st[i] = { ...st[i]!, state: 'fail', error: readable(e) };
        setSteps([...st]);
        break;
      }
    }
    setBusy(false);
    acct.reload();
    // Public RPCs behind a load balancer can lag a block; read once more.
    setTimeout(acct.reload, 2500);
  }

  if (shops.error) return <main className="wrap pad"><Note tone="bad" art="warning" title="Couldn't read the shop from Fuji">{shops.error}</Note></main>;

  return (
    <main className="checkout">
      <section className="co-left">
        <div className="co-left-in">
          <div className="co-shop">
            <span className="co-avatar" aria-hidden="true">{shop?.name.slice(0, 1) ?? ''}</span>
            {shop ? <b>{shop.name}</b> : shops.loading ? <Skeleton w={140} /> : <b>No shop at “{slug}”</b>}
          </div>
          <p className="co-label">Pay {shop?.name ?? ''}</p>
          <div className="co-total">
            <Money usd={item ? Number(item.priceCents) / 100 : null} />
            <span className="co-unit">tUSDC</span>
          </div>
          {shop && items.length > 0 && (
            <ul className="co-items" role="radiogroup" aria-label="Item">
              {items.map((it) => (
                <li key={it.id}>
                  <button role="radio" aria-checked={it.id === item?.id} className={it.id === item?.id ? 'on' : ''} onClick={() => !busy && setItemId(it.id)} disabled={busy}>
                    <span>{it.name}</span>
                    <span className="num">{(Number(it.priceCents) / 100).toFixed(2)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {shop && items.length === 0 && <p className="co-empty">This shop has not listed anything yet.</p>}
          {!shop && !shops.loading && (
            <p className="co-empty">
              Shops are read from NorenMerchants on Fuji. Try <a {...linkProps('/shop/harbor-loom')}>Harbor &amp; Loom</a>.
            </p>
          )}
          <dl className="co-lines">
            <div>
              <dt>Network fee</dt>
              <dd>Fuji gas, paid in AVAX</dd>
            </div>
            <div className="co-sum">
              <dt>Total due</dt>
              <dd>{item ? `${(Number(item.priceCents) / 100).toFixed(2)} tUSDC` : '—'}</dd>
            </div>
          </dl>
          <div className="co-priv">
            <Art name="sealed-coin" size={56} />
            <p>
              {VIA_HUB ? (
                <>
                  <b>Snowtrace sees you paid Noren. Not which shop, not how much.</b> {shop?.name ?? 'The shop'} is paid from Noren’s hub in the next batch, with other shops.
                </>
              ) : (
                <>
                  <b>{shop?.name ?? 'The shop'} sees the amount. Snowtrace doesn’t.</b> The payment is an eERC transfer: the amount is a ciphertext that only the shop’s key and the auditor’s key open.
                </>
              )}
            </p>
          </div>
        </div>
      </section>

      <section className="co-right">
        <div className="co-right-in">
          <h1 className="co-h">
            Pay <em>privately</em>
          </h1>
          <div className="methods" role="radiogroup" aria-label="Payment method">
            <button role="radio" aria-checked={method === 'private'} className={`method ${method === 'private' ? 'on' : ''}`} onClick={() => !busy && setMethod('private')} disabled={busy}>
              <Art name="sealed-coin" size={44} />
              <span>
                <b>Pay with tUSDC</b>
                <small>From your private balance</small>
              </span>
            </button>
            <button role="radio" aria-checked={method === 'credit'} className={`method ${method === 'credit' ? 'on' : ''}`} onClick={() => !busy && setMethod('credit')} disabled={busy}>
              <Art name="btc-coin" size={44} />
              <span>
                <b>Pay with credit</b>
                <small>Borrow against your BTC or AVAX</small>
              </span>
            </button>
          </div>

          {!who ? (
            <Note art="ledger" title="Connect a wallet on Avalanche Fuji">
              Noren asks for one signature to derive your private-balance key, then each payment is one or two Fuji transactions.
            </Note>
          ) : (
            <>
            {acct.data && acct.data.avax === 0n && <StarterPack address={who.address} />}
            <div className="bal-row">
              <div className="bal">
                <span>Private balance</span>
                <b>{acct.data?.priv != null ? <Money usd={Number(acct.data.priv) / 100} /> : acct.data && !acct.data.registered ? 'Not set up' : isUnlocked() ? <Skeleton w={80} /> : 'Locked'}</b>
                <small>{isUnlocked() ? 'Decrypted in this tab' : 'Unlocks when you pay'}</small>
              </div>
              <div className="bal">
                <span>{method === 'credit' ? 'Credit available' : 'Wallet tUSDC'}</span>
                <b>
                  {acct.loading && !acct.data ? (
                    <Skeleton w={80} />
                  ) : method === 'credit' ? (
                    position ? <Money usd={Number(position.available) / 1e6} /> : '—'
                  ) : acct.data ? (
                    <Money usd={Number(acct.data.wallet.usdc) / 1e6} />
                  ) : (
                    '—'
                  )}
                </b>
                <small>{method === 'credit' ? (positionErr ? 'Price feed stale' : <a {...linkProps('/credit')}>Credit line</a>) : 'Public, on Fuji'}</small>
              </div>
            </div>
            </>
          )}
          {acct.error && <Note tone="bad" title="Couldn't read your balances">{acct.error}</Note>}
          {method === 'credit' && positionErr && <Note tone="warn" art="gauge" title="Credit is paused">{positionErr}</Note>}

          <button className="btn btn-pay" disabled={!who || !item || busy} onClick={run}>
            {busy ? 'Working on Fuji…' : item ? `${method === 'credit' ? 'Pay on credit' : 'Pay'} ${(Number(item.priceCents) / 100).toFixed(2)} tUSDC` : 'Pay'}
          </button>
          {steps && <Steps steps={steps} />}
          {receipt && (VIA_HUB ? <HubReceipt r={receipt} shopName={shop?.name ?? 'the shop'} /> : (
            <div className="receipt" aria-live="polite">
              <Art name="receipt" size={64} />
              <div>
                <b>
                  Paid {(Number(receipt.cents) / 100).toFixed(2)} tUSDC to {shop?.name} {receipt.method === 'credit' ? 'on credit' : ''}
                </b>
                <p>
                  {receipt.item} · order {receipt.order}. On Snowtrace this transfer shows only ciphertext; the shop decrypts it in its <a {...linkProps('/merchant')}>dashboard</a>.
                </p>
                <TxLink hash={receipt.hash} label="See it on Snowtrace" />
              </div>
            </div>
          ))}
          <p className="fine">
            Ava Labs’ eERC over test USDC on Fuji, proofs made in your browser. Top-ups and borrowing are public; the payment is not.
          </p>
        </div>
      </section>
    </main>
  );
}

/** The customer's view of a hub payment: queued, then settled in a batch (read from NorenSettlement on chain), with the
 *  hub's signed receipt (fetched with the claim secret only this browser and the hub know). */
function HubReceipt({ r, shopName }: { r: { hash: Hex; cents: bigint; item: string; method: Method; order: string; claim: string }; shopName: string }) {
  const now = useNow(1000);
  const hub = useLoad(() => api<HubStatus>('/hub'), [], 15_000);
  const batch = useLoad(() => settledIn(pub as never, D as never, r.hash), [r.hash], 10_000);
  const rec = useLoad(
    async () => {
      const x = await api<Receipt | { status: 'unseen' }>('/receipt', { tx: r.hash, claim: r.claim });
      if (!('signature' in x)) return null; // the hub hasn't read it from Fuji yet
      const ok = await verifyMessage({ address: D.hub!, message: receiptText({ ...x, chainId: D.chainId }), signature: x.signature });
      return { ...x, verified: ok };
    },
    [r.hash, batch.data],
    15_000,
  );
  const settled = batch.data != null;
  const next = hub.data?.nextSettleAt;
  const left = next ? Math.max(0, Math.round(next - now / 1000)) : null;
  return (
    <div className="receipt" aria-live="polite">
      <Art name="receipt" size={64} />
      <div>
        <b>
          Paid {(Number(r.cents) / 100).toFixed(2)} tUSDC {r.method === 'credit' ? 'on credit ' : ''}for {shopName}
        </b>
        <p>
          {r.item} · order {r.order}.{' '}
          {settled ? (
            <>Settled to {shopName} in batch #{batch.data}{rec.data?.payoutTx ? ', with other shops’ payouts' : ''}.</>
          ) : next ? (
            left === 0 ? (
              <>Noren’s hub is paying out this batch now.</>
            ) : (
              <>Noren pays {shopName} in the next batch, at {hhmm(next)} UTC{left != null && left < 600 ? ` (in ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')})` : ''}.</>
            )
          ) : hub.error ? (
            <>The hub’s status is unavailable ({hub.error}). Your payment is safe on chain; it settles when the hub is back.</>
          ) : (
            <>Waiting for the next batch.</>
          )}
        </p>
        <div className="rc-links">
          <TxLink hash={r.hash} label="Your payment" />
          {rec.data?.payoutTx && <TxLink hash={rec.data.payoutTx} label="Shop payout" />}
          {rec.data?.verified && <span className="chip chip-ok">Receipt signed by the hub</span>}
          {rec.error && <span className="chip chip-bad" title={rec.error}>Receipt unavailable</span>}
        </div>
      </div>
    </div>
  );
}
