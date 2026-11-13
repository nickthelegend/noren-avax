// Stocks on Noren (Fuji): the five test stock tokens, the signed price reports for NorenStockOracle, and reads for the
// stock desk (pay with stocks), credit against stocks (pay in 3, pay later) and the Earn pool.
//
// Chainlink has no equity feeds on Fuji, so the price relayer (hub/src/prices.ts) reads Yahoo Finance's public chart
// API, signs a report with NOREN_PRICER_KEY and submits it; the browser can also fetch the latest signed report from
// the API and submit it itself before a trade if the on-chain price went stale. The contract checks the signature,
// the chain, the oracle address, the order of reports and their age.
import { encodeAbiParameters, keccak256, type Address, type Hex, type LocalAccount, type PublicClient } from 'viem';
import { norenStockCreditAbi, norenStockDeskAbi, norenStockOracleAbi } from './abi.ts';

export type StockSym = 'NVDA' | 'TSLA' | 'AAPL' | 'MSFT' | 'SPY';
export interface StockInfo {
  sym: StockSym;
  /** test token symbol on Fuji */
  ticker: `t${StockSym}`;
  name: string;
  key: 'tNVDA' | 'tTSLA' | 'tAAPL' | 'tMSFT' | 'tSPY';
}
export const STOCKS: readonly StockInfo[] = [
  { sym: 'NVDA', ticker: 'tNVDA', name: 'NVIDIA', key: 'tNVDA' },
  { sym: 'TSLA', ticker: 'tTSLA', name: 'Tesla', key: 'tTSLA' },
  { sym: 'AAPL', ticker: 'tAAPL', name: 'Apple', key: 'tAAPL' },
  { sym: 'MSFT', ticker: 'tMSFT', name: 'Microsoft', key: 'tMSFT' },
  { sym: 'SPY', ticker: 'tSPY', name: 'S&P 500 ETF', key: 'tSPY' },
] as const;
export const STOCK_DECIMALS = 18;

export interface StockDeployment {
  stockOracle: Address;
  stockDesk: Address;
  stockCredit: Address;
  stockStarter: Address;
  pricer: Address;
  stocksDeployBlock: number;
  tNVDA: Address;
  tTSLA: Address;
  tAAPL: Address;
  tMSFT: Address;
  tSPY: Address;
}
export const hasStocks = (d: object): d is StockDeployment => typeof (d as Partial<StockDeployment>).stockOracle === 'string';
export const stockToken = (d: StockDeployment, s: StockInfo | StockSym): Address => d[typeof s === 'string' ? (`t${s}` as StockInfo['key']) : s.key];
export const stockByToken = (d: StockDeployment, token: string): StockInfo | undefined =>
  STOCKS.find((s) => d[s.key].toLowerCase() === token.toLowerCase());

// ------------------------------------------------------------------ quotes (relayer side)

export const QUOTE_SOURCE = 'Yahoo Finance chart API';
export interface Quote {
  sym: StockSym;
  /** USD with 8 decimals */
  price8: bigint;
  /** the quote's own time (unix seconds): last trade, or the close when the market is shut */
  marketTime: number;
}

