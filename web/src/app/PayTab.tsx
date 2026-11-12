import { useMemo, useState } from 'react';
import { erc20Abi, verifyMessage, type Abi, type Hex } from 'viem';
import { hasHub, hubNote, norenCreditAbi, norenTokenAbi, readPosition, readShops, readWallet, receiptText, settledIn, type Shop } from '@noren-avax/sdk';
import { api, getStarterPack, saveClaim, type HubStatus, type Receipt } from '../lib/api';
import { D, pub, readable, setName } from '../lib/chain';
import { useLoad, useNow } from '../lib/hooks';
import { go, linkProps } from '../lib/router';
import { announceTx, isUnlocked, privateSession, unlock, useSignerVersion, useWho, write } from '../lib/signer';
import { Icon } from '../ui/nk/brand';
import { Art3d } from '../ui/nk/Art3d';
import { Mark } from '../ui/nk/marks';
import { Card, Empty, Pill, Row, TxBtn, shortHash, u6, usd } from './common';
import { StarterCard } from './CreditSheet';
import { CustomerSide } from './Side';
import type { Market } from './market';

type Method = 'private' | 'credit';
type Plan = { key: string; title: string; detail: string; needed: () => Promise<boolean>; run: () => Promise<Hex | null> };
type StepState = 'todo' | 'run' | 'done' | 'fail' | 'skip';
type Step = { key: string; title: string; detail: string; state: StepState; hash?: string; error?: string };
type Paid = { hash: Hex; cents: bigint; item: string; method: Method; order: string; claim: string; shop: string };

const usdcOf = (c: bigint) => c * 10_000n;
const orderId = () => Math.random().toString(36).slice(2, 8).toUpperCase();
const claimSecret = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
const VIA_HUB = hasHub(D);
const hhmm = (sec: number) => new Date(sec * 1000).toISOString().slice(11, 16);
const t2 = (c: bigint) => (Number(c) / 100).toFixed(2);
type Demo = { title: string; txs: { hash: Hex; what: string }[] };
const RECORDED = Object.values((D as unknown as { demo?: Record<string, Demo> }).demo ?? {}).find((d) => d.txs.some((t) => t.what.startsWith('private payment')) && !/credit/i.test(d.title));

