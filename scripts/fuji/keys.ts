// Creates the Fuji role keys in the repo's gitignored .env if they are missing. Prints addresses only.
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { ROOT, readEnvFile } from '../lib/env.ts';

const file = join(ROOT, '.env');
const have = readEnvFile(file);
const roles = [
  'NOREN_DEPLOYER_KEY',
  'NOREN_CUSTOMER_KEY',
  'NOREN_MERCHANT_KEY',
  'NOREN_AUDITOR_KEY',
  // settlement hub round (Nov 12): the hub's eERC account, the gas relayer, two more shops, Harbor & Loom's accountant
  'NOREN_HUB_KEY',
  'NOREN_RELAYER_KEY',
  'NOREN_MERCHANT2_KEY',
  'NOREN_MERCHANT3_KEY',
  'NOREN_ACCOUNTANT_KEY',
];
let add = '';
for (const r of roles) if (!have[r]) add += `${r}=${generatePrivateKey()}\n`;
// The relayer's keyed hash of requester IPs (not a chain key).
if (!have.NOREN_GAS_SALT) add += `NOREN_GAS_SALT=${randomBytes(32).toString('hex')}\n`;
if (add) appendFileSync(file, (existsSync(file) && !readFileSync(file, 'utf8').endsWith('\n') ? '\n' : '') + add, { mode: 0o600 });
const now = readEnvFile(file);
for (const r of roles) console.log(r.replace(/_KEY$/, '').padEnd(20), privateKeyToAccount(now[r] as `0x${string}`).address);
