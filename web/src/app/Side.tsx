import { formatEther, parseAbiItem, type Hex } from 'viem';
import { AVAX, addressUrl, depositEvent, privateTransferEvent, scanLogs } from '@noren-avax/sdk';
import { D, nameOf, pub } from '../lib/chain';
import { ago, useLoad, useNow } from '../lib/hooks';
import { useSignerVersion, useWho } from '../lib/signer';
import { Icon } from '../ui/nk/brand';
import { Card, Empty, Pill, Row, TxRef, cap, short, u6, u8, usd } from './common';
import type { Market } from './market';

const creditEvents = [
  parseAbiItem('event CollateralDeposited(address indexed user, address indexed asset, uint256 amount)'),
  parseAbiItem('event CollateralWithdrawn(address indexed user, address indexed asset, uint256 amount)'),
  parseAbiItem('event Borrowed(address indexed user, address indexed to, uint256 amount, uint256 debt)'),
  parseAbiItem('event Repaid(address indexed payer, address indexed user, uint256 amount, uint256 debt)'),
] as const;

type Demo = { title: string; as: string; at: string; txs: { hash: Hex; what: string }[] };
const DEMO = Object.values(((D as unknown as { demo?: Record<string, Demo> }).demo ?? {}) as Record<string, Demo>);

/** Customer tabs' right column: the credit contract card and this wallet's activity. */
export function CustomerSide({ market }: { market: Market }) {
  return (
    <aside className="nk-home-side">
      <ContractCard market={market} />
      <Activity />
    </aside>
  );
}

export function ContractCard({ market }: { market: Market }) {
  const now = useNow(15_000);
  const { prices, pool } = market;
  const p = pool.data;
  const util = p ? (Number(p.totalDebt) / Math.max(1, Number(p.totalDebt + p.liquidity))) * 100 : null;
  const pr = prices.data;
  return (
    <Card
      title="The contract"
      art="price-tag"
      sub={
        <a className="mono" href={`${addressUrl(D.norenCredit)}#code`} target="_blank" rel="noreferrer">
          {short(D.norenCredit)}
        </a>
      }
      pill={<Pill tone={pool.error ? 'bad' : 'live'}>{pool.error ? 'Read error' : pool.loading && !p ? 'Loading' : 'Live'}</Pill>}
    >
      {pool.error && <p className="nk-err">{pool.error}</p>}
      <div className="nk-stats nc-side-stats">
        <div className="nk-stat">
          <small>Pool available</small>
          <b>{p ? usd(u6(p.liquidity), 0) : '—'}</b>
        </div>
        <div className="nk-stat">
          <small>Utilisation</small>
          <b>{util != null ? `${util.toFixed(1)}%` : '—'}</b>
        </div>
        <div className="nk-stat">
          <small>BTC price</small>
          <b>{pr ? usd(u8(pr.btc), 0) : '—'}</b>
        </div>
        <div className="nk-stat">
          <small>Updated</small>
          <b className={pr?.stale ? 'warn' : 'ok'}>{pr ? ago(pr.btcUpdatedAt, now) : '—'}</b>
        </div>
      </div>
      <p className="nc-fine">
        {prices.error ? (
          `Price read error: ${prices.error}`
        ) : pr ? (
          <>
            <a href="https://docs.chain.link/data-feeds/price-feeds/addresses?network=avalanche&page=1" target="_blank" rel="noreferrer">
              Chainlink BTC / USD
            </a>{' '}
            and AVAX / USD ({usd(u8(pr.avax))}) on Fuji, read by the contract. {pr.stale ?? 'Older than 25 h blocks new credit.'}
          </>
        ) : (
          'Reading Chainlink…'
        )}
      </p>
    </Card>
  );
}

type Act = { hash: Hex; title: string; sub: string; at: number; kind?: string };

