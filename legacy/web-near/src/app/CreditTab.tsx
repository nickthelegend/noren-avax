import { useState } from 'react';
import { formatEther, type Address, type Hex } from 'viem';
import { addressUrl, readPosition, type CreditPosition } from '@noren-avax/sdk';
import { D, pub } from '../lib/chain';
import { ago, useLoad, useNow } from '../lib/hooks';
import { go } from '../lib/router';
import { useWho } from '../lib/signer';
import { Icon } from '../ui/nk/brand';
import { Art3d } from '../ui/nk/Art3d';
import { Mark } from '../ui/nk/marks';
import { Card, Pill, short, u6, u8, usd } from './common';
import { CreditSheet, StarterCard, type CreditAct } from './CreditSheet';
import { CustomerSide } from './Side';
import { readAssetCfg, useAccount, type Market } from './market';

type Demo = { txs: { hash: Hex; what: string }[] };
/** The recorded demo customer (the wallet that borrowed in the judge run), read live while no wallet is connected. */
export function useDemoCustomer() {
  return useLoad(async () => {
    const demo = (D as unknown as { demo?: Record<string, Demo> }).demo ?? {};
    const tx = Object.values(demo).flatMap((d) => d.txs).find((t) => t.what.startsWith('borrow'));
    if (!tx) return null;
    const from = (await pub.getTransaction({ hash: tx.hash })).from as Address;
    return { address: from, pos: await readPosition(pub as never, D, from) };
  }, []);
}

const fmt2 = (n: number | null) => usd(n);
export const healthLabel = (p: CreditPosition) => (p.debt === 0n ? 'No debt' : `${(Number(p.health) / 1e18).toFixed(2)}×`);

