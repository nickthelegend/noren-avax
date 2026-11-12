// Fuji clients for the role keys and a writer that records every transaction in deployments/fuji.json.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createWalletClient, nonceManager, type Address, type Hex, type WalletClient } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { NorenPrivate, circuitURLs, fuji, fujiTransport, publicClientFor, type Deployment } from '@noren-avax/sdk';
import { ROOT, hexKey, need } from '../lib/env.ts';

export const FILE = join(ROOT, 'deployments/fuji.json');
export const pub = publicClientFor(fuji);
export const circuits = circuitURLs(join(ROOT, 'web/public/circuits'));
export type Rec = Record<string, unknown> & Deployment & { txs?: Record<string, { hash: Hex; by: Address; what: string }> };
export const load = (): Rec => JSON.parse(readFileSync(FILE, 'utf8'));

export type Role = 'DEPLOYER' | 'CUSTOMER' | 'MERCHANT' | 'AUDITOR' | 'HUB' | 'RELAYER' | 'MERCHANT2' | 'MERCHANT3' | 'ACCOUNTANT';

export function wallet(role: Role): WalletClient {
  return createWalletClient({ account: privateKeyToAccount(hexKey(need(`NOREN_${role}_KEY`)), { nonceManager }), chain: fuji, transport: fujiTransport() });
}

export function privateFor(w: WalletClient, d: Deployment) {
  return new NorenPrivate(pub as never, w, d, circuits);
}

export function record(name: string, hash: Hex, by: Address, what: string, extra: Record<string, unknown> = {}) {
  const d = load();
  d.txs = { ...(d.txs ?? {}), [name]: { hash, by, what } };
  Object.assign(d, extra);
  writeFileSync(FILE, JSON.stringify(d, null, 2) + '\n');
  console.log(`${name.padEnd(28)} ${hash}  ${what}`);
}

export async function send(w: WalletClient, address: Address, abi: readonly unknown[], functionName: string, args: unknown[], value?: bigint): Promise<Hex> {
  const { request } = await pub.simulateContract({ address, abi: abi as never, functionName, args: args as never, value, account: w.account! } as never);
  const hash = await w.writeContract(request as never);
  const r = await pub.waitForTransactionReceipt({ hash, pollingInterval: 500 });
  if (r.status !== 'success') throw new Error(`${functionName} reverted: ${hash}`);
  return hash;
}
