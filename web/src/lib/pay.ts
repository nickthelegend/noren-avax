/**
 * How a customer pays a Noren invoice on Fuji, as a list of steps the checkout shows and runs one by one. Every step is
 * a real transaction or signature; a step that isn't needed (already registered, enough balance…) is skipped.
 *
 * Private by default: every method except "Pay with tUSDC" ends in an eERC transfer to Noren's settlement hub, whose
 * encrypted note names the shop and the invoice. The shop is paid in the hub's next batch and never learns who paid.
 * What stays public is how the private balance was topped up: a tUSDC deposit, a stock sale or a credit plan, each in a
 * round lot of 50 so it doesn't show the price.
 */
import { erc20Abi, maxUint256, stringToHex, type Abi, type Address, type Hex } from 'viem';
import {
  hubNote, norenMerchantsAbi, norenStockCreditAbi, norenStockDeskAbi, norenStockOracleAbi, norenTokenAbi, readWallet, reportFromJson, stockToken, submitArgs,
  type StockSym,
} from '@noren-avax/sdk';
import { api, claimStockPack, getStarterPack, merchant, saveClaim, stockPackClaimed, type Invoice, type Method } from './api';
import { D, pub } from './chain';
import { announceTx, isUnlocked, privateSession, unlock, write } from './signer';

export type StepState = 'todo' | 'run' | 'done' | 'fail' | 'skip';
export type Step = { key: string; title: string; detail: string; state: StepState; hash?: string; error?: string; ms?: number };
export type PlanStep = { key: string; title: string; detail: string; needed: () => Promise<boolean>; run: () => Promise<Hex | null> };
export type Paid = { hash: Hex; cents: bigint; method: Method; order: string; claim: string; proofMs?: number; sold?: { sym: StockSym; amount: bigint; price8: bigint }; plan?: { id: bigint; parts: number } };

export const LOT = 5_000n; // cents: 50 tUSDC
export const lotOf = (c: bigint) => ((c + LOT - 1n) / LOT) * LOT;
const usdcOf = (c: bigint) => c * 10_000n;
const t2 = (c: bigint) => (Number(c) / 100).toFixed(2);
const claimSecret = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
const s6 = (a: bigint, dec = 18, dp = 4) => (Number(a) / 10 ** dec).toLocaleString('en-US', { maximumFractionDigits: dp });

export async function stockBalance(who: Address, sym: StockSym) {
  return (await pub.readContract({ address: stockToken(D, sym), abi: erc20Abi, functionName: 'balanceOf', args: [who] })) as bigint;
}

/** Makes sure NorenStockOracle holds a fresh price; if not, submits the relayer's latest signed report (anyone may). */
async function freshPrice(sym: StockSym): Promise<Hex | null> {
  const [, , , fresh] = (await pub.readContract({ address: D.stockOracle, abi: norenStockOracleAbi, functionName: 'last', args: [stockToken(D, sym)] })) as readonly [bigint, bigint, bigint, boolean];
  if (fresh) return null;
  const p = await api<{ report: Parameters<typeof reportFromJson>[0] }>('/prices');
  return write(D.stockOracle, norenStockOracleAbi as Abi, 'submit', [...submitArgs(reportFromJson(p.report))], 'submit a signed stock price report');
}

