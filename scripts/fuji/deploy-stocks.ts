// Deploys the stock contracts (DeployStocks.s.sol) to Fuji with forge, verifies them on Routescan, and merges the
// addresses into deployments/fuji.json. Keys are passed through the environment only and scrubbed from the output.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { privateKeyToAccount } from 'viem/accounts';
import { FUJI_RPC_2 } from '@noren-avax/sdk';
import { ROOT, hexKey, need } from '../lib/env.ts';

const OUT = join(ROOT, 'deployments/fuji-stocks.json');
const r = spawnSync(
  'forge',
  ['script', 'script/DeployStocks.s.sol', '--rpc-url', FUJI_RPC_2, '--broadcast', '--slow', '--verify', '--verifier', 'etherscan',
    '--verifier-url', 'https://api.routescan.io/v2/network/testnet/evm/43113/etherscan', '--etherscan-api-key', 'verifyContract'],
  {
    cwd: join(ROOT, 'contracts'),
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      NOREN_DEPLOYER_KEY: need('NOREN_DEPLOYER_KEY'),
      NOREN_IN: join(ROOT, 'deployments/fuji.json'),
      NOREN_PRICER: privateKeyToAccount(hexKey(need('NOREN_PRICER_KEY'))).address,
      NOREN_OUT: OUT,
    },
    encoding: 'utf8',
  },
);
const key = need('NOREN_DEPLOYER_KEY').replace(/^0x/, '');
const scrub = (s: string) => s.split(key).join('<redacted>');
console.log(scrub(r.stdout ?? '').split('\n').filter((l) => /Contract|deployed|Success|Submitted|verif|Error|error|##|Noren/.test(l)).join('\n'));
if (r.status !== 0) {
  console.error(scrub(r.stderr ?? '').slice(-3000));
  process.exit(r.status ?? 1);
}
const main = JSON.parse(readFileSync(join(ROOT, 'deployments/fuji.json'), 'utf8'));
const add = JSON.parse(readFileSync(OUT, 'utf8'));
writeFileSync(join(ROOT, 'deployments/fuji.json'), JSON.stringify({ ...main, ...add }, null, 2) + '\n');
console.log('merged into deployments/fuji.json:', Object.keys(add).join(', '));
