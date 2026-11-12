import { type Address, type Hex } from 'viem';
import { gasDigest, hasHub } from '@noren-avax/sdk';
import { D, pub } from './chain';
import { announceTx, signerClient } from './signer';

/** Noren's API (hub, gas relay, assistant). Same origin: Vercel rewrites /api to the VPS; Vite proxies it in dev. */
export async function api<T>(path: string, body?: unknown): Promise<T> {
  let r: Response;
  try {
    r = await fetch(`/api${path}`, body === undefined ? undefined : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  } catch {
    throw Error('Noren’s API is unreachable. Check your connection and try again.');
  }
  const text = await r.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    throw Error(`Noren’s API answered ${r.status} without JSON.`);
  }
  if (!r.ok) throw Error((data as { error?: string })?.error ?? `Noren’s API answered ${r.status}.`);
  return data as T;
}

export type GasStatus = { station: Address; pack: { avax: string; tUSDC: number; tWBTC: number }; todayLeft: number; youLeft: number; funded: number };

/** Signs the starter-pack request with the connected wallet and has Noren's relayer send it. */
export async function getStarterPack(to: Address): Promise<Hex> {
  if (!hasHub(D)) throw Error('Setup required: this deployment has no gas station.');
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);
  const w = signerClient();
  const sig = await w.signMessage({ account: w.account ?? to, message: { raw: gasDigest(D.chainId, D.norenGasStation, to, deadline) } });
  const { hash } = await api<{ hash: Hex }>('/gas', { to, deadline: String(deadline), sig });
  await pub.waitForTransactionReceipt({ hash, pollingInterval: 500, timeout: 90_000 });
  announceTx(hash, 'starter pack: gas, 100 tUSDC, 0.01 tWBTC');
  return hash;
}

export type HubStatus = { hub: Address; everySec: number; coverMin: number; queued: number; settling: boolean; nextSettleAt: number; lastBatchAt: number | null; error: string | null };

export type Receipt = {
  tx: Hex;
  shopId: number;
  cents: string;
  order: string;
  status: 'queued' | 'settling' | 'settled' | 'refunded' | 'refund pending';
  batch: number | null;
  payoutTx: Hex | null;
  refundTx: Hex | null;
  hub: Address;
  signature: Hex;
  nextSettleAt: number;
};

const CLAIMS = 'noren:claims';
export function saveClaim(tx: Hex, claim: string, meta: { shop: string; item: string; cents: string; order: string }) {
  try {
    const all = JSON.parse(localStorage.getItem(CLAIMS) ?? '{}');
    all[tx] = { claim, ...meta, at: Date.now() };
    localStorage.setItem(CLAIMS, JSON.stringify(all));
  } catch {
    /* storage blocked: the receipt still shows for this session */
  }
}