export function planFor(opts: { who: Address; inv: Invoice; method: Method; sym: StockSym; onPaid: (p: Paid) => void; onStock?: (s: Paid['sold']) => void }): PlanStep[] {
  const { who, inv, method, sym, onPaid } = opts;
  const price = BigInt(inv.amountCents);
  const p = () => privateSession();
  const claim = claimSecret();
  const desc = inv.description || 'Payment';
  const memo = hubNote({ shopId: inv.shopId, order: inv.id, claim, item: `${method}:${desc}`.slice(0, 64) });
  let sold: Paid['sold'];
  let plan: Paid['plan'];
  let topUp = 0n;

  const pack: PlanStep = {
    key: 'pack', title: 'Get test funds', detail: 'NorenGasStation sends gas, 100 tUSDC and 0.01 tWBTC in one transaction',
    needed: async () => (await pub.getBalance({ address: who })) === 0n,
    run: () => getStarterPack(who),
  };
  const stockPack: PlanStep = {
    key: 'stockpack', title: 'Get test stocks', detail: 'NorenStockStarter: 2 tNVDA, 1 tTSLA, 2 tAAPL, 1 tMSFT, 1 tSPY, once per wallet',
    needed: async () => (await stockBalance(who, sym)) === 0n && !(await stockPackClaimed(who)),
    run: claimStockPack,
  };
  const unlockStep: PlanStep = {
    key: 'unlock', title: 'Unlock your private balance', detail: 'One signature; your eERC key is derived from it and stays in this tab',
    needed: async () => !isUnlocked(),
    run: async () => { await unlock(); return null; },
  };
  const register: PlanStep = {
    key: 'register', title: 'Register for private payments', detail: 'A zero-knowledge proof made on this device registers your eERC key',
    needed: async () => !(await p().isRegistered()),
    run: async () => { const h = await p().register(); if (h) announceTx(h, 'register eERC key'); return h; },
  };
  const short = async () => {
    const bal = (await p().balance()).cents;
    return bal >= price ? 0n : price - bal;
  };
  const shieldLot = (what: string): PlanStep => ({
    key: 'shield', title: 'Move it into your private balance', detail: `Deposits ${what} into eERC; the payment comes out of it, encrypted`,
    needed: async () => topUp > 0n,
    run: async () => {
      const r = await p().shield(usdcOf(topUp));
      if (r.approve) announceTx(r.approve, 'approve tUSDC for eERC');
      announceTx(r.deposit, 'top up private balance');
      return r.deposit;
    },
  });
  const payHub: PlanStep = {
    key: 'pay', title: `Pay ${inv.merchantName} privately`,
    detail: `A proof made here sends ${t2(price)} tUSDC, encrypted, to Noren’s hub; only the hub learns the shop`,
    needed: async () => true,
    run: async () => {
      const t0 = performance.now();
      const h = await p().pay(D.hub!, price, memo);
      const proofMs = performance.now() - t0;
      announceTx(h, `private payment via Noren for ${inv.merchantName}`);
      saveClaim(h, claim, { shop: inv.merchantName, item: desc, cents: String(price), order: inv.id, method });
      onPaid({ hash: h, cents: price, method, order: inv.id, claim, proofMs, sold, plan });
      return h;
    },
  };
  const priv = [pack, unlockStep, register];

  if (method === 'usdc') {
    return [
      pack,
      {
        key: 'faucet', title: 'Get test tUSDC', detail: 'Draws 250 test tUSDC from the faucet (once a day)',
        needed: async () => (await readWallet(pub as never, D, who)).usdc < usdcOf(price),
        run: () => write(D.tUSDC, norenTokenAbi as Abi, 'faucet', [], 'tUSDC faucet'),
      },
      {
        key: 'transfer', title: `Send ${t2(price)} tUSDC to ${inv.merchantName}`, detail: 'A public ERC-20 transfer from your wallet to the shop',
        needed: async () => true,
        run: async () => {
          const shop = (await pub.readContract({ address: D.norenMerchants, abi: norenMerchantsAbi, functionName: 'shop', args: [BigInt(inv.shopId)] })) as { owner: Address };
          const h = await write(D.tUSDC, erc20Abi as Abi, 'transfer', [shop.owner, usdcOf(price)], `tUSDC payment to ${inv.merchantName}`);
          for (let i = 0; ; i++) {
            try { await merchant.paidPublic(inv.id, h); break; } catch (e) {
              // the API reads Fuji itself; a fresh tx can take a few seconds to show there
              if (i >= 8 || !/not found|404/i.test((e as Error).message)) throw e;
              await new Promise((r) => setTimeout(r, 2500));
            }
          }
          onPaid({ hash: h, cents: price, method, order: inv.id, claim });
          return h;
        },
      },
    ];
  }

  if (method === 'private') {
    return [
      ...priv,
      {
        key: 'faucet', title: 'Get test tUSDC', detail: 'Draws 250 test tUSDC from the faucet (once a day)',
        needed: async () => {
          const s = await short();
          if (s === 0n) return false;
          const w = await readWallet(pub as never, D, who);
          return w.usdc < usdcOf(s);
        },
        run: () => write(D.tUSDC, norenTokenAbi as Abi, 'faucet', [], 'tUSDC faucet'),
      },
      {
        key: 'shield', title: 'Top up your private balance', detail: 'Moves public tUSDC into eERC in a round amount. The top-up is public; payments from it are not',
        needed: async () => {
          const s = await short();
          if (s === 0n) return false;
          const w = await readWallet(pub as never, D, who);
          topUp = usdcOf(lotOf(s)) <= w.usdc ? lotOf(s) : s;
          return true;
        },
        run: async () => {
          const r = await p().shield(usdcOf(topUp));
          if (r.approve) announceTx(r.approve, 'approve tUSDC for eERC');
          announceTx(r.deposit, 'top up private balance');
          return r.deposit;
        },
      },
      payHub,
    ];
  }

  if (method === 'stocks') {
    let amountIn = 0n;
    return [
      ...priv,
      stockPack,
      { key: 'price', title: `Fresh ${sym} price`, detail: 'NorenStockOracle needs a signed report under an hour old; submits the relayer’s latest if not', needed: async () => true, run: () => freshPrice(sym) },
      {
        key: 'sell', title: `Sell ${sym} for tUSDC`, detail: 'NorenStockDesk buys it at the oracle price minus 0.5%, in a round lot of 50 tUSDC',
        needed: async () => {
          // Paying with stocks always sells for this payment (a round lot), even if the private balance could cover it.
          topUp = lotOf(price);
          const [inAmt, price8] = (await pub.readContract({ address: D.stockDesk, abi: norenStockDeskAbi, functionName: 'quoteSellIn', args: [stockToken(D, sym), usdcOf(topUp)] })) as readonly [bigint, bigint];
          const have = await stockBalance(who, sym);
          if (have < inAmt) throw Error(`You hold ${s6(have)} t${sym}; this needs ${s6(inAmt)}. Pick another stock.`);
          amountIn = inAmt;
          sold = { sym, amount: inAmt, price8 };
          opts.onStock?.(sold);
          return true;
        },
        run: async () => {
          const allowance = (await pub.readContract({ address: stockToken(D, sym), abi: erc20Abi, functionName: 'allowance', args: [who, D.stockDesk] })) as bigint;
          if (allowance < amountIn) await write(stockToken(D, sym), erc20Abi as Abi, 'approve', [D.stockDesk, maxUint256], `approve t${sym} for the stock desk`);
          return write(D.stockDesk, norenStockDeskAbi as Abi, 'sell', [stockToken(D, sym), amountIn, usdcOf(topUp), who], `sell ${s6(amountIn)} t${sym} for ${t2(topUp)} tUSDC`);
        },
      },
      shieldLot('the tUSDC from the sale'),
      payHub,
    ];
  }

  // credit against stocks: pay in 3 or pay later
  const parts = method === 'payin3' ? 3 : 1;
  let lockAmt = 0n;
  return [
    ...priv,
    stockPack,
    { key: 'price', title: `Fresh ${sym} price`, detail: 'Your limit is priced by NorenStockOracle; submits the relayer’s latest signed report if it is over an hour old', needed: async () => true, run: () => freshPrice(sym) },
    {
      key: 'lock', title: `Lock t${sym} as collateral`, detail: 'Your shares stay yours in NorenStockCredit; the limit is their value × your LTV',
      needed: async () => {
        // Credit always funds this payment (a round lot), even if the private balance could cover it.
        topUp = lotOf(price);
        const owedNew = usdcOf(topUp) + usdcOf(topUp) / 100n;
        const avail = (await pub.readContract({ address: D.stockCredit, abi: norenStockCreditAbi, functionName: 'available', args: [who] })) as bigint;
        if (avail >= owedNew) return false;
        const [p8] = (await pub.readContract({ address: D.stockOracle, abi: norenStockOracleAbi, functionName: 'price', args: [stockToken(D, sym)] })) as readonly [bigint, bigint, bigint];
        const ltv = (await pub.readContract({ address: D.stockCredit, abi: norenStockCreditAbi, functionName: 'ltvBps', args: [who] })) as bigint;
        // stock (18 dec) needed so that value(6 dec) * ltv >= missing limit
        const missing = owedNew - avail;
        const need = (missing * 10_000n * 10n ** 20n + p8 * ltv - 1n) / (p8 * ltv);
        const have = await stockBalance(who, sym);
        if (have < need) throw Error(`You hold ${s6(have)} t${sym}; this needs ${s6(need)} locked. Pick another stock.`);
        lockAmt = need + need / 50n < have ? need + need / 50n : have; // 2% headroom for the price moving
        return true;
      },
      run: async () => {
        const allowance = (await pub.readContract({ address: stockToken(D, sym), abi: erc20Abi, functionName: 'allowance', args: [who, D.stockCredit] })) as bigint;
        if (allowance < lockAmt) await write(stockToken(D, sym), erc20Abi as Abi, 'approve', [D.stockCredit, maxUint256], `approve t${sym} for NorenStockCredit`);
        return write(D.stockCredit, norenStockCreditAbi as Abi, 'lock', [stockToken(D, sym), lockAmt], `lock ${s6(lockAmt)} t${sym} as collateral`);
      },
    },
    {
      key: 'plan', title: parts === 3 ? 'Open a pay-in-3 plan' : 'Open a pay-later plan',
      detail: parts === 3 ? 'Draws a round lot from the Earn pool: three installments two weeks apart, 1% fee, no interest' : 'Draws a round lot from the Earn pool: one payment in 30 days, 1% fee, no interest',
      needed: async () => true,
      run: async () => {
        const id = (await pub.readContract({ address: D.stockCredit, abi: norenStockCreditAbi, functionName: 'planCount' })) as bigint;
        const h = await write(D.stockCredit, norenStockCreditAbi as Abi, 'openPlan', [usdcOf(topUp), parts, stringToHex(inv.id.slice(0, 31), { size: 32 }), who], parts === 3 ? `pay in 3: draw ${t2(topUp)} tUSDC` : `pay later: draw ${t2(topUp)} tUSDC`);
        plan = { id, parts };
        return h;
      },
    },
    shieldLot('the credit'),
    payHub,
  ];
}

/** Runs a plan, reporting each step's state. Stops at the first failure. */
export async function runPlan(plan: PlanStep[], set: (s: Step[]) => void): Promise<boolean> {
  const st: Step[] = plan.map((s) => ({ key: s.key, title: s.title, detail: s.detail, state: 'todo' }));
  set([...st]);
  for (let i = 0; i < plan.length; i++) {
    st[i] = { ...st[i]!, state: 'run' };
    set([...st]);
    const t0 = performance.now();
    try {
      if (!(await plan[i]!.needed())) {
        st[i] = { ...st[i]!, state: 'skip' };
      } else {
        const h = await plan[i]!.run();
        st[i] = { ...st[i]!, state: 'done', hash: h ?? undefined, ms: performance.now() - t0 };
      }
      set([...st]);
    } catch (e) {
      st[i] = { ...st[i]!, state: 'fail', error: (e as Error).message };
      set([...st]);
      return false;
    }
  }
  return true;
}
