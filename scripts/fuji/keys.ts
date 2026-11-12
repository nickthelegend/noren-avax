// Creates the Fuji role keys in the repo's gitignored .env if they are missing. Prints addresses only.
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { ROOT, readEnvFile } from '../lib/env.ts';

const file = join(ROOT, '.env');
const have = readEnvFile(file);
const roles = ['NOREN_DEPLOYER_KEY', 'NOREN_CUSTOMER_KEY', 'NOREN_MERCHANT_KEY', 'NOREN_AUDITOR_KEY'];
let add = '';
for (const r of roles) if (!have[r]) add += `${r}=${generatePrivateKey()}\n`;
if (add) appendFileSync(file, (existsSync(file) && !readFileSync(file, 'utf8').endsWith('\n') ? '\n' : '') + add, { mode: 0o600 });
const now = readEnvFile(file);
for (const r of roles) console.log(r.replace(/_KEY$/, '').padEnd(20), privateKeyToAccount(now[r] as `0x${string}`).address);
