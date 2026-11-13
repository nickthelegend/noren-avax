// Noren's stock price relayer. Chainlink has no equity feeds on Fuji, so every 10 minutes this reads the five quotes
// from Yahoo Finance's public chart API, signs a report with NOREN_PRICER_KEY (a signing-only key; NorenStockOracle
// accepts reports from it alone) and submits it with the relayer account paying gas. The latest signed report is also
// served at GET /api/prices, so a browser can submit it itself if the on-chain price ever goes stale.
import { type LocalAccount, type PublicClient, type WalletClient } from 'viem';
import {
  QUOTE_SOURCE,
  STOCKS,
  fetchQuote,
  norenStockOracleAbi,
  readStockPrices,
  reportToJson,
  signReport,
  submitArgs,
  type PriceReport,
  type Quote,
  type StockDeployment,
} from '@noren-avax/sdk';

const HOSTS = ['https://query1.finance.yahoo.com', 'https://query2.finance.yahoo.com'];

export interface PricesOptions {
  pub: PublicClient;
  wallet: WalletClient;
  signer: LocalAccount;
  d: StockDeployment;
  chainId: number;
  everySec?: number;
  /** skip a submit when the on-chain report is younger than this */
  minAgeSec?: number;
  log?: (m: string) => void;
}

export class PriceRelay {
  private o: PricesOptions;
  report: PriceReport | null = null;
  quotes: Quote[] = [];
  host = HOSTS[0]!;
  lastTx: string | null = null;
  lastError: string | null = null;
  lastRunAt = 0;
  private log: (m: string) => void;

  constructor(o: PricesOptions) {
    this.o = o;
    this.log = o.log ?? ((m) => console.log(`[prices] ${new Date().toISOString()} ${m}`));
  }

  /** Yahoo through query1, then query2 if query1 refuses this server. */
  private async quote(sym: Quote['sym']): Promise<Quote> {
    let last: Error | null = null;
    for (const h of [this.host, ...HOSTS.filter((x) => x !== this.host)]) {
      try {
        const q = await fetchQuote(sym, (url, init) => fetch(String(url).replace(HOSTS[0]!, h), { ...init, signal: AbortSignal.timeout(15_000) }));
        this.host = h;
        return q;
      } catch (e) {
        last = e as Error;
      }
    }
    throw last!;
  }

  async run(force = false) {
    this.lastRunAt = Math.floor(Date.now() / 1000);
    try {
      const quotes = await Promise.all(STOCKS.map((s) => this.quote(s.sym)));
      // Signed a few seconds in the past: the oracle refuses a report from the future (block time lags wall time).
      const signedAt = BigInt(Math.floor(Date.now() / 1000) - 10);
      const report = await signReport(this.o.signer, this.o.chainId, this.o.d, quotes, signedAt);
      this.quotes = quotes;
      this.report = report;
      const onChain = await readStockPrices(this.o.pub, this.o.d as never);
      const age = Math.floor(Date.now() / 1000) - Math.min(...onChain.map((p) => p.signedAt));
      if (!force && age < (this.o.minAgeSec ?? 540)) {
        this.lastError = null;
        return null;
      }
      const { request } = await this.o.pub.simulateContract({
        address: this.o.d.stockOracle,
        abi: norenStockOracleAbi,
        functionName: 'submit',
        args: submitArgs(report) as never,
        account: this.o.wallet.account!,
      });
      const hash = await this.o.wallet.writeContract(request as never);
      const r = await this.o.pub.waitForTransactionReceipt({ hash, pollingInterval: 1000, timeout: 90_000 });
      if (r.status !== 'success') throw new Error(`submit reverted: ${hash}`);
      this.lastTx = hash;
      this.lastError = null;
      this.log(`submitted ${quotes.map((q) => `${q.sym} ${(Number(q.price8) / 1e8).toFixed(2)}`).join(', ')} ${hash}`);
      return hash;
    } catch (e) {
      this.lastError = (e as Error).message.slice(0, 300);
      this.log(`failed: ${this.lastError}`);
      return null;
    }
  }

  start(everySec = this.o.everySec ?? 600) {
    const tick = async () => {
      await this.run();
      setTimeout(tick, everySec * 1000);
    };
    tick();
  }

  async status() {
    const onchain = await readStockPrices(this.o.pub, this.o.d as never).catch(() => null);
    return {
      source: QUOTE_SOURCE,
      host: this.host,
      quotes: this.quotes.map((q) => ({ sym: q.sym, price: Number(q.price8) / 1e8, marketTime: q.marketTime })),
      report: this.report ? reportToJson(this.report) : null,
      onchain: onchain
        ? {
            oracle: this.o.d.stockOracle,
            signedAt: Math.min(...onchain.map((p) => p.signedAt)),
            fresh: onchain.every((p) => p.fresh),
            prices: onchain.map((p) => ({ sym: p.sym, token: p.token, price: Number(p.price8) / 1e8, marketTime: p.marketTime, signedAt: p.signedAt, fresh: p.fresh })),
          }
        : null,
      lastTx: this.lastTx,
      lastRunAt: this.lastRunAt || null,
      error: this.lastError,
    };
  }
}
