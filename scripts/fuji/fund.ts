// Tops up the Fuji role accounts with a little AVAX for gas from an already-funded key in another local
// env file (NOREN_FUNDER_ENV = path, NOREN_FUNDER_VAR = variable name). The key is read here by name,
// never printed or copied into this repo.
import { createWalletClient, formatEther, parseEther, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { fuji, fujiTransport, publicClientFor } from '@noren-avax/sdk';
import { env, hexKey, need, readEnvFile } from '../lib/env.ts';

const pub = publicClientFor(fuji);
const targets: Record<string, string> = { NOREN_DEPLOYER_KEY: '0.05', NOREN_CUSTOMER_KEY: '0.02', NOREN_MERCHANT_KEY: '0.01', NOREN_AUDITOR_KEY: '0.01' };
const funderKey = readEnvFile(need('NOREN_FUNDER_ENV'))[env.NOREN_FUNDER_VAR ?? 'PRIVATE_KEY'];
if (!funderKey) throw new Error('Setup required: the funder variable is missing in NOREN_FUNDER_ENV');
const funder = privateKeyToAccount(hexKey(funderKey));
const w = createWalletClient({ account: funder, chain: fuji, transport: fujiTransport() });
console.log(`funder ${funder.address} has ${formatEther(await pub.getBalance({ address: funder.address }))} AVAX`);
const txs: Record<string, Hex> = {};
for (const [role, amount] of Object.entries(targets)) {
  const to = privateKeyToAccount(hexKey(need(role))).address;
  const bal = await pub.getBalance({ address: to });
  const want = parseEther(amount);
  if (bal >= want / 2n) {
    console.log(`${role.padEnd(20)} ${to} already has ${formatEther(bal)}`);
    continue;
  }
  const hash = await w.sendTransaction({ to, value: want - bal });
  await pub.waitForTransactionReceipt({ hash });
  txs[role] = hash;
  console.log(`${role.padEnd(20)} ${to} +${formatEther(want - bal)} AVAX ${hash}`);
}
console.log(`funder left ${formatEther(await pub.getBalance({ address: funder.address }))} AVAX`);