export function CreditTab({ market }: { market: Market }) {
  const who = useWho();
  const now = useNow(15_000);
  const acct = useAccount();
  const demo = useDemoCustomer();
  const cfg = useLoad(readAssetCfg, []);
  const [sheet, setSheet] = useState<CreditAct | null>(null);
  const mine = acct.data?.pos ?? null;
  const p = who ? mine : demo.data?.pos ?? null;
  const owner = who ? who.label : demo.data ? `demo customer ${short(demo.data.address)}` : 'the demo customer';
  const pr = market.prices.data;
  const err = who ? acct.data?.posError ?? acct.error : demo.error;
  const coll = u6(p?.collateralValue) ?? 0;
  const held = p ? [p.btc > 0n ? `${Number(p.btc) / 1e8} tWBTC` : '', p.avax > 0n ? `${Number(formatEther(p.avax)).toFixed(4)} AVAX` : ''].filter(Boolean).join(' + ') : '';

  return (
    <>
      <div className="nk-home-main">
        <section className="nk-hero nc-hero" aria-live="polite">
          <small>Credit limit · NorenCredit on Avalanche Fuji</small>
          <b>
            <i>$</i>
            {p ? (u6(p.borrowLimit) ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : err ? '—' : '…'}
          </b>
          <p>
            {err
              ? `Could not read ${owner}: ${err}`
              : !p
                ? who
                  ? 'Reading your position…'
                  : 'Reading the demo customer’s position…'
                : held
                  ? `${held} × Chainlink price × ${cfg.data ? [p.btc > 0n ? `${cfg.data.btc.ltvBps / 100}%` : '', p.avax > 0n ? `${cfg.data.avax.ltvBps / 100}%` : ''].filter(Boolean).join(' / ') + ' LTV' : 'its LTV'}${who ? '' : `. This is ${owner}; connect to see yours.`}`
                  : who
                    ? 'No collateral yet. Lock tWBTC or AVAX to open your line.'
                    : `No collateral on ${owner}. Connect to open your own line.`}
          </p>
          <div className="nc-tiles">
            <span>
              <em>Collateral</em>
              {p ? fmt2(u6(p.collateralValue)) : '—'}
            </span>
            <span>
              <em>Owed</em>
              {p ? fmt2(u6(p.debt)) : '—'}
            </span>
            <span>
              <em>Available</em>
              {p ? fmt2(u6(p.available)) : '—'}
            </span>
            <span>
              <em>Health</em>
              {p ? healthLabel(p) : '—'}
            </span>
          </div>
        </section>

        {who && acct.data && acct.data.wallet.avax === 0n && <StarterCard address={who.address} />}

        {p && coll > 0 && <Meter p={p} stale={!!pr?.stale} />}

        <div className="nk-actions nc-actions">
          <button className="primary" onClick={() => go('/shop/harbor-loom')}>
            <i>
              <Icon.arrow />
            </i>
            <b>Pay anyone</b>
            <small>Privately, or on credit</small>
            <Art3d k="card" size={56} alt="" />
          </button>
          <button onClick={() => setSheet('deposit')}>
            <i>
              <Icon.layers />
            </i>
            <b>Add collateral</b>
            <small>tWBTC or AVAX</small>
            <Art3d k="btc-coin" size={56} alt="" />
          </button>
          <button onClick={() => go('/debt-free')}>
            <i>
              <Icon.chart />
            </i>
            <b>Debt-free</b>
            <small>Repay and release</small>
            <Art3d k="calendar" size={56} alt="" />
          </button>
          <a href={addressUrl(who?.address ?? demo.data?.address ?? D.norenCredit)} target="_blank" rel="noreferrer">
            <i>
              <Icon.ext />
            </i>
            <b>Snowtrace</b>
            <small>{who ? who.label : demo.data ? short(demo.data.address) : 'NorenCredit'}</small>
            <Art3d k="receipt" size={56} alt="" />
          </a>
        </div>

        <Card title="Your collateral" sub={`Chainlink-priced on Fuji. Borrow up to ${cfg.data ? `${cfg.data.btc.ltvBps / 100}% of tWBTC and ${cfg.data.avax.ltvBps / 100}% of AVAX` : 'each asset’s LTV'}.`} pill={<Pill tone={pr?.stale ? 'warn' : 'live'}>{pr?.stale ? 'Price stale' : 'Chainlink'}</Pill>} id="coins">
          <ul className="nc-coins">
            {(
              [
                { k: 'btc', sym: 'tWBTC', name: 'Test WBTC', mark: 'BTC', price: pr ? u8(pr.btc) : null, at: pr?.btcUpdatedAt, amt: p ? Number(p.btc) / 1e8 : 0, c: cfg.data?.btc, pair: 'BTC / USD' },
                { k: 'avax', sym: 'AVAX', name: 'Avalanche', mark: 'AVAX', price: pr ? u8(pr.avax) : null, at: pr?.avaxUpdatedAt, amt: p ? Number(formatEther(p.avax)) : 0, c: cfg.data?.avax, pair: 'AVAX / USD' },
              ] as const
            ).map((c) => (
              <li key={c.k} className={c.amt > 0 ? 'here' : ''}>
                <Mark id={c.mark} size={36} />
                <span>
                  <b>
                    {c.name} <small className="nk-pill">{c.k === 'btc' ? 'testnet stand-in' : 'Fuji native'}</small>
                  </b>
                  <small>{c.price != null ? `${usd(c.price)} · ${c.pair} · ${c.at ? ago(c.at, now) : ''}` : market.prices.error ?? 'Reading Chainlink…'}</small>
                  <small>{c.c ? `${c.c.ltvBps / 100}% LTV · ${c.c.liqBps / 100}% liquidation` : 'Reading the listing…'}</small>
                </span>
                <span className="r">
                  <b>{c.amt > 0 ? (c.k === 'btc' ? c.amt : c.amt.toFixed(4)) : '0'}</b>
                  <small>{c.amt > 0 && c.price != null ? `${usd(c.amt * c.price)} locked` : 'nothing locked'}</small>
                </span>
              </li>
            ))}
            <li>
              <Mark id="USDC" size={36} />
              <span>
                <b>Test USDC</b>
                <small className="mono">{short(D.tUSDC)}</small>
                <small>What you borrow and pay with</small>
              </span>
              <span className="r">
                <b>{market.pool.data ? usd(u6(market.pool.data.liquidity), 0) : '—'}</b>
                <small>in the pool</small>
              </span>
            </li>
          </ul>
          <div className="na-btns na-btns-pad">
            <button className="nk-btn" onClick={() => setSheet('deposit')}>
              Add collateral
            </button>
            <button className="nk-btn" onClick={() => setSheet('borrow')}>
              Borrow tUSDC
            </button>
            <button className="nk-btn" onClick={() => setSheet('withdraw')}>
              Withdraw
            </button>
          </div>
          <p className="nc-setup">
            <Icon.lock /> Locking collateral and borrowing are public on Fuji. Paying a shop with the credit is not: the amount moves through eERC, encrypted.
          </p>
        </Card>
      </div>
      <CustomerSide market={market} />
      {sheet && <CreditSheet action={sheet} close={() => setSheet(null)} connect={market.connect} />}
    </>
  );
}

export function Meter({ p, stale }: { p: CreditPosition; stale: boolean }) {
  const coll = Number(p.collateralValue) || 1;
  const pct = (x: bigint) => `${Math.min(100, (Number(x) / coll) * 100).toFixed(2)}%`;
  return (
    <section className="nk-card nc-meter">
      <div className="nk-card-h">
        <div className="nc-h3d">
          <Art3d k="gauge" size={56} />
          <div>
            <b>How much of your coin is spoken for</b>
            <p>
              {usd(u6(p.debt))} owed of {usd(u6(p.borrowLimit))} limit. Liquidation starts if the debt passes {usd(u6(p.liquidationValue))}, {((Number(p.liquidationValue) / coll) * 100).toFixed(0)}% of collateral value.
            </p>
          </div>
        </div>
        <Pill tone={stale ? 'warn' : 'live'}>{stale ? 'Price stale' : 'Price fresh'}</Pill>
      </div>
      <div className="nc-bar" role="img" aria-label={`Debt is ${((Number(p.debt) / coll) * 100).toFixed(1)}% of collateral value`}>
        <span className="fill" style={{ width: pct(p.debt) }} />
        <span className="mark ltv" style={{ left: pct(p.borrowLimit) }}>
          <em>Limit</em>
        </span>
        <span className="mark liq" style={{ left: pct(p.liquidationValue) }}>
          <em>Liquidation</em>
        </span>
      </div>
      {stale && <p className="nc-fine">A Chainlink feed is older than the 25-hour limit, so new borrowing is paused until it updates. Repaying always works.</p>}
    </section>
  );
}
