// Prints each Fuji role account's address and AVAX balance (keys are read by name, never printed).
import { formatEther } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { fuji, publicClientFor } from '@noren-avax/sdk';
import { env, hexKey } from '../lib/env.ts';

const pub = publicClientFor(fuji);
for (const k of Object.keys(env).filter((k) => /^NOREN_[A-Z0-9_]+_KEY$/.test(k)).sort()) {
  const a = privateKeyToAccount(hexKey(env[k]!)).address;
  console.log(k.replace(/_KEY$/, '').padEnd(24), a, formatEther(await pub.getBalance({ address: a })));
}
