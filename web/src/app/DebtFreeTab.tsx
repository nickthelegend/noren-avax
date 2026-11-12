import { useState } from 'react';
import { formatEther } from 'viem';
import { useWho } from '../lib/signer';
import { Art3d } from '../ui/nk/Art3d';
import { Card, Pill, short, u6, usd } from './common';
import { CreditSheet, type CreditAct } from './CreditSheet';
import { useDemoCustomer } from './CreditTab';
import { CustomerSide } from './Side';
import { useAccount, type Market } from './market';

export function DebtFreeTab({ market }: { market: Market }) {
  const who = useWho();
  const acct = useAccount();
  const demo = useDemoCustomer();
  const [sheet, setSheet] = useState<CreditAct | null>(null);
  const p = who ? acct.data?.pos ?? null : demo.data?.pos ?? null;
  const err = who ? acct.data?.posError ?? acct.error : demo.error;
  const owner = who ? who.label : demo.data ? `Demo customer ${short(demo.data.address)}` : 'The demo customer';
  const apr = market.pool.data ? Number(market.pool.data.aprBps) / 100 : null;
  const debt = u6(p?.debt) ?? 0;
  const coll = u6(p?.collateralValue) ?? 0;
  const locked = p ? [p.btc > 0n ? `${Number(p.btc) / 1e8} tWBTC` : '', p.avax > 0n ? `${Number(formatEther(p.avax)).toFixed(4)} AVAX` : ''].filter(Boolean).join(' + ') : '';
  const headline = err ? 'Unavailable' : !p ? 'Reading…' : debt > 0 ? `${usd(debt)} to go` : coll > 0 ? 'Debt-free today' : 'Nothing borrowed';

  return (
    <>
      <div className="nk-home-main">
        <section className="nk-card nc-melt">
          <div className="nk-card-h">
            <div>
              <b>Debt-free</b>
              <p>{owner}: repay the line and the collateral comes back. {who ? '' : 'Connect to see yours.'}</p>
            </div>
            <Pill tone={debt > 0 ? 'warn' : 'live'}>{debt > 0 ? 'Owed' : 'Live'}</Pill>
          </div>
          <div className="nk-pad">
            <div className="nc-date-row">
              <strong className="nc-date">{headline}</strong>
              <Art3d k="calendar" size={96} />
            </div>
            {err && <p className="nk-err">{err}</p>}
            {p && debt > 0 && apr != null && <OwedChart debt={debt} apr={apr} />}
            <div className="nk-stats">
              <div className="nk-stat">
                <small>Interest a year</small>
                <b className="warn">{p && apr != null ? (debt > 0 ? `−${usd((debt * apr) / 100)}` : usd(0)) : '—'}</b>
                <small>{apr != null ? `${apr}% APR on ${usd(debt)}, accrued per second` : 'contract APR'}</small>
              </div>
              <div className="nk-stat">
                <small>Collateral to release</small>
                <b className="ok">{p ? usd(coll) : '—'}</b>
                <small>{locked || 'Nothing locked'}</small>
              </div>
            </div>
          </div>
        </section>

        <Card title="Repay and release" sub="Repay in public tUSDC; repaying works even when a price is stale. Then withdraw what you locked." art="hourglass" pill={<Pill>{who ? who.label : 'Connect to repay'}</Pill>}>
          <div className="nk-pad">
            <ol className="na-steps-num">
              <li>
                <span className="n">1</span>
                <span>
                  <b>Repay {p && debt > 0 ? usd(debt) : 'what you owe'}</b>
                  <small>NorenCredit takes tUSDC from this wallet; any overpayment stays with you.</small>
                </span>
              </li>
              <li>
                <span className="n">2</span>
                <span>
                  <b>Withdraw {locked || 'your collateral'}</b>
                  <small>Back to this wallet once the debt no longer needs it.</small>
                </span>
              </li>
            </ol>
            <button className="nk-cta" onClick={() => (who ? setSheet('repay') : market.connect())} disabled={!!who && !!p && debt === 0}>
              {!who ? 'Connect a wallet to repay' : p && debt === 0 ? 'Nothing owed' : `Repay ${p ? usd(debt) : ''}`.trim()}
            </button>
            <button className="nk-btn na-wide" onClick={() => (who ? setSheet('withdraw') : market.connect())} disabled={!!who && !!p && coll === 0}>
              Withdraw collateral
            </button>
          </div>
        </Card>
      </div>
      <CustomerSide market={market} />
      {sheet && <CreditSheet action={sheet} close={() => setSheet(null)} connect={market.connect} />}
    </>
  );
}

/** What is owed over the next year if nothing is repaid: simple interest at the contract's APR. A projection only. */
function OwedChart({ debt, apr }: { debt: number; apr: number }) {
  const W = 640, H = 200, padL = 8, padR = 8, padT = 18, padB = 28;
  const months = Array.from({ length: 13 }, (_, i) => ({ m: i, v: debt * (1 + (apr / 100) * (i / 12)) }));
  const max = months[12]!.v * 1.04, min = debt * 0.96;
  const x = (m: number) => padL + (m / 12) * (W - padL - padR);
  const y = (v: number) => padT + (1 - (v - min) / (max - min)) * (H - padT - padB);
  const line = months.map((p, i) => `${i ? 'L' : 'M'}${x(p.m).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');
  const area = `${line} L${x(12)},${H - padB} L${x(0)},${H - padB} Z`;
  const t0 = new Date();
  const label = (m: number) => new Date(t0.getFullYear(), t0.getMonth() + m, 1).toLocaleDateString('en-US', { month: 'short', year: m === 0 || m === 12 ? '2-digit' : undefined });
  return (
    <figure className="nm-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Projected debt grows from ${usd(debt)} to ${usd(months[12]!.v)} in a year if nothing is repaid`} preserveAspectRatio="none">
        <defs>
          <linearGradient id="owed" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="currentColor" stopOpacity=".28" />
            <stop offset="1" stopColor="currentColor" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75].map((f) => (
          <line key={f} x1={padL} x2={W - padR} y1={padT + f * (H - padT - padB)} y2={padT + f * (H - padT - padB)} className="nm-grid" />
        ))}
        <path d={area} fill="url(#owed)" />
        <path d={line} className="nm-line" />
        {months.filter((p) => p.m % 3 === 0 && p.m > 0).map((p) => (
          <circle key={p.m} cx={x(p.m)} cy={y(p.v)} r="3" className="nm-dot" />
        ))}
        <circle cx={x(0)} cy={y(debt)} r="5" className="nm-end" />
        {[0, 3, 6, 9, 12].map((m) => (
          <text key={m} x={x(m)} y={H - 8} className="nm-tick" textAnchor={m === 0 ? 'start' : m === 12 ? 'end' : 'middle'}>
            {label(m)}
          </text>
        ))}
      </svg>
      <figcaption>Projection: what is owed if nothing is repaid, at the contract’s {apr}% APR. Repay any time to stop it.</figcaption>
    </figure>
  );
}
