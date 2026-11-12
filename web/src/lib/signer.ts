import { useSyncExternalStore } from 'react';
import { createWalletClient, custom, nonceManager, type Abi, type Address, type Hex, type WalletClient } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { fuji, fujiTransport, FUJI_RPC, NorenPrivate } from '@noren-avax/sdk';
import { D, circuits, pub, readable } from './chain';

/**
 * Two ways to sign:
 *  - A browser wallet (Core, MetaMask…) over EIP-1193, switched to Fuji. This is the production path.
 *  - The QA signer: only in builds made with VITE_QA=1 (`pnpm build:qa`), and only when the Playwright harness injects
 *    `window.__NOREN_QA__ = { keys: { customer, merchant, auditor } }` with Fuji test keys. Production builds drop this
 *    code path and no key is ever in a bundle.
 */
export type Who = { address: Address; label: string; kind: 'wallet' | 'qa' };
type QaWindow = Window & { __NOREN_QA__?: { keys: Record<string, Hex> }; ethereum?: { request: (a: { method: string; params?: unknown[] }) => Promise<unknown> } };
export const QA = import.meta.env.VITE_QA === '1';

let current: Who | null = null;
let client: WalletClient | null = null;
let priv: NorenPrivate | null = null;
let version = 0;
const subs = new Set<() => void>();
const emit = () => {
  version++;
  subs.forEach((f) => f());
};

export function useWho() {
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => current,
  );
}

export function useSignerVersion() {
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => version,
  );
}

export function qaRoles(): string[] {
  if (!QA) return [];
  return Object.keys((window as QaWindow).__NOREN_QA__?.keys ?? {});
}

export function selectQa(label: string) {
  if (!QA) return;
  const key = (window as QaWindow).__NOREN_QA__?.keys[label];
  if (!key) throw Error(`QA signer "${label}" was not injected`);
  const account = privateKeyToAccount(key, { nonceManager });
  client = createWalletClient({ account, chain: fuji, transport: fujiTransport() });
  current = { address: account.address, label, kind: 'qa' };
  priv = null;
  try {
    sessionStorage.setItem('noren:qa', label);
  } catch {
    /* private mode */
  }
  emit();
}

export function restoreQa() {
  if (!QA) return;
  let l: string | null = null;
  try {
    l = sessionStorage.getItem('noren:qa');
  } catch {
    /* private mode */
  }
  const rs = qaRoles();
  if (rs.length) selectQa(l && rs.includes(l) ? l : rs[0]!);
}

export async function connectWallet() {
  const eth = (window as QaWindow).ethereum;
  if (!eth) throw Error('No browser wallet found. Install Core or MetaMask, then reload.');
  const [address] = (await eth.request({ method: 'eth_requestAccounts' })) as Address[];
  try {
    await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0xa869' }] });
  } catch (e) {
    if ((e as { code?: number })?.code === 4902) {
      await eth.request({
        method: 'wallet_addEthereumChain',
        params: [{ chainId: '0xa869', chainName: 'Avalanche Fuji C-Chain', nativeCurrency: { name: 'Avalanche', symbol: 'AVAX', decimals: 18 }, rpcUrls: [FUJI_RPC], blockExplorerUrls: ['https://testnet.snowtrace.io'] }],
      });
    } else throw e;
  }
  client = createWalletClient({ account: address!, chain: fuji, transport: custom(eth) });
  current = { address: address!, label: `${address!.slice(0, 6)}…${address!.slice(-4)}`, kind: 'wallet' };
  priv = null;
  emit();
}

export function disconnect() {
  current = null;
  client = null;
  priv = null;
  emit();
}

/** The eERC session for the current signer (keys live in memory only, for this tab). */
export function privateSession(): NorenPrivate {
  if (!client || !current) throw Error('Connect a wallet first.');
  if (!priv) priv = new NorenPrivate(pub as never, client, D, circuits);
  return priv;
}

export function isUnlocked() {
  return !!priv?.unlocked;
}

export async function unlock() {
  const p = privateSession();
  await p.unlock();
  emit();
  return p;
}

export function announceTx(hash: Hex, what: string) {
  window.dispatchEvent(new CustomEvent('noren:tx', { detail: { hash, what } }));
}

/** Sends a contract call from the current signer, pads the gas estimate, waits for the receipt. */
export async function write(address: Address, abi: Abi, functionName: string, args: unknown[] = [], what = functionName, value?: bigint): Promise<Hex> {
  if (!client || !current) throw Error('Connect a wallet first.');
  try {
    const params = { account: client.account ?? current.address, address, abi, functionName, args, value } as never;
    const { request } = await pub.simulateContract(params);
    const gas = await pub.estimateContractGas(params);
    const hash = await client.writeContract({ ...(request as object), account: client.account ?? current.address, chain: fuji, gas: (gas * 13n) / 10n } as never);
    const r = await pub.waitForTransactionReceipt({ hash, pollingInterval: 500, timeout: 120_000 });
    if (r.status !== 'success') throw Error(`Transaction reverted on Fuji: ${hash}`);
    announceTx(hash, what);
    return hash;
  } catch (e) {
    throw Error(readable(e));
  }
}