export function PayTab({ slug, market }: { slug: string; market: Market }) {
  const who = useWho();
  const ver = useSignerVersion();
  const shops = useLoad(() => readShops(pub as never, D), []);
  shops.data?.forEach((s) => setName(s.owner, s.name));
  const shop: Shop | undefined = shops.data?.find((s) => s.slug === slug);
  const items = shop?.items.filter((i) => i.active) ?? [];
  const [itemId, setItemId] = useState(0);
  const item = items.find((i) => i.id === itemId) ?? items[0];
  const [method, setMethod] = useState<Method>('private');
  const [steps, setSteps] = useState<Step[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [paid, setPaid] = useState<Paid | null>(null);

  const acct = useLoad(
    async () => {
      if (!who) return null;
      const p = privateSession();
      const [wallet, registered, position] = await Promise.all([
        readWallet(pub as never, D, who.address),
        p.isRegistered(),
        readPosition(pub as never, D, who.address).catch((e) => ({ error: readable(e) })),
      ]);
      const priv = isUnlocked() && registered ? (await p.balance()).cents : null;
      return { wallet, registered, position, priv };
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
    const payee = VIA_HUB ? D.hub! : shop.owner;
    const memo = VIA_HUB ? hubNote({ shopId: shop.id, order, claim, item: item.name }) : `${item.name} · order ${order}`;
    const common: Plan[] = [
      {
        key: 'pack',
        title: 'Get test funds',
        detail: 'NorenGasStation sends gas, 100 tUSDC and 0.01 tWBTC in one transaction',
        needed: async () => VIA_HUB && (await pub.getBalance({ address: who.address })) === 0n,
        run: () => getStarterPack(who.address),
      },
      {
        key: 'unlock',
        title: 'Unlock your private balance',
        detail: 'One signature; your eERC key is derived from it and stays in this tab',
        needed: async () => !isUnlocked(),
        run: async () => {
          await unlock();
          return null;
        },
      },
      {
        key: 'register',
        title: 'Register for private payments',
        detail: 'A zero-knowledge proof made on this device registers your eERC key',
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
      detail: VIA_HUB ? `A proof made here sends ${t2(price)} tUSDC, encrypted, to Noren’s hub; only the hub learns the shop` : `A proof made here sends ${t2(price)} tUSDC as an encrypted amount`,
      needed: async () => true,
      run: async () => {
        const h = await p().pay(payee, price, memo);
        announceTx(h, VIA_HUB ? `private payment via Noren for ${shop.name}` : `private payment to ${shop.name}`);
        if (VIA_HUB) saveClaim(h, claim, { shop: shop.name, item: item.name, cents: String(price), order });
        setPaid({ hash: h, cents: price, item: item.name, method, order, claim, shop: shop.name });
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
          detail: 'Draws 250 test tUSDC from the faucet (once a day)',
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
          detail: 'Moves public tUSDC into eERC. The top-up is public; payments from it are not',
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
        detail: 'Locks tWBTC in NorenCredit, priced by Chainlink BTC / USD',
        needed: async () => (await readPosition(pub as never, D, who.address)).available < usdcOf(price),
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
        title: `Borrow ${t2(price)} tUSDC on credit`,
        detail: 'NorenCredit checks the Chainlink price is fresh and your limit holds',
        needed: async () => true,
        run: () => write(D.norenCredit, norenCreditAbi as Abi, 'borrow', [usdcOf(price), who.address], `borrow ${t2(price)} tUSDC`),
      },
      {
        key: 'shield',
        title: 'Move the credit into your private balance',
        detail: 'Deposits the borrowed tUSDC into eERC so the payment is encrypted',
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
    setPaid(null);
    const st: Step[] = plan.map((s) => ({ key: s.key, title: s.title, detail: s.detail, state: 'todo' }));
    setSteps([...st]);
    for (let i = 0; i < plan.length; i++) {
      st[i] = { ...st[i]!, state: 'run' };
      setSteps([...st]);
      try {
        if (!(await plan[i]!.needed())) st[i] = { ...st[i]!, state: 'skip' };
        else {
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
    setTimeout(acct.reload, 2500);
  }

  const recordedPay = RECORDED?.txs.find((t) => t.what.startsWith('private payment'));
  const avail = method === 'credit' ? (position ? `${usd(u6(position.available))} credit available` : positionErr ? 'Credit paused' : who ? '…' : '—') : acct.data?.priv != null ? `${usd(Number(acct.data.priv) / 100)} private` : who ? (acct.data && !acct.data.registered ? 'Private balance not set up' : 'Private balance locked') : '—';

  return (
    <>
      <div className="nk-home-main">
        <Card
          title="Pay a shop, privately"
          art="stall"
          sub="Pay from a private tUSDC balance or on credit against your coins. Snowtrace never sees the amount."
          pill={<Pill>{who ? who.label : 'Avalanche Fuji'}</Pill>}
        >
          {shops.error && <div className="nk-pad"><p className="nk-err">Couldn’t read the shops from Fuji: {shops.error}</p></div>}
          {shops.data && !shop ? (
            <Empty art="warning" title={`No shop on Fuji uses “${slug}”`} action={<a className="nk-btn" {...linkProps('/shop/harbor-loom')}>Pay Harbor &amp; Loom</a>}>
              Pick a shop that exists on NorenMerchants.
            </Empty>
          ) : (
            <>
              <div className="nk-band" role="radiogroup" aria-label="Pay with">
                <span>Pay with</span>
                {(['private', 'credit'] as const).map((m) => (
                  <button key={m} type="button" role="radio" aria-checked={method === m} aria-pressed={method === m} disabled={busy} onClick={() => setMethod(m)}>
                    {m === 'private' ? 'Private balance' : 'Credit'}
                  </button>
                ))}
              </div>
              <div className="nk-pad">
                <div className="nk-box" style={{ marginTop: 10 }}>
                  <label htmlFor="na-amt">
                    <span>Amount</span>
                    <span className="mono">{avail}</span>
                  </label>
                  <div className="nk-row">
                    <output id="na-amt" aria-label="Amount in tUSDC">{item ? t2(item.priceCents) : shops.loading ? '…' : '—'}</output>
                    <span className="nk-token" data-static="true">
                      <Mark id="USDC" size={28} />
                      tUSDC
                    </span>
                  </div>
                  <div className="nk-sub">
                    <span>{method === 'credit' ? 'Borrowed against tWBTC, then paid encrypted' : 'Paid as encrypted tUSDC on Avalanche Fuji'}</span>
                    {who && acct.data ? <span>Wallet {usd(u6(acct.data.wallet.usdc))} public</span> : <span />}
                  </div>
                </div>
                <div className="nk-box">
                  <label htmlFor="na-shop">
                    <span>Merchant</span>
                    <span className="mono">Noren shop</span>
                  </label>
                  <select id="na-shop" className="nc-addr na-select" value={shop?.slug ?? slug} disabled={busy || !shops.data} onChange={(e) => { setItemId(0); setSteps(null); setPaid(null); go(`/shop/${e.target.value}`); }}>
                    {(shops.data ?? []).map((s) => (
                      <option key={s.id} value={s.slug}>
                        {s.name} · /shop/{s.slug}
                      </option>
                    ))}
                    {!shops.data && <option value={slug}>Reading NorenMerchants…</option>}
                  </select>
                  {items.length > 0 && (
                    <ul className="na-items" role="radiogroup" aria-label="Item">
                      {items.map((it) => (
                        <li key={it.id}>
                          <button type="button" role="radio" aria-checked={it.id === item?.id} disabled={busy} onClick={() => setItemId(it.id)}>
                            <span>{it.name}</span>
                            <b>{t2(it.priceCents)}</b>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  {shop && items.length === 0 && <p className="nc-fine">This shop has not listed anything yet.</p>}
                </div>
                <p className="nc-setup na-setup-tight">
                  <Icon.shield />
                  {VIA_HUB ? (
                    <span>
                      <b>Snowtrace sees you paid Noren. Not which shop, not how much.</b> {shop?.name ?? 'The shop'} is paid from Noren’s hub in the next batch, alongside other shops.
                    </span>
                  ) : (
                    <span>
                      <b>{shop?.name ?? 'The shop'} sees the amount. Snowtrace doesn’t.</b> The amount is an eERC ciphertext only the shop’s and the auditor’s keys open.
                    </span>
                  )}
                </p>
                {who && acct.data && acct.data.wallet.avax === 0n && !busy && !steps && <StarterCard address={who.address} compact />}
                {method === 'credit' && positionErr && <p className="nk-err">Credit is paused: {positionErr}</p>}
                {acct.error && <p className="nk-err">Couldn’t read your balances: {acct.error}</p>}
                <button className="nk-cta" disabled={busy || (!!who && !item)} onClick={() => (who ? run() : market.connect())}>
                  {!who ? 'Connect a wallet to pay' : busy ? 'Working on Fuji…' : item ? `${method === 'credit' ? 'Pay on credit' : 'Pay'} ${t2(item.priceCents)} tUSDC` : 'Pay'}
                </button>
                {steps && <PlanSteps steps={steps} />}
                {paid && (VIA_HUB ? <HubReceipt r={paid} /> : <DirectReceipt r={paid} />)}
                {!paid && RECORDED && recordedPay && (
                  <div className="nc-proof">
                    <b>This exact payment has run on Fuji</b>
                    <p>{RECORDED.title}: a proof made in the browser sent the amount encrypted, so the transaction shows only ciphertext. Connect a wallet to make your own payment above.</p>
                    <TxBtn hash={recordedPay.hash} label={`Open ${shortHash(recordedPay.hash)}`} />
                  </div>
                )}
              </div>
            </>
          )}
        </Card>
      </div>
      <CustomerSide market={market} />
    </>
  );
}

function PlanSteps({ steps }: { steps: Step[] }) {
  return (
    <div className="nc-receipt na-plan" aria-live="polite">
      <ul className="nk-acts">
        {steps.map((s) => (
          <Row
            key={s.key}
            state={s.state === 'done' ? 'success' : s.state === 'fail' ? 'rejected' : s.state === 'run' ? 'run' : s.state === 'skip' ? 'skip' : 'todo'}
            title={s.title}
            sub={s.error ?? (s.state === 'skip' ? 'Already done' : s.detail)}
            right={s.hash ? <a className="r mono" href={`https://testnet.snowtrace.io/tx/${s.hash}`} target="_blank" rel="noreferrer">{shortHash(s.hash)} <Icon.ext /></a> : undefined}
          />
        ))}
      </ul>
      {steps.some((s) => s.error) && <p className="nk-err">{steps.find((s) => s.error)!.error}</p>}
    </div>
  );
}

function DirectReceipt({ r }: { r: Paid }) {
  return (
    <div className="nc-receipt" role="status">
      <div className="nc-receipt-h">
        <Art3d k="success" size={44} />
        <b>Paid {t2(r.cents)} tUSDC to {r.shop}{r.method === 'credit' ? ' on credit' : ''}</b>
      </div>
      <p className="nc-fine">{r.item} · order {r.order}. On Snowtrace this transfer shows only ciphertext; the shop decrypts it in its <a {...linkProps('/merchant')}>Merchant tab</a>.</p>
      <TxBtn hash={r.hash} label="See it on Snowtrace" />
    </div>
  );
}

/** Queued, then settled in a batch (read from NorenSettlement), with the hub's signed receipt. */
function HubReceipt({ r }: { r: Paid }) {
  const now = useNow(1000);
  const hub = useLoad(() => api<HubStatus>('/hub'), [], 15_000);
  const batch = useLoad(() => settledIn(pub as never, D as never, r.hash), [r.hash], 10_000);
  const rec = useLoad(
    async () => {
      const x = await api<Receipt | { status: 'unseen' }>('/receipt', { tx: r.hash, claim: r.claim });
      if (!('signature' in x)) return null;
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
    <div className="nc-receipt" role="status" aria-live="polite">
      <div className="nc-receipt-h">
        <Art3d k={settled ? 'success' : 'hourglass'} size={44} />
        <b>
          Paid {t2(r.cents)} tUSDC {r.method === 'credit' ? 'on credit ' : ''}for {r.shop}
        </b>
        <Pill tone={settled ? 'live' : 'warn'}>{settled ? `Settled · batch #${batch.data}` : 'Queued'}</Pill>
      </div>
      <dl>
        <div>
          <dt>Order</dt>
          <dd>
            {r.item} <small>· {r.order}</small>
          </dd>
        </div>
        <div>
          <dt>Shop payout</dt>
          <dd>
            {settled ? (
              <>In batch #{batch.data}{rec.data?.payoutTx ? ', with other shops' : ''}</>
            ) : next ? (
              left === 0 ? (
                'The hub is paying this batch now'
              ) : (
                <>Next batch {hhmm(next)} UTC{left != null && left < 600 ? <small> · in {Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}</small> : null}</>
              )
            ) : hub.error ? (
              <small>Hub status unavailable; the payment is safe on chain</small>
            ) : (
              'Waiting for the next batch'
            )}
          </dd>
        </div>
        <div>
          <dt>Receipt</dt>
          <dd>{rec.data?.verified ? 'Signed by the hub ✓' : rec.error ? <small>Unavailable</small> : <small>Waiting for the hub</small>}</dd>
        </div>
      </dl>
      <div className="na-btns" style={{ marginTop: 12 }}>
        <TxBtn hash={r.hash} label="Your payment" />
        {rec.data?.payoutTx && <TxBtn hash={rec.data.payoutTx} label="Shop payout" />}
      </div>
    </div>
  );
}
