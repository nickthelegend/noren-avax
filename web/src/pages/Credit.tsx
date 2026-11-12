import { useState } from 'react';
import { erc20Abi, formatEther, parseEther, parseAbiItem, parseUnits, type Abi } from 'viem';
import { AVAX, norenCreditAbi, norenTokenAbi, readPool, readPosition, readPrices, readWallet, scanLogs } from '@noren-avax/sdk';
import { D, pub, readable } from '../lib/chain';
import { ago, useLoad, useNow } from '../lib/hooks';
import { useWho, write } from '../lib/signer';
import { Art, Money, Note, Skeleton, TxLink } from '../ui/kit';

const usd8 = (v: bigint) => Number(v) / 1e8;
const usd6 = (v: bigint) => Number(v) / 1e6;
const creditEvents = [
  parseAbiItem('event CollateralDeposited(address indexed user, address indexed asset, uint256 amount)'),
  parseAbiItem('event CollateralWithdrawn(address indexed user, address indexed asset, uint256 amount)'),
  parseAbiItem('event Borrowed(address indexed user, address indexed to, uint256 amount, uint256 debt)'),
  parseAbiItem('event Repaid(address indexed payer, address indexed user, uint256 amount, uint256 debt)'),
] as const;

type Act = 'collateral' | 'borrow' | 'repay' | 'withdraw';

