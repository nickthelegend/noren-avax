// Reads the five quotes from Yahoo Finance, signs a report with NOREN_PRICER_KEY and submits it to NorenStockOracle with
// NOREN_RELAYER_KEY paying gas. The API on the VPS does the same every 10 minutes (hub/src/prices.ts); this is the
// manual run. Keys are read by name and never printed.
import { privateKeyToAccount } from 'viem/accounts';
import { STOCKS, fetchQuote, norenStockOracleAbi, signReport, submitArgs, txUrl, type StockDeployment } from '@noren-avax/sdk';
import { hexKey, need } from '../lib/env.ts';
import { load, pub, send, wallet } from './lib.ts';

const d = load() as ReturnType<typeof load> & StockDeployment;
const quotes = await Promise.all(STOCKS.map((s) => fetchQuote(s.sym)));
for (const q of quotes) console.log(q.sym.padEnd(5), (Number(q.price8) / 1e8).toFixed(2), new Date(q.marketTime * 1000).toISOString());
const signedAt = BigInt(Math.floor(Date.now() / 1000) - 5);
const report = await signReport(privateKeyToAccount(hexKey(need('NOREN_PRICER_KEY'))), 43113, d, quotes, signedAt);
const w = wallet('RELAYER');
const hash = await send(w, d.stockOracle, norenStockOracleAbi, 'submit', [...submitArgs(report)]);
console.log('submitted', txUrl(hash));
const [p, , , fresh] = (await pub.readContract({ address: d.stockOracle, abi: norenStockOracleAbi, functionName: 'last', args: [d.tNVDA] })) as readonly [bigint, bigint, bigint, boolean];
console.log('on chain NVDA', Number(p) / 1e8, fresh ? 'fresh' : 'stale');
process.exit(0);
