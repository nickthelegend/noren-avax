import { useMemo } from 'react';
import type { Hex } from 'viem';
import { addressUrl, hasHub, privateTransferEvent, readBatches, readPool, readPrices, readShops, scanLogs, txUrl } from '@noren-avax/sdk';
import { D, pub, setName, nameOf } from '../lib/chain';
import { ago, useLoad, useNow } from '../lib/hooks';
import { linkProps } from '../lib/router';
import { GlyphField, useReveal } from '../ui/nk/ambient';
import { Icon, Logo } from '../ui/nk/brand';
import { Art3d, type Art3dKey } from '../ui/nk/Art3d';
import { Mark } from '../ui/nk/marks';
import { short, shortHash, u6, u8, usd } from '../app/common';
import '../ui/nk/landing.css';

type Status = 'live' | 'proof' | 'key' | 'test';
const LABEL: Record<Status, string> = { live: 'Live on Fuji', proof: 'Proof in the browser', key: 'Setup required', test: 'Test tokens only' };
const Chip = ({ s }: { s: Status }) => (
  <span className={`nx-chip ${s === 'live' ? 'testnet' : s === 'proof' ? 'quotes' : s === 'key' ? 'key' : 'wip'} mono`}>
    <i />
    {LABEL[s]}
  </span>
);
const Tag = ({ children, dark }: { children: string; dark?: boolean }) => <span className={`lx-tag mono ${dark ? 'dark' : ''}`}>■ {children}</span>;