/** Reads one quote from Yahoo Finance's public chart endpoint (no key; delayed). Throws with a readable message. */
export async function fetchQuote(sym: StockSym, fetchImpl: typeof fetch = fetch): Promise<Quote> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${sym}?interval=1d&range=1d`;
  const r = await fetchImpl(url, { headers: { 'user-agent': 'Mozilla/5.0 (Noren price relayer)', accept: 'application/json' } });
  if (!r.ok) throw new Error(`${QUOTE_SOURCE}: HTTP ${r.status} for ${sym}`);
  const j = (await r.json()) as { chart?: { result?: { meta?: { regularMarketPrice?: number; regularMarketTime?: number } }[]; error?: unknown } };
  const meta = j.chart?.result?.[0]?.meta;
  if (!meta?.regularMarketPrice || !meta.regularMarketTime) throw new Error(`${QUOTE_SOURCE}: no price for ${sym}`);
  return { sym, price8: BigInt(Math.round(meta.regularMarketPrice * 1e8)), marketTime: meta.regularMarketTime };
}

export interface PriceReport {
  tokens: Address[];
  prices8: bigint[];
  marketTimes: bigint[];
  signedAt: bigint;
  sig: Hex;
  /** for display: the symbols in the same order and the quote source */
  syms: StockSym[];
  source: string;
}

/** The 32 bytes NorenStockOracle.digest returns; the relayer personal_signs them. */
export function reportDigest(chainId: number, oracle: Address, tokens: Address[], prices8: bigint[], marketTimes: bigint[], signedAt: bigint): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: 'string' }, { type: 'uint256' }, { type: 'address' }, { type: 'address[]' }, { type: 'uint256[]' }, { type: 'uint64[]' }, { type: 'uint64' }],
      ['Noren stock price v1', BigInt(chainId), oracle, tokens, prices8, marketTimes, signedAt],
    ),
  );
}

export async function signReport(signer: LocalAccount, chainId: number, d: StockDeployment, quotes: Quote[], signedAt: bigint): Promise<PriceReport> {
  const tokens = quotes.map((q) => stockToken(d, q.sym));
  const prices8 = quotes.map((q) => q.price8);
  const marketTimes = quotes.map((q) => BigInt(q.marketTime));
  const sig = await signer.signMessage({ message: { raw: reportDigest(chainId, d.stockOracle, tokens, prices8, marketTimes, signedAt) } });
  return { tokens, prices8, marketTimes, signedAt, sig, syms: quotes.map((q) => q.sym), source: QUOTE_SOURCE };
}

/** JSON-safe form of a report (bigints as strings) for the API. */
export const reportToJson = (r: PriceReport) => ({ ...r, prices8: r.prices8.map(String), marketTimes: r.marketTimes.map(String), signedAt: String(r.signedAt) });
export const reportFromJson = (j: ReturnType<typeof reportToJson>): PriceReport => ({
  ...j,
  prices8: j.prices8.map(BigInt),
  marketTimes: j.marketTimes.map(BigInt),
  signedAt: BigInt(j.signedAt),
});
export const submitArgs = (r: PriceReport) => [r.tokens, r.prices8, r.marketTimes, r.signedAt, r.sig] as const;

// ------------------------------------------------------------------ reads (app side)

export interface StockPrice {
  sym: StockSym;
  token: Address;
  price8: bigint;
  marketTime: number;
  signedAt: number;
  fresh: boolean;
}

export async function readPrices(pub: PublicClient, d: StockDeployment): Promise<StockPrice[]> {
  return Promise.all(
    STOCKS.map(async (s) => {
      const token = stockToken(d, s);
      const [price8, marketTime, signedAt, fresh] = (await pub.readContract({ address: d.stockOracle, abi: norenStockOracleAbi, functionName: 'last', args: [token] })) as readonly [bigint, bigint, bigint, boolean];
      return { sym: s.sym, token, price8, marketTime: Number(marketTime), signedAt: Number(signedAt), fresh };
    }),
  );
}

export interface PlanView {
  id: bigint;
  borrower: Address;
  parts: number;
  paid: number;
  closed: boolean;
  start: number;
  interval: number;
  total: bigint;
  principal: bigint;
  repaid: bigint;
  ref: Hex;
  next: bigint;
  nextDue: number;
}

export interface CreditView {
  collateral: { sym: StockSym; token: Address; amount: bigint }[];
  value: bigint | null; // null when a price is stale
  limit: bigint | null;
  available: bigint | null;
  owed: bigint;
  ltvBps: number;
  onTime: number;
  late: number;
  plans: PlanView[];
}

export async function readCredit(pub: PublicClient, d: StockDeployment, user: Address): Promise<CreditView> {
  const c = { address: d.stockCredit, abi: norenStockCreditAbi } as const;
  const collateral = await Promise.all(
    STOCKS.map(async (s) => ({ sym: s.sym, token: stockToken(d, s), amount: (await pub.readContract({ ...c, functionName: 'collateralOf', args: [user, stockToken(d, s)] })) as bigint })),
  );
  const [owed, ltv, onTime, late, ids] = await Promise.all([
    pub.readContract({ ...c, functionName: 'owed', args: [user] }) as Promise<bigint>,
    pub.readContract({ ...c, functionName: 'ltvBps', args: [user] }) as Promise<bigint>,
    pub.readContract({ ...c, functionName: 'onTimeOf', args: [user] }) as Promise<number>,
    pub.readContract({ ...c, functionName: 'lateOf', args: [user] }) as Promise<number>,
    pub.readContract({ ...c, functionName: 'plansOfUser', args: [user] }) as Promise<readonly bigint[]>,
  ]);
  let value: bigint | null = null, limit: bigint | null = null, available: bigint | null = null;
  try {
    [value, limit, available] = await Promise.all([
      pub.readContract({ ...c, functionName: 'collateralValue', args: [user] }) as Promise<bigint>,
      pub.readContract({ ...c, functionName: 'creditLimit', args: [user] }) as Promise<bigint>,
      pub.readContract({ ...c, functionName: 'available', args: [user] }) as Promise<bigint>,
    ]);
  } catch {
    /* a stale price: shown as such */
  }
  const plans = await Promise.all(
    ids.map(async (id) => {
      const p = (await pub.readContract({ ...c, functionName: 'plan', args: [id] })) as {
        borrower: Address; parts: number; paid: number; closed: boolean; start: bigint; interval: number; total: bigint; principal: bigint; repaid: bigint; ref: Hex;
      };
      const next = p.closed ? 0n : ((await pub.readContract({ ...c, functionName: 'nextInstallment', args: [id] })) as bigint);
      const nextDue = Number(p.start) + p.interval * (p.paid + 1);
      return { id, borrower: p.borrower, parts: p.parts, paid: p.paid, closed: p.closed, start: Number(p.start), interval: p.interval, total: p.total, principal: p.principal, repaid: p.repaid, ref: p.ref, next, nextDue };
    }),
  );
  return { collateral, value, limit, available, owed, ltvBps: Number(ltv), onTime: Number(onTime), late: Number(late), plans };
}

export async function quoteSellIn(pub: PublicClient, d: StockDeployment, sym: StockSym, usdc6: bigint) {
  const [amountIn, price8] = (await pub.readContract({ address: d.stockDesk, abi: norenStockDeskAbi, functionName: 'quoteSellIn', args: [stockToken(d, sym), usdc6] })) as readonly [bigint, bigint];
  return { amountIn, price8 };
}

/** LTV ladder shown in the app: 60% to start, +5 points per on-time installment, 75% at most. */
export const LTV_LADDER = [6000, 6500, 7000, 7500] as const;
export const PLAN_FEE_BPS = 100;
