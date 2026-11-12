import { createPublicClient, defineChain, fallback, http, type Chain, type Transport } from 'viem';

export const FUJI_RPC = 'https://api.avax-test.network/ext/bc/C/rpc';
/** Second public Fuji RPC (PublicNode), used when the Avalanche one rate-limits. */
export const FUJI_RPC_2 = 'https://avalanche-fuji-c-chain-rpc.publicnode.com';
export const SNOWTRACE = 'https://testnet.snowtrace.io';

export const fuji = defineChain({
  id: 43113,
  name: 'Avalanche Fuji',
  nativeCurrency: { name: 'Avalanche', symbol: 'AVAX', decimals: 18 },
  rpcUrls: { default: { http: [FUJI_RPC, FUJI_RPC_2] } },
  blockExplorers: { default: { name: 'Snowtrace', url: SNOWTRACE } },
  testnet: true,
});

export const local = (rpc: string) =>
  defineChain({
    id: 31337,
    name: 'Anvil',
    nativeCurrency: { name: 'Avalanche', symbol: 'AVAX', decimals: 18 },
    rpcUrls: { default: { http: [rpc] } },
  });

export const fujiTransport = (): Transport =>
  fallback([http(FUJI_RPC, { retryCount: 2, timeout: 20_000 }), http(FUJI_RPC_2, { retryCount: 2, timeout: 20_000 })]);

export function publicClientFor(chain: Chain, transport: Transport = chain.id === 43113 ? fujiTransport() : http(chain.rpcUrls.default.http[0])) {
  return createPublicClient({ chain, transport, batch: { multicall: false } });
}

export const txUrl = (hash: string) => `${SNOWTRACE}/tx/${hash}`;
export const addressUrl = (a: string) => `${SNOWTRACE}/address/${a}`;
