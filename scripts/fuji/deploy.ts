// Deploys the Noren contracts to Fuji with forge (deployer key passed through the environment only) and
// writes deployments/fuji.json. Chainlink Fuji feeds: BTC/USD and AVAX/USD (checked live before use).
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { FUJI_RPC_2 } from '@noren-avax/sdk';
import { ROOT, need } from '../lib/env.ts';

const r = spawnSync(
  'forge',
  ['script', 'script/Deploy.s.sol', '--rpc-url', FUJI_RPC_2, '--broadcast', '--slow', '--verify', '--verifier', 'etherscan',
    '--verifier-url', 'https://api.routescan.io/v2/network/testnet/evm/43113/etherscan', '--etherscan-api-key', 'verifyContract'],
  {
    cwd: join(ROOT, 'contracts'),
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      NOREN_DEPLOYER_KEY: need('NOREN_DEPLOYER_KEY'),
      NOREN_BTC_FEED: '0x31CF013A08c6Ac228C94551d535d5BAfE19c602a',
      NOREN_AVAX_FEED: '0x5498BB86BC934c8D34FDA08E81D444153d0D06aD',
      NOREN_OUT: join(ROOT, 'deployments/fuji.json'),
    },
    encoding: 'utf8',
  },
);
const key = need('NOREN_DEPLOYER_KEY').replace(/^0x/, '');
const scrub = (s: string) => s.split(key).join('<redacted>');
console.log(scrub(r.stdout ?? '').split('\n').filter((l) => /Contract|deployed|Success|Submitted|verif|Error|error|##|EncryptedERC|Noren/.test(l)).join('\n'));
if (r.status !== 0) {
  console.error(scrub(r.stderr ?? '').slice(-3000));
  process.exit(r.status ?? 1);
}