export function Activity() {
  const who = useWho();
  const ver = useSignerVersion();
  const now = useNow();
  const acts = useLoad<Act[] | null>(async () => {
    if (!who) return null;
    const from = BigInt(D.deployBlock);
    const [credit, sent, tops] = await Promise.all([
      Promise.all(creditEvents.map((ev) => scanLogs(pub as never, { address: D.norenCredit, event: ev, args: { user: who.address }, fromBlock: from }))),
      scanLogs(pub as never, { address: D.encryptedERC, event: privateTransferEvent, args: { from: who.address }, fromBlock: from }),
      scanLogs(pub as never, { address: D.encryptedERC, event: depositEvent, args: { user: who.address }, fromBlock: from }),
    ]);
    const rows = [
      ...credit.flat().map((r) => {
        const a = r.args as Record<string, unknown>;
        const amt = (k: string) => a[k] as bigint;
        const coll = () => ((a.asset as string) === AVAX ? `${formatEther(amt('amount'))} AVAX` : `${Number(amt('amount')) / 1e8} tWBTC`);
        const title =
          r.eventName === 'Borrowed' ? `Borrows ${usd(u6(amt('amount')))} tUSDC` : r.eventName === 'Repaid' ? `Repays ${usd(u6(amt('amount')))} tUSDC` : r.eventName === 'CollateralDeposited' ? `Locks ${coll()}` : `Withdraws ${coll()}`;
        return { r, title, sub: r.eventName === 'Borrowed' ? 'borrow' : r.eventName === 'Repaid' ? 'repay' : r.eventName === 'CollateralDeposited' ? 'depositCollateral' : 'withdrawCollateral', kind: undefined as string | undefined };
      }),
      ...sent.map((r) => ({ r, title: `Private payment to ${nameOf(r.args.to as string)}`, sub: 'eERC transfer · amount encrypted', kind: 'private-pay' })),
      ...tops.map((r) => ({ r, title: 'Tops up the private balance', sub: 'eERC deposit · public amount', kind: 'shield' })),
    ];
    const blocks = [...new Set(rows.map((x) => String(x.r.blockNumber)))];
    const t = new Map<string, number>();
    await Promise.all(blocks.map(async (b) => t.set(b, Number((await pub.getBlock({ blockNumber: BigInt(b) })).timestamp))));
    return rows
      .map((x) => ({ hash: x.r.transactionHash as Hex, title: x.title, sub: x.sub, kind: x.kind, at: t.get(String(x.r.blockNumber)) ?? 0 }))
      .sort((a, b) => b.at - a.at);
  }, [who?.address, ver]);

  const recorded: Act[] = DEMO.flatMap((d) => d.txs.map((tx) => ({ hash: tx.hash, title: cap(tx.what), sub: d.title, at: Date.parse(d.at) / 1000 }))).reverse();
  const list = who ? acts.data : recorded;
  return (
    <Card
      title="Activity"
      sub={who ? `${who.label} on Avalanche Fuji` : 'Recorded on Avalanche Fuji'}
      pill={<Pill>{list ? list.length : '…'}</Pill>}
    >
      {who && acts.error && <p className="nk-err">{acts.error}</p>}
      {who && !acts.data && !acts.error && (
        <ul className="nk-acts nc-acts">
          <Row state="run" title="Reading Fuji logs…" sub="NorenCredit and eERC events for this wallet" />
        </ul>
      )}
      {list && list.length > 0 && (
        <ul className="nk-acts nc-acts">
          {list.slice(0, who ? 12 : 10).map((s) => (
            <Row key={s.hash + s.title} kind={s.kind} title={s.title} sub={who ? `${s.sub} · ${ago(s.at, now)}` : s.sub} right={<TxRef hash={s.hash} />} />
          ))}
        </ul>
      )}
      {who && list && list.length === 0 && (
        <Empty
          title="Nothing on Fuji for this wallet yet"
          action={
            <a className="nk-btn" href={addressUrl(who.address)} target="_blank" rel="noreferrer">
              Open on Snowtrace <Icon.ext />
            </a>
          }
        >
          Pay a shop or lock collateral and each transaction shows up here.
        </Empty>
      )}
    </Card>
  );
}
