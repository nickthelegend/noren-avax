import { BaseError, ContractFunctionRevertedError, type Address, type Hex } from 'viem';
import { circuitURLs, fuji, publicClientFor, SNOWTRACE, type Deployment, type HubDeployment, type StockDeployment } from '@noren-avax/sdk';
import deployment from '../../../deployments/fuji.json';

export type Tx = { hash: Hex; by: Address; what: string };
export type FullDeployment = Deployment & HubDeployment & StockDeployment & { auditor?: Address; txs?: Record<string, Tx>; aubelle?: { shopId: number; storeId: string; owner: Address }; live?: { t: string; d: string; hash: Hex; marks: string[] }[] };
export const D = deployment as unknown as FullDeployment;
export const pub = publicClientFor(fuji);
export const circuits = circuitURLs(`${location.origin}/circuits`);
export const EXPLORER = SNOWTRACE;
export const txUrl = (h: string) => `${SNOWTRACE}/tx/${h}`;
export const addrUrl = (a: string) => `${SNOWTRACE}/address/${a}`;
/** The merchant surface (hosted checkout links point here). */
export const MERCHANT_ORIGIN = 'https://noren-avax-merchant.vercel.app';

/** A readable message from any viem / RPC / SDK error. */
export function readable(e: unknown): string {
  if (e instanceof BaseError) {
    const r = e.walk((x) => x instanceof ContractFunctionRevertedError) as ContractFunctionRevertedError | null;
    if (r?.data?.errorName) return `The contract refused: ${r.data.errorName}${r.data.args?.length ? ` (${r.data.args.map(String).join(', ')})` : ''}`;
    return e.shortMessage;
  }
  const m = e instanceof Error ? e.message : String(e);
  if (/User rejected|denied/i.test(m)) return 'You cancelled the request in your wallet.';
  return m.replace(/^Error:\s*/, '').split(/Request Arguments:|Contract Call:|\n\n/)[0]!.trim().slice(0, 300);
}