type Demo = { title: string; txs: { hash: Hex; what: string }[] };
const DEMO = (D as unknown as { demo?: Record<string, Demo> }).demo ?? {};
const DX = D as typeof D & { norenSettlement?: string; norenGasStation?: string; hub?: string };
/** The recorded judge run, first screen: each card opens its Snowtrace transaction. */
const PROOF: { demo: string; match: string; t: string; d: string }[] = [
  { demo: '1', match: 'register eERC key', t: 'Key registered', d: 'Groth16 proof made in the browser' },
  { demo: '1', match: 'top up private balance', t: 'Private balance topped up', d: 'tUSDC into eERC, public amount' },
  { demo: '1', match: 'private payment', t: 'Paid a shop privately', d: 'Amount encrypted on chain' },
  { demo: '2', match: 'lock 0.01 tWBTC', t: 'Collateral in', d: '0.01 tWBTC at Chainlink BTC / USD' },
  { demo: '2', match: 'borrow', t: 'Borrowed on credit', d: '36 tUSDC from NorenCredit' },
  { demo: '2', match: 'private payment', t: 'Paid on credit, privately', d: 'Credit moved through eERC' },
  { demo: '3', match: 'withdraw private revenue', t: 'Shop withdrew revenue', d: 'Decrypted in its own browser' },
  { demo: '5', match: 'repay in full', t: 'Repaid in full', d: 'The credit line closed' },
];
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
  const ref = useReveal();
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
  const batches = useLoad(() => (hasHub(D) ? readBatches(pub as never, D as never) : Promise.resolve([])), []);
  shops.data?.forEach((s) => setName(s.owner, s.name));
  const steps = useMemo(() => PROOF.map((p) => ({ ...p, tx: DEMO[p.demo]?.txs.find((t) => t.what.startsWith(p.match)) })).filter((p) => p.tx), []);
  const pct = latest.data?.last?.args.auditorPCT as readonly bigint[] | undefined;
  const pr = prices.data;
  const lastBatch = batches.data?.[0];
  const util = pool.data ? (Number(pool.data.totalDebt) / Math.max(1, Number(pool.data.totalDebt + pool.data.liquidity))) * 100 : null;

  return (
    <div className="lp nl" ref={ref}>
      <header className="site-nav solid nl-nav">
        <a className="site-brand" {...linkProps('/')}>
          <Logo size={26} />
          <span>Noren</span>
          <span className="nl-ed mono">Avalanche</span>
        </a>
        <nav className="mono">
          <a href="#views">Two views</a>
          <a href="#how">How it works</a>
          <a href="#proof">Fuji proof</a>
          <a {...linkProps('/merchant')}>Merchant</a>
        </nav>
        <a className="lx-btn light sm" {...linkProps('/shop/harbor-loom')}>
          Open app <Icon.arrow />
        </a>
      </header>

      <section className="lx-hero nl-hero">
        <GlyphField />
        <div className="lx-hero-in">
          <span className="lx-pill mono">
            <i />
            Avalanche Speedrun edition · live on Fuji
          </span>
          <h1>
            Let customers pay <em>privately.</em>
          </h1>
          <p>For shops that take crypto. Customers pay in stablecoins, or on credit against their bitcoin. The public chain never shows which shop they paid or what a shop earned: you, your accountant and the auditor read that. Settled on Avalanche with eERC, its encrypted token.</p>
          <div className="lx-ctas">
            <a className="lx-btn light" {...linkProps('/shop/harbor-loom')}>
              Try the checkout
            </a>
            <a className="lx-btn dark" {...linkProps('/merchant')}>
              Merchant dashboard
            </a>
          </div>
        </div>
        <div className="lx-horizon" aria-hidden />
      </section>

      <section className="nx-live" aria-label="Recorded on Avalanche Fuji">
        <div className="nx-live-in">
          <span className="nx-live-h mono">
            <i aria-hidden />
            One customer, one shop, signed on Avalanche Fuji
          </span>
          <ul>
            {steps.map((p) => (
              <li key={p.demo + p.match}>
                <a href={txUrl(p.tx!.hash)} target="_blank" rel="noreferrer">
                  <span className="nl-dot success" aria-hidden>
                    <Icon.check />
                  </span>
                  <span>
                    <b>{p.t}</b>
                    <small>
                      {p.d} · <span className="mono">{shortHash(p.tx!.hash)}</span>
                    </small>
                  </span>
                  <Icon.ext />
                </a>
              </li>
            ))}
          </ul>
          <p className="mono">Each card opens the transaction on testnet.snowtrace.io. The full run is in deployments/fuji.json.</p>
        </div>
      </section>

      <section className="nx-sec" id="views">
        <div className="nx-head split" data-reveal>
          <div>
            <Tag>The same payment, two views</Tag>
            <h2>
              Paid on chain. <span>Readable only by the shop.</span>
            </h2>
          </div>
          <p>The latest private payment on Fuji, read live from the eERC contract when this page loaded.</p>
        </div>
        <div className="nl-coins na-views" data-reveal>
          <article className="nl-coin">
            <header>
              <Art3d k="shield" size={44} />
              <span>
                <b>What Snowtrace sees</b>
                <small className="mono">PrivateTransfer · {latest.data?.last ? ago(latest.data.last.time, now) : '…'}</small>
              </span>
            </header>
            {latest.data?.last ? (
              <dl className="na-ev mono">
                <div>
                  <dt>from</dt>
                  <dd>{nameOf(latest.data.last.args.from as string)}</dd>
                </div>
                <div>
                  <dt>to</dt>
                  <dd>{nameOf(latest.data.last.args.to as string)}</dd>
                </div>
                <div>
                  <dt>amount</dt>
                  <dd className="na-cipher">
                    {pct?.slice(0, 3).map((w, i) => (
                      <span key={i}>{`0x${w.toString(16).padStart(64, '0').slice(0, 22)}…`}</span>
                    ))}
                  </dd>
                </div>
              </dl>
            ) : (
              <p>{latest.error ?? (latest.data ? 'No private payment yet. Make the first one from the checkout.' : 'Reading eERC logs on Fuji…')}</p>
            )}
            <footer className="mono">{latest.data?.last ? <a href={txUrl(latest.data.last.transactionHash!)} target="_blank" rel="noreferrer">Open the transaction ↗</a> : '—'}</footer>
          </article>
          <article className="nl-coin">
            <header>
              <Art3d k="receipt" size={44} />
              <span>
                <b>What the shop sees</b>
                <small className="mono">Decrypted in its browser</small>
              </span>
            </header>
            <strong>The amount and the order.</strong>
            <p>Decrypted with the shop’s own key. Its accountant gets a statement too; the auditor key can check every payment. Nobody else can read it.</p>
            <footer className="mono na-foot-links">
              <a {...linkProps('/merchant')}>Merchant tab →</a>
              <a {...linkProps('/auditor')}>Auditor tab →</a>
            </footer>
          </article>
        </div>
        <p className="nx-legend" data-reveal>
          <Chip s="live" />
          <span>{latest.data ? `${latest.data.count} private payments on Fuji since the deploy block. ${shops.data ? `${shops.data.length} shops on NorenMerchants.` : ''}` : latest.error ?? 'Reading the eERC contract…'}</span>
        </p>
      </section>

      <section className="nx-sec" id="how">
        <div className="nx-head" data-reveal>
          <Tag>How it works</Tag>
          <h2>
            Four steps. <span>Pay privately, borrow if you need to, settle in batches, keep the books.</span>
          </h2>
        </div>
        <ol className="nl-how">
          {[
            { n: '01', a: 'shield' as Art3dKey, t: 'Pay from a private balance', s: ['live', 'proof'] as Status[], d: 'Top up once with public tUSDC, then pay any Noren shop. Each payment is a zero-knowledge proof made in your browser; the amount is an eERC ciphertext.' },
            { n: '02', a: 'btc-coin' as Art3dKey, t: 'Or pay on credit', s: ['live', 'test'] as Status[], d: 'Lock tWBTC or AVAX in NorenCredit, borrow tUSDC at Chainlink prices and pay in the same flow. Borrowing is public; the payment is not.' },
            { n: '03', a: 'hourglass' as Art3dKey, t: 'The hub pays shops in batches', s: ['live'] as Status[], d: 'Customers pay Noren’s hub. Every few minutes it pays each shop from one account, with zero-value cover payouts, and records each statement’s hash in NorenSettlement.' },
            { n: '04', a: 'receipt' as Art3dKey, t: 'Books that still balance', s: ['live'] as Status[], d: 'The shop decrypts its orders, its accountant reads statements encrypted to their key, and the auditor checks every batch: in equals out.' },
          ].map((x, i) => (
            <li key={x.n} data-reveal style={{ transitionDelay: `${i * 70}ms` }}>
              <div className="nl-step-top">
                <span className="nx-num mono">{x.n}</span>
                <Art3d k={x.a} size={88} />
              </div>
              <h3>{x.t}</h3>
              <p>{x.d}</p>
              <div className="nl-chips">
                {x.s.map((s) => (
                  <Chip key={s} s={s} />
                ))}
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="nx-sec" id="batches">
        <div className="nl-melt" data-reveal>
          <div className="nl-melt-copy">
            <div className="nl-melt-top">
              <Tag>Settled by the hub</Tag>
              <Art3d k="calendar" size={84} />
            </div>
            <h2>{lastBatch ? `Batch #${lastBatch.batchId}` : batches.error ? 'Unavailable' : batches.data ? 'No batch yet' : 'Reading…'}</h2>
            <p>
              {lastBatch
                ? `Settled ${ago(lastBatch.at, now)}: ${lastBatch.payments.length} payment${lastBatch.payments.length === 1 ? '' : 's'} in, ${lastBatch.payoutTxs.length} shop payouts out. Snowtrace sees customers pay one hub account and the hub pay shops, never which payment went where.`
                : 'Customers pay one hub account; the hub pays every shop in the next batch.'}
            </p>
            <p>
              Hub account{' '}
              {DX.hub ? (
                <a className="mono" href={addressUrl(DX.hub)} target="_blank" rel="noreferrer">
                  {short(DX.hub)}
                </a>
              ) : (
                '—'
              )}
              . Batch records live in NorenSettlement.
            </p>
            <div className="nl-chips">
              <Chip s="live" />
            </div>
          </div>
          <div className="nl-melt-chart">
            {batches.data && batches.data.length > 0 ? (
              <ul className="na-night-list">
                {batches.data.slice(0, 5).map((b) => (
                  <li key={b.batchId}>
                    <a href={txUrl(b.tx)} target="_blank" rel="noreferrer">
                      <b>#{b.batchId}</b>
                      <span>
                        {b.payments.length} in · {b.payoutTxs.length} out
                      </span>
                      <small className="mono">{ago(b.at, now)}</small>
                      <Icon.ext />
                    </a>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="nl-wait mono">{batches.error ?? 'Reading NorenSettlement…'}</div>
            )}
          </div>
        </div>
      </section>

      <section className="nx-sec" id="proof">
        <div className="nx-head split" data-reveal>
          <div>
            <Tag>Live from the contracts</Tag>
            <h2>
              Read from Avalanche Fuji <span>when this page loaded.</span>
            </h2>
          </div>
          <p>
            <a className="mono" href={`${addressUrl(D.norenCredit)}#code`} target="_blank" rel="noreferrer">
              NorenCredit {short(D.norenCredit)}
            </a>{' '}
            and the eERC contract. Prices refresh every 60 s.
          </p>
        </div>
        <div className="nx-num-grid" data-reveal>
          <div>
            <b>{latest.data ? latest.data.count : '—'}</b>
            <span>private payments on Fuji, amounts encrypted</span>
          </div>
          <div>
            <b>{pool.data ? usd(u6(pool.data.liquidity), 0) : '—'}</b>
            <span>tUSDC ready to lend in the pool</span>
          </div>
          <div>
            <b>
              {pool.data ? Number(pool.data.aprBps) / 100 : '—'}
              <em>% APR</em>
            </b>
            <span>borrow rate, {util != null ? `${util.toFixed(1)}% utilised` : 'accrued per second'}</span>
          </div>
          <div>
            <b>{pr ? usd(u8(pr.btc), 0) : '—'}</b>
            <span>BTC / USD from Chainlink{pr ? `, ${ago(pr.btcUpdatedAt, now)}` : ''}</span>
          </div>
          <div>
            <b>{pr ? usd(u8(pr.avax)) : '—'}</b>
            <span>AVAX / USD from Chainlink{pr ? `, ${ago(pr.avaxUpdatedAt, now)}` : ''}</span>
          </div>
          <div>
            <b>{batches.data ? batches.data.length : '—'}</b>
            <span>settlement batches recorded by the hub</span>
          </div>
        </div>
        <div className="nl-coins na-contracts" data-reveal>
          {CONTRACTS.filter(([, a]) => !!a).map(([n, a, d, code]) => (
            <a key={n} className="nl-coin" href={`${addressUrl(a!)}${code ? '#code' : ''}`} target="_blank" rel="noreferrer">
              <header>
                {n.startsWith('Noren') ? <Logo size={32} /> : <Mark id={n === 'tUSDC' ? 'USDC' : n === 'tWBTC' ? 'BTC' : 'AVAX'} size={32} />}
                <span>
                  <b>{n}</b>
                  <small className="mono">{code ? 'verified on Snowtrace' : 'account'}</small>
                </span>
              </header>
              <p>{d}</p>
              <footer className="mono">{`${a!.slice(0, 10)}…${a!.slice(-6)}`}</footer>
            </a>
          ))}
        </div>
        <p className="nx-note mono" data-reveal>
          {prices.error || pool.error ? `Read error: ${prices.error ?? pool.error}` : pr?.stale ? pr.stale : pr ? 'Chainlink prices fresh: credit open.' : 'Reading Chainlink…'}
        </p>
      </section>

      <section className="nx-built">
        <div className="nx-built-in">
          <div className="nx-head nl-head-3d" data-reveal>
            <div>
              <Tag dark>What Avalanche does here</Tag>
              <h2>
                The Avalanche pieces doing the work. <span>Named, with what each one is for.</span>
              </h2>
            </div>
            <Art3d k="shield" size={128} />
          </div>
          <ul className="nx-built-list">
            {[
              { b: 'eERC, converter mode', p: 'Ava Labs’ encrypted ERC-20 wraps test USDC. Balances and transfer amounts are ElGamal ciphertexts; each transfer also carries a copy for the auditor key.', s: 'live' as Status },
              { b: 'Groth16 proofs in the browser', p: 'Registering, paying and withdrawing each need a zero-knowledge proof. The circuits are served by this site and the proofs are made on your device.', s: 'proof' as Status },
              { b: 'Chainlink Data Feeds on Fuji', p: 'NorenCredit prices tWBTC with BTC / USD and AVAX with AVAX / USD, and refuses new credit on a price older than 25 hours.', s: 'live' as Status },
              { b: 'NorenSettlement', p: 'The hub records each batch: the payments it consumed, every payout, a statement digest per shop and the auditor’s copy.', s: 'live' as Status },
              { b: 'NorenGasStation', p: 'A new wallet signs one message and Noren’s relayer sends gas, 100 tUSDC and 0.01 tWBTC. No faucet, no captcha.', s: 'live' as Status },
              { b: 'Snowtrace verified contracts', p: 'Every Noren contract is verified, and every screen links to the transaction it shows.', s: 'live' as Status },
            ].map((x) => (
              <li key={x.b} data-reveal>
                <b>{x.b}</b>
                <p>{x.p}</p>
                <Chip s={x.s} />
              </li>
            ))}
          </ul>
          <p className="nx-built-foot mono">This entry runs on Avalanche Fuji with test tokens. Top-ups, borrowing and withdrawals are public; payments are not.</p>
        </div>
      </section>

      <section className="nx-cta">
        <Art3d k="stall" size={150} />
        <h2>Take your first private payment.</h2>
        <p>Open a shop, share the checkout link, and read your revenue where only you can. The test wallet needs nothing installed.</p>
        <pre className="mono">{`pnpm test:contracts\npnpm test:anvil\npnpm build`}</pre>
        <div className="lx-ctas">
          <a className="lx-btn light" {...linkProps('/merchant')}>
            Open a shop
          </a>
          <a className="lx-btn dark" {...linkProps('/shop/harbor-loom')}>
            Pay Harbor &amp; Loom
          </a>
        </div>
        <p className="nl-setup mono">Fuji test tokens only: tUSDC and tWBTC have no value.</p>
      </section>
    </div>
  );
}
