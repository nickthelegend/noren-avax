import type { Address } from 'viem';

export interface Deployment {
  chainId: number;
  deployBlock: number;
  deployer: Address;
  tUSDC: Address;
  tWBTC: Address;
  btcUsdFeed: Address;
  avaxUsdFeed: Address;
  registrar: Address;
  encryptedERC: Address;
  norenCredit: Address;
  norenMerchants: Address;
  auditor?: Address;
}

/** eERC runs in converter mode with 2 decimals: one unit is one cent of tUSDC. */
export const EERC_DECIMALS = 2n;
export const USDC_DECIMALS = 6;
export const WBTC_DECIMALS = 8;
export const AVAX = '0x0000000000000000000000000000000000000000' as const;
