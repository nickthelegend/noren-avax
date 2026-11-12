import { privateTransferEvent, readPool, readPrices, readShops, scanLogs, addressUrl } from '@noren-avax/sdk';
import { D, pub, setName } from '../lib/chain';
import { ago, useLoad, useNow } from '../lib/hooks';
import { linkProps } from '../lib/router';
import { Addr, Art, Money, Skeleton, TxLink } from '../ui/kit';

const DX = D as typeof D & { norenSettlement?: string; norenGasStation?: string; hub?: string };
const CONTRACTS: [string, string | undefined, string, boolean][] = [
  ['EncryptedERC', D.encryptedERC, 'Ava Labs eERC, converter mode over tUSDC', true],
  ['NorenSettlement', DX.norenSettlement, 'Hub batches and statement digests', true],
  ['Noren hub', DX.hub, 'eERC account that pays shops in batches', false],
  ['NorenCredit', D.norenCredit, 'Credit line on Chainlink prices', true],
  ['NorenMerchants', D.norenMerchants, 'Shops and catalogues', true],
  ['NorenGasStation', DX.norenGasStation, 'Starter pack for new wallets', true],
  ['Registrar', D.registrar, 'eERC public keys', true],
  ['tUSDC', D.tUSDC, 'Test USDC (6 decimals)', true],
  ['tWBTC', D.tWBTC, 'Test WBTC (8 decimals)', true],
];