export function Credit() {
  const who = useWho();
  const now = useNow(15_000);
  const prices = useLoad(() => readPrices(pub as never, D), [], 60_000);
  const pool = useLoad(() => readPool(pub as never, D), []);
  const acct = useLoad(
    async () => {
      if (!who) return null;
      const [pos, wallet] = await Promise.all([readPosition(pub as never, D, who.address), readWallet(pub as never, D, who.address)]);
      return { pos, wallet };
    },
    [who?.address],
  );
  const activity = useLoad(
    async () => {
      if (!who) return [];
      const lists = await Promise.all(
        creditEvents.map((ev) =>
          scanLogs(pub as never, { address: D.norenCredit, event: ev, args: ev.name === 'Repaid' ? { user: who.address } : { user: who.address }, fromBlock: BigInt(D.deployBlock) }),
        ),
      );
      const rows = lists.flat().sort((a, b) => Number(b.blockNumber! - a.blockNumber!));
      const t = new Map<string, number>();
      await Promise.all([...new Set(rows.map((r) => String(r.blockNumber)))].map(async (b) => t.set(b, Number((await pub.getBlock({ blockNumber: BigInt(b) })).timestamp))));
      return rows.map((r) => ({ name: r.eventName, args: r.args as Record<string, unknown>, hash: r.transactionHash!, time: t.get(String(r.blockNumber)) ?? 0 }));
    },
    [who?.address],
  );

  const [tab, setTab] = useState<Act>('collateral');
  const [asset, setAsset] = useState<'btc' | 'avax'>('btc');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<{ hash: string; what: string } | null>(null);

  const p = acct.data?.pos;
  const health = p && p.debt > 0n ? Number(p.health) / 1e18 : null;
  const usedPct = p && p.liquidationValue > 0n ? Math.min(100, (Number(p.debt) / Number(p.liquidationValue)) * 100) : 0;
  const limitPct = p && p.liquidationValue > 0n ? (Number(p.borrowLimit) / Number(p.liquidationValue)) * 100 : 80;

  async function act() {
    if (!who) return;
    setBusy(tab);
    setErr(null);
    setDone(null);
    try {
      let hash: string;
      let what: string;
      if (tab === 'collateral') {
        if (asset === 'btc') {
          const amt = amount.trim() ? parseUnits(amount, 8) : 1_000_000n;
          const w = await readWallet(pub as never, D, who.address);
          if (w.wbtc < amt) await write(D.tWBTC, norenTokenAbi as Abi, 'faucet', [], 'tWBTC faucet');
          const al = await pub.readContract({ address: D.tWBTC, abi: erc20Abi, functionName: 'allowance', args: [who.address, D.norenCredit] });
          if (al < amt) await write(D.tWBTC, erc20Abi as Abi, 'approve', [D.norenCredit, 2n ** 255n], 'approve tWBTC');
          what = `lock ${Number(amt) / 1e8} tWBTC`;
          hash = await write(D.norenCredit, norenCreditAbi as Abi, 'depositCollateral', [D.tWBTC, amt], what);
        } else {
          const amt = parseEther(amount.trim() || '0.005');
          what = `lock ${formatEther(amt)} AVAX`;
          hash = await write(D.norenCredit, norenCreditAbi as Abi, 'depositAvax', [], what, amt);
        }
      } else if (tab === 'borrow') {
        const amt = parseUnits(amount || '0', 6);
        if (amt <= 0n) throw Error('Enter an amount to borrow, like 20.00');
        what = `borrow ${amount} tUSDC`;
        hash = await write(D.norenCredit, norenCreditAbi as Abi, 'borrow', [amt, who.address], what);
      } else if (tab === 'repay') {
        const all = !amount.trim();
        const amt = all ? 2n ** 256n - 1n : parseUnits(amount, 6);
        const debt = (await readPosition(pub as never, D, who.address)).debt;
        const need = all ? debt + debt / 1000n + 10n : amt;
        const w = await readWallet(pub as never, D, who.address);
        if (w.usdc < (all ? debt : amt)) throw Error(`You need ${usd6(all ? debt : amt).toFixed(2)} public tUSDC in this wallet to repay; you have ${usd6(w.usdc).toFixed(2)}.`);
        const al = await pub.readContract({ address: D.tUSDC, abi: erc20Abi, functionName: 'allowance', args: [who.address, D.norenCredit] });
        if (al < need) await write(D.tUSDC, erc20Abi as Abi, 'approve', [D.norenCredit, 2n ** 255n], 'approve tUSDC');
        what = all ? 'repay in full' : `repay ${amount} tUSDC`;
        hash = await write(D.norenCredit, norenCreditAbi as Abi, 'repay', [who.address, amt], what);
      } else {
        const a = asset === 'btc' ? D.tWBTC : AVAX;
        const amt = asset === 'btc' ? parseUnits(amount || '0', 8) : parseEther(amount || '0');
        if (amt <= 0n) throw Error('Enter an amount to withdraw');
        what = `withdraw ${amount} ${asset === 'btc' ? 'tWBTC' : 'AVAX'}`;
        hash = await write(D.norenCredit, norenCreditAbi as Abi, 'withdrawCollateral', [a, amt], what);
      }
      setDone({ hash, what });
      setAmount('');
    } catch (e) {
      setErr(readable(e));
    } finally {
      setBusy(null);
    }
  }

  const pr = prices.data;
  return (
    <main className="wrap dash">
      <div className="credit-grid">
        <div className="credit-main">
          <section className="ccard">
            <div className="ccard-top">
              <span>Credit limit · NorenCredit on Fuji</span>
            </div>
            <div className="ccard-big">{p ? <Money usd={usd6(p.borrowLimit)} /> : who ? <Skeleton w={200} h={56} /> : <Money usd={0} />}</div>
            <p className="ccard-sub">
              {p
                ? p.btc === 0n && p.avax === 0n
                  ? 'No collateral yet. Lock tWBTC or AVAX below to open the line.'
                  : `${[p.btc > 0n ? `${Number(p.btc) / 1e8} tWBTC` : '', p.avax > 0n ? `${Number(formatEther(p.avax)).toFixed(4)} AVAX` : ''].filter(Boolean).join(' + ')}, priced by Chainlink`
                : who
                  ? 'Reading your position…'
                  : 'Connect a wallet to see your line.'}
            </p>
            <div className="ccard-tiles">
              <div>
                <em>Collateral</em>
                <b>{p ? <Money usd={usd6(p.collateralValue)} /> : '—'}</b>
              </div>
              <div>
                <em>Owed</em>
                <b>{p ? <Money usd={usd6(p.debt)} /> : '—'}</b>
              </div>
              <div>
                <em>Available</em>
                <b>{p ? <Money usd={usd6(p.available)} /> : '—'}</b>
              </div>
              <div>
                <em>Health</em>
                <b>{health == null ? (p ? 'No debt' : '—') : `${health.toFixed(2)}×`}</b>
              </div>
            </div>
            <Art name="card" size={150} className="ccard-art" />
          </section>
          {acct.error && <Note tone="bad" art="warning" title="Couldn't read your position">{acct.error}</Note>}

          <section className="card">
            <div className="card-h">
              <div>
                <h2>How much of your coin is spoken for</h2>
                <p className="muted">
                  {p ? `${usd6(p.debt).toFixed(2)} owed of ${usd6(p.liquidationValue).toFixed(2)} at the liquidation line. Liquidation starts when health drops below 1.` : 'Your debt against the liquidation line.'}
                </p>
              </div>
              <Art name="gauge" size={64} />
            </div>
            <div className="hbar" role="img" aria-label={`Debt is ${usedPct.toFixed(0)}% of the liquidation value`}>
              <div className="hbar-fill" style={{ width: `${Math.max(usedPct, p && p.debt > 0n ? 1.5 : 0)}%` }} />
              <div className="hbar-mark" style={{ left: `${limitPct}%` }}>
                <em>Limit</em>
              </div>
              <div className="hbar-mark liq" style={{ left: '100%' }}>
                <em>Liquidation</em>
              </div>
            </div>
          </section>

          <section className="card">
            <div className="tabs" role="tablist">
              {(['collateral', 'borrow', 'repay', 'withdraw'] as Act[]).map((t) => (
                <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => { setTab(t); setErr(null); setDone(null); setAmount(''); }}>
                  {t === 'collateral' ? 'Add collateral' : t === 'borrow' ? 'Borrow' : t === 'repay' ? 'Repay' : 'Withdraw'}
                </button>
              ))}
            </div>
            {(tab === 'collateral' || tab === 'withdraw') && (
              <div className="seg" role="radiogroup" aria-label="Asset">
                <button role="radio" aria-checked={asset === 'btc'} className={asset === 'btc' ? 'on' : ''} onClick={() => setAsset('btc')}>
                  tWBTC
                </button>
                <button role="radio" aria-checked={asset === 'avax'} className={asset === 'avax' ? 'on' : ''} onClick={() => setAsset('avax')}>
                  AVAX
                </button>
              </div>
            )}
            <label className="field">
              <span>
                {tab === 'collateral'
                  ? asset === 'btc'
                    ? 'tWBTC to lock (empty = 0.01 from the faucet)'
                    : 'AVAX to lock (empty = 0.005)'
                  : tab === 'borrow'
                    ? `tUSDC to borrow${p ? ` (up to ${usd6(p.available).toFixed(2)})` : ''}`
                    : tab === 'repay'
                      ? 'tUSDC to repay (empty = everything)'
                      : `${asset === 'btc' ? 'tWBTC' : 'AVAX'} to withdraw`}
              </span>
              <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
            </label>
            <button className="btn btn-dark wide" disabled={!who || !!busy} onClick={act}>
              {busy ? 'Confirming on Fuji…' : tab === 'collateral' ? 'Lock collateral' : tab === 'borrow' ? 'Borrow to my wallet' : tab === 'repay' ? 'Repay' : 'Withdraw collateral'}
            </button>
            {done && (
              <p className="ok-line">
                Done: {done.what} · <TxLink hash={done.hash} />
              </p>
            )}
            {err && <p className="err">{err}</p>}
            {acct.data && (
              <p className="muted small">
                Wallet: {usd6(acct.data.wallet.usdc).toFixed(2)} tUSDC · {(Number(acct.data.wallet.wbtc) / 1e8).toString()} tWBTC · {Number(formatEther(acct.data.wallet.avax)).toFixed(4)} AVAX
              </p>
            )}
          </section>
        </div>

        <aside className="side">
          <section className="card">
            <div className="card-h">
              <h2>Prices</h2>
              <span className={`chip ${pr?.stale ? 'chip-bad' : ''}`}>{pr ? (pr.stale ? 'Stale' : 'Chainlink · live') : 'Loading'}</span>
            </div>
            {prices.error && <Note tone="bad" title="Couldn't read Chainlink">{prices.error}</Note>}
            <ul className="seen">
              <li>
                <span>BTC / USD</span>
                <b>{pr ? <Money usd={usd8(pr.btc)} /> : <Skeleton w={90} />}</b>
              </li>
              <li className="sub-li">
                <span>Updated</span>
                <span>{pr ? ago(pr.btcUpdatedAt, now) : ''}</span>
              </li>
              <li>
                <span>AVAX / USD</span>
                <b>{pr ? <Money usd={usd8(pr.avax)} /> : <Skeleton w={90} />}</b>
              </li>
              <li className="sub-li">
                <span>Updated</span>
                <span>{pr ? ago(pr.avaxUpdatedAt, now) : ''}</span>
              </li>
            </ul>
            {pr?.stale && <p className="err">{pr.stale}</p>}
            <p className="muted small">The contract refuses to lend, release collateral or liquidate on a price older than 25 hours.</p>
          </section>
          <section className="card">
            <div className="card-h">
              <h2>Pool</h2>
            </div>
            <ul className="seen">
              <li>
                <span>Available to lend</span>
                <b>{pool.data ? <Money usd={usd6(pool.data.liquidity)} /> : <Skeleton w={90} />}</b>
              </li>
              <li>
                <span>Lent out</span>
                <b>{pool.data ? <Money usd={usd6(pool.data.totalDebt)} /> : <Skeleton w={90} />}</b>
              </li>
              <li>
                <span>Rate</span>
                <b>{pool.data ? `${Number(pool.data.aprBps) / 100}% APR` : <Skeleton w={60} />}</b>
              </li>
              <li>
                <span>tWBTC · AVAX limits</span>
                <b>60% · 50%</b>
              </li>
            </ul>
          </section>
          <section className="card">
            <div className="card-h">
              <h2>Activity</h2>
            </div>
            {!who && <p className="muted">Connect a wallet to see your credit activity.</p>}
            {who && activity.data && activity.data.length === 0 && <Note art="empty" title="No credit activity yet" />}
            {activity.data && activity.data.length > 0 && (
              <ul className="act">
                {activity.data.slice(0, 8).map((r) => (
                  <li key={r.hash + r.name}>
                    <div>
                      <b>
                        {r.name === 'Borrowed'
                          ? `Borrowed ${usd6(r.args.amount as bigint).toFixed(2)} tUSDC`
                          : r.name === 'Repaid'
                            ? `Repaid ${usd6(r.args.amount as bigint).toFixed(2)} tUSDC`
                            : `${r.name === 'CollateralDeposited' ? 'Locked' : 'Released'} ${(r.args.asset as string) === AVAX ? `${formatEther(r.args.amount as bigint)} AVAX` : `${Number(r.args.amount as bigint) / 1e8} tWBTC`}`}
                      </b>
                      <small>{ago(r.time, now)}</small>
                    </div>
                    <TxLink hash={r.hash} label="tx" />
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>
      </div>
    </main>
  );
}
