import { BaseError, ContractFunctionRevertedError, type Address, type Hex } from 'viem';
import { circuitURLs, fuji, publicClientFor, type Deployment } from '@noren-avax/sdk';
import deployment from '../../../deployments/fuji.json';

export type Tx = { hash: Hex; by: Address; what: string };
export const D = deployment as unknown as Deployment & { auditor?: Address; txs?: Record<string, Tx> };
export const pub = publicClientFor(fuji);
export const circuits = circuitURLs(`${location.origin}/circuits`);

const NAMES: Record<string, string> = {};
if (D.hub) NAMES[D.hub.toLowerCase()] = 'Noren hub';
export function nameOf(a?: string | null): string {
  if (!a) return '';
  return NAMES[a.toLowerCase()] ?? `${a.slice(0, 6)}…${a.slice(-4)}`;
}
export function setName(a: string, n: string) {
  NAMES[a.toLowerCase()] = n;
}

/** A readable message from any viem / RPC / SDK error. */
export function readable(e: unknown): string {
  if (e instanceof BaseError) {
    const r = e.walk((x) => x instanceof ContractFunctionRevertedError) as ContractFunctionRevertedError | null;
    if (r?.data?.errorName) return `The contract refused: ${r.data.errorName}${r.data.args?.length ? ` (${r.data.args.map(String).join(', ')})` : ''}`;
    return e.shortMessage;
  }
  const m = e instanceof Error ? e.message : String(e);
  if (/User rejected|denied/i.test(m)) return 'You cancelled the request in your wallet.';
  return m.replace(/^Error:\s*/, '').slice(0, 400);
}