export function Landing() {
  const now = useNow();
  const shops = useLoad(() => readShops(pub as never, D), []);
  const prices = useLoad(() => readPrices(pub as never, D), [], 60_000);
  const pool = useLoad(() => readPool(pub as never, D), []);
  const latest = useLoad(async () => {
    const logs = await scanLogs(pub as never, { address: D.encryptedERC, event: privateTransferEvent, fromBlock: BigInt(D.deployBlock) });
    const last = logs[logs.length - 1];
    if (!last) return { count: 0, last: null };
    const b = await pub.getBlock({ blockNumber: last.blockNumber! });
    return { count: logs.length, last: { ...last, time: Number(b.timestamp) } };
  }, []);
  shops.data?.forEach((s) => setName(s.owner, s.name));
  const shop = shops.data?.find((s) => s.slug === 'harbor-loom') ?? shops.data?.[0];
  const pct = latest.data?.last?.args.auditorPCT as readonly bigint[] | undefined;

  return (
    <main>
      <section className="hero">
        <div className="wrap hero-in">
          <div className="hero-copy">
            <h1>
              Let customers pay <em>privately.</em>
            </h1>
            <p className="lede">For shops that take crypto. Customers pay in stablecoins, or on credit against their bitcoin, and only you and your accountant see who paid and how much. Settled on Avalanche with eERC, its encrypted token.</p>
            <div className="hero-cta">
              <a className="btn btn-light" {...linkProps('/shop/harbor-loom')}>
                Try the checkout
              </a>
              <a className="btn btn-ghost-light" {...linkProps('/merchant')}>
                Merchant dashboard
              </a>
            </div>
          </div>
          <div className="hero-widget">
            <Art name="stall" size={176} className="hero-art" alt="" />
            <div className="widget">
              <div className="widget-h">
                <span className="co-avatar" aria-hidden="true">{shop?.name.slice(0, 1) ?? 'N'}</span>
                <div>
                  <b>{shop?.name ?? (shops.loading ? 'Loading shop…' : 'No shop yet')}</b>
                  <small>Checkout on Noren · Fuji</small>
                </div>
              </div>
              <ul className="widget-items">
                {shop
                  ? shop.items.slice(0, 3).map((it) => (
                      <li key={it.id}>
                        <span>{it.name}</span>
                        <b className="num">{(Number(it.priceCents) / 100).toFixed(2)}</b>
                      </li>
                    ))
                  : [0, 1, 2].map((i) => (
                      <li key={i}>
                        <Skeleton w={120} />
                      </li>
                    ))}
              </ul>
              <div className="widget-pay">
                <a className="wp wp-on" {...linkProps('/shop/harbor-loom')}>
                  <Art name="sealed-coin" size={32} />
                  <span>Pay with tUSDC</span>
                </a>
                <a className="wp" {...linkProps('/shop/harbor-loom')}>
                  <Art name="btc-coin" size={32} />
                  <span>Pay with credit</span>
                </a>
              </div>
              <p className="widget-foot">Amount encrypted with eERC</p>
            </div>
          </div>
        </div>
      </section>

      <section className="wrap band">
        <div className="stats">
          <div>
            <b>{latest.data ? latest.data.count : <Skeleton w={40} h={36} />}</b>
            <span>private payments on Fuji</span>
          </div>
          <div>
            <b>{pool.data ? <Money usd={Number(pool.data.liquidity) / 1e6} /> : <Skeleton w={120} h={36} />}</b>
            <span>tUSDC ready to lend</span>
          </div>
          <div>
            <b>{prices.data ? <Money usd={Number(prices.data.btc) / 1e8} /> : <Skeleton w={120} h={36} />}</b>
            <span>BTC / USD from Chainlink{prices.data ? `, ${ago(prices.data.btcUpdatedAt, now)}` : ''}</span>
          </div>
        </div>
      </section>

      <section className="wrap seen-sec">
        <div className="sec-h">
          <h2>The same payment, two views</h2>
          <p>The latest private payment on Fuji, read live from the eERC contract.</p>
        </div>
        <div className="views">
          <article className="view view-public">
            <header>
              <b>What Snowtrace sees</b>
              {latest.data?.last && <TxLink hash={latest.data.last.transactionHash!} label="Open the tx" />}
            </header>
            {latest.loading && !latest.data && <Skeleton h={160} />}
            {latest.data && !latest.data.last && <p className="muted">No private payment yet. Make the first one from the checkout.</p>}
            {latest.data?.last && (
              <dl className="ev">
                <div>
                  <dt>event</dt>
                  <dd>PrivateTransfer</dd>
                </div>
                <div>
                  <dt>from</dt>
                  <dd>
                    <Addr a={latest.data.last.args.from as string} />
                  </dd>
                </div>
                <div>
                  <dt>to</dt>
                  <dd>
                    <Addr a={latest.data.last.args.to as string} />
                  </dd>
                </div>
                <div>
                  <dt>amount</dt>
                  <dd className="enc-words">
                    {pct?.slice(0, 3).map((w, i) => (
                      <span key={i}>{`0x${w.toString(16).padStart(64, '0').slice(0, 22)}…`}</span>
                    ))}
                  </dd>
                </div>
                <div>
                  <dt>when</dt>
                  <dd>{ago(latest.data.last.time, now)}</dd>
                </div>
              </dl>
            )}
          </article>
          <article className="view view-shop">
            <header>
              <b>What the shop sees</b>
            </header>
            <Art name="receipt" size={88} />
            <p>
              The exact amount and the order, decrypted in the browser with the shop’s own key. Its accountant gets a copy; nobody else can read it.
            </p>
            <div className="view-acts">
              <a className="btn btn-dark" {...linkProps('/merchant')}>
                Open the dashboard
              </a>
              <a className="btn btn-quiet" {...linkProps('/auditor')}>
                Auditor view
              </a>
            </div>
          </article>
        </div>
      </section>

      <section className="wrap ways">
        <div className="sec-h">
          <h2>Two ways to pay, one private receipt</h2>
        </div>
        <div className="ways-grid">
          <article className="way">
            <Art name="sealed-coin" size={120} />
            <h3>Pay with stablecoins</h3>
            <p>Top up a private tUSDC balance once, then pay any Noren shop from it. Each payment is a zero-knowledge proof made in the browser.</p>
          </article>
          <article className="way way-dark">
            <Art name="btc-coin" size={120} />
            <h3>Pay with credit</h3>
            <p>Lock BTC or AVAX, borrow against it at Chainlink prices and pay in the same flow. No coin sold, no amount published.</p>
            <a className="link-light" {...linkProps('/credit')}>
              See the credit line →
            </a>
          </article>
          <article className="way">
            <Art name="ledger" size={120} />
            <h3>Books that still balance</h3>
            <p>The auditor and each shop’s accountant can check every payment, so the books reconcile without making revenue public.</p>
          </article>
        </div>
      </section>

      <section className="wrap live">
        <div className="sec-h">
          <h2>Live on Avalanche Fuji</h2>
          <p>Verified contracts. Every screen reads them live.</p>
        </div>
        <div className="contracts">
          {CONTRACTS.filter(([, a]) => !!a).map(([n, a, d, code]) => (
            <a key={n} className="contract" href={`${addressUrl(a!)}${code ? '#code' : ''}`} target="_blank" rel="noreferrer">
              <b>{n}</b>
              <span>{d}</span>
              <code>{`${a!.slice(0, 10)}…${a!.slice(-6)}`}</code>
            </a>
          ))}
        </div>
      </section>

      <section className="closing">
        <div className="wrap closing-in">
          <h2>Take your first private payment.</h2>
          <p>Open a shop, share the checkout link, and read your revenue where only you can.</p>
          <div className="hero-cta center">
            <a className="btn btn-light" {...linkProps('/merchant')}>
              Open a shop
            </a>
            <a className="btn btn-ghost-light" {...linkProps('/shop/harbor-loom')}>
              Pay Harbor &amp; Loom
            </a>
          </div>
        </div>
      </section>
    </main>
  );
}
