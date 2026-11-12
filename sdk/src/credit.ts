// Reads of the NorenCredit line and the shop registry.
import type { Address, PublicClient } from 'viem';
import { erc20Abi } from 'viem';
import { norenCreditAbi, norenMerchantsAbi } from './abi.ts';
import { AVAX, type Deployment } from './deployment.ts';

export interface CreditPosition {
  collateralValue: bigint; // tUSDC 6 decimals
  borrowLimit: bigint;
  liquidationValue: bigint;
  debt: bigint;
  health: bigint; // 1e18 = 1.00
  available: bigint;
  btc: bigint; // tWBTC 8 decimals
  avax: bigint; // wei
}

export interface Prices {
  btc: bigint; // USD 8 decimals
  avax: bigint;
  btcUpdatedAt: number;
  avaxUpdatedAt: number;
  stale: string | null;
}

const feedAbi = [
  {
    type: 'function',
    name: 'latestRoundData',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      { name: 'roundId', type: 'uint80' },
      { name: 'answer', type: 'int256' },
      { name: 'startedAt', type: 'uint256' },
      { name: 'updatedAt', type: 'uint256' },
      { name: 'answeredInRound', type: 'uint80' },
    ],
  },
] as const;

export async function readPrices(pub: PublicClient, d: Deployment): Promise<Prices> {
  const [b, a] = await Promise.all([
    pub.readContract({ address: d.btcUsdFeed, abi: feedAbi, functionName: 'latestRoundData' }),
    pub.readContract({ address: d.avaxUsdFeed, abi: feedAbi, functionName: 'latestRoundData' }),
  ]);
  let stale: string | null = null;
  try {
    await pub.readContract({ address: d.norenCredit, abi: norenCreditAbi, functionName: 'priceOf', args: [d.tWBTC] });
    await pub.readContract({ address: d.norenCredit, abi: norenCreditAbi, functionName: 'priceOf', args: [AVAX] });
  } catch {
    stale = 'A Chainlink feed is older than the 25-hour limit, so the contract refuses new credit until it updates.';
  }
  return { btc: b[1], avax: a[1], btcUpdatedAt: Number(b[3]), avaxUpdatedAt: Number(a[3]), stale };
}

export async function readPosition(pub: PublicClient, d: Deployment, user: Address): Promise<CreditPosition> {
  const [p, available, btc, avax] = await Promise.all([
    pub.readContract({ address: d.norenCredit, abi: norenCreditAbi, functionName: 'positionOf', args: [user] }),
    pub.readContract({ address: d.norenCredit, abi: norenCreditAbi, functionName: 'availableToBorrow', args: [user] }),
    pub.readContract({ address: d.norenCredit, abi: norenCreditAbi, functionName: 'collateralOf', args: [user, d.tWBTC] }),
    pub.readContract({ address: d.norenCredit, abi: norenCreditAbi, functionName: 'collateralOf', args: [user, AVAX] }),
  ]);
  return { ...(p as Omit<CreditPosition, 'available' | 'btc' | 'avax'>), available: available as bigint, btc: btc as bigint, avax: avax as bigint };
}

export async function readPool(pub: PublicClient, d: Deployment) {
  const [liquidity, totalDebt, apr] = await Promise.all([
    pub.readContract({ address: d.norenCredit, abi: norenCreditAbi, functionName: 'liquidity' }),
    pub.readContract({ address: d.norenCredit, abi: norenCreditAbi, functionName: 'totalDebt' }),
    pub.readContract({ address: d.norenCredit, abi: norenCreditAbi, functionName: 'aprBps' }),
  ]);
  return { liquidity: liquidity as bigint, totalDebt: totalDebt as bigint, aprBps: apr as bigint };
}

export async function readWallet(pub: PublicClient, d: Deployment, user: Address) {
  const [usdc, wbtc, avax] = await Promise.all([
    pub.readContract({ address: d.tUSDC, abi: erc20Abi, functionName: 'balanceOf', args: [user] }),
    pub.readContract({ address: d.tWBTC, abi: erc20Abi, functionName: 'balanceOf', args: [user] }),
    pub.getBalance({ address: user }),
  ]);
  return { usdc, wbtc, avax };
}

export interface Shop {
  id: number;
  owner: Address;
  name: string;
  slug: string;
  openedAt: number;
  items: { id: number; name: string; priceCents: bigint; active: boolean }[];
}

export async function readShops(pub: PublicClient, d: Deployment): Promise<Shop[]> {
  const n = Number(await pub.readContract({ address: d.norenMerchants, abi: norenMerchantsAbi, functionName: 'shopCount' }));
  return Promise.all(
    Array.from({ length: n }, async (_, id) => {
      const [s, items] = await Promise.all([
        pub.readContract({ address: d.norenMerchants, abi: norenMerchantsAbi, functionName: 'shop', args: [BigInt(id)] }),
        pub.readContract({ address: d.norenMerchants, abi: norenMerchantsAbi, functionName: 'items', args: [BigInt(id)] }),
      ]);
      const shop = s as { owner: Address; name: string; slug: string; openedAt: bigint };
      return {
        id,
        owner: shop.owner,
        name: shop.name,
        slug: shop.slug,
        openedAt: Number(shop.openedAt),
        items: (items as readonly { name: string; priceCents: bigint; active: boolean }[]).map((it, i) => ({ id: i, ...it })),
      };
    }),
  );
}
