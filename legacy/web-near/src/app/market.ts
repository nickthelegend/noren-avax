import type { Prices, CreditPosition } from '@noren-avax/sdk';
import { AVAX, norenCreditAbi, readPosition, readWallet } from '@noren-avax/sdk';
import { D, pub, readable } from '../lib/chain';
import { useLoad, type Load } from '../lib/hooks';
import { useSignerVersion, useWho } from '../lib/signer';

export type PoolData = { liquidity: bigint; totalDebt: bigint; aprBps: bigint };
/** Reads every tab shares: Chainlink prices, the NorenCredit pool, and a way to open the wallet sheet. */
export type Market = { prices: Load<Prices>; pool: Load<PoolData>; connect: () => void };

export type Account = { pos: CreditPosition | null; posError: string | null; wallet: { usdc: bigint; wbtc: bigint; avax: bigint } };

/** The connected wallet's credit position and public balances, re-read after every Noren transaction. */
export function useAccount(): Load<Account | null> {
  const who = useWho();
  const ver = useSignerVersion();
  return useLoad(async () => {
    if (!who) return null;
    const [pos, wallet] = await Promise.all([
      readPosition(pub as never, D, who.address).then(
        (p) => ({ p, e: null }),
        (e) => ({ p: null, e: readable(e) }),
      ),
      readWallet(pub as never, D, who.address),
    ]);
    return { pos: pos.p, posError: pos.e, wallet };
  }, [who?.address, ver]);
}

export type AssetCfg = { ltvBps: number; liqBps: number; maxAge: number };
/** The listed collateral's limits, read from NorenCredit.assets(). */
export async function readAssetCfg(): Promise<{ btc: AssetCfg; avax: AssetCfg }> {
  const one = async (a: `0x${string}`) => {
    const r = (await pub.readContract({ address: D.norenCredit, abi: norenCreditAbi, functionName: 'assets', args: [a] })) as readonly [boolean, number, number, number, number, number, string];
    return { ltvBps: Number(r[2]), liqBps: Number(r[3]), maxAge: Number(r[5]) };
  };
  const [btc, avax] = await Promise.all([one(D.tWBTC), one(AVAX)]);
  return { btc, avax };
}
