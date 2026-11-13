// Aubelle, the demo boutique, on Fuji and on Noren Merchant. Idempotent: every step checks first.
//  1. Its owner (NOREN_AUBELLE_KEY, funded from the Avalanche funding hub via avax/.hub/fund.sh) registers an eERC key
//     (a Groth16 registration proof made here) and opens the shop on NorenMerchants.
//  2. It signs in to the Noren API with Ethereum, creates its store for that shop and mints a secret key, which goes
//     into the repo's gitignored .env as NOREN_AUBELLE_SECRET (for the shop's server; never printed).
// Usage: node fuji/setup-aubelle.ts [api base, default https://noren-avax-api.201-18-198-162.sslip.io]
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createSiweMessage } from 'viem/siwe';
import { norenMerchantsAbi, readShops } from '@noren-avax/sdk';
import { ROOT, readEnvFile } from '../lib/env.ts';
import { FILE, load, privateFor, pub, record, send, wallet } from './lib.ts';

const API = (process.argv[2] ?? 'https://noren-avax-api.201-18-198-162.sslip.io').replace(/\/+$/, '');
const w = wallet('AUBELLE');
const me = w.account!.address;
const d = load();

const p = privateFor(w, d);
if (!(await p.isRegistered())) record('register_aubelle', (await p.register())!, me, 'Aubelle registers its eERC public key (Groth16 registration proof)');
let shop = (await readShops(pub as never, d)).find((s) => s.slug === 'aubelle');
if (!shop) {
  record('open_aubelle', await send(w, d.norenMerchants, norenMerchantsAbi, 'openShop', ['Aubelle', 'aubelle']), me, 'Aubelle opens on Noren Merchant');
  shop = (await readShops(pub as never, d)).find((s) => s.slug === 'aubelle')!;
}
if (shop.owner.toLowerCase() !== me.toLowerCase()) throw new Error(`the aubelle slug belongs to ${shop.owner}`);
console.log(`Aubelle is shop ${shop.id} (owner ${me})`);

async function api(path: string, init: { method?: string; token?: string; body?: unknown } = {}) {
  const r = await fetch(`${API}${path}`, {
    method: init.method ?? (init.body ? 'POST' : 'GET'),
    headers: { 'content-type': 'application/json', ...(init.token ? { authorization: `Bearer ${init.token}` } : {}) },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  const j = (await r.json()) as any;
  if (!r.ok) throw new Error(`${path}: ${r.status} ${j?.error ?? ''}`);
  return j;
}

const { nonce } = await api('/api/auth/nonce');
const message = createSiweMessage({
  address: me, chainId: 43113, domain: 'noren-avax-shop.vercel.app', uri: 'https://noren-avax-shop.vercel.app', version: '1', nonce,
  statement: 'Aubelle signs in to Noren Merchant',
});
const { token } = await api('/api/auth/siwe', { body: { message, signature: await w.signMessage({ account: w.account!, message }) } });
const stores = (await api('/api/stores', { token })) as { id: string; shopId: number }[];
let store = stores.find((s) => s.shopId === shop!.id);
const envFile = join(ROOT, '.env');
const have = readEnvFile(envFile).NOREN_AUBELLE_SECRET;
let secret: string | null = null;
if (!store) {
  const r = await api('/api/stores', { token, body: { shopId: shop.id, name: 'Aubelle' } });
  store = r.store;
  secret = r.secretKey;
} else if (!have) {
  secret = (await api(`/api/stores/${store.id}/keys`, { token, method: 'POST' })).secretKey;
}
if (secret) {
  const cur = readFileSync(envFile, 'utf8');
  appendFileSync(envFile, `${cur.endsWith('\n') ? '' : '\n'}NOREN_AUBELLE_SECRET=${secret}\n`, { mode: 0o600 });
  console.log('secret key saved to .env as NOREN_AUBELLE_SECRET');
} else console.log('NOREN_AUBELLE_SECRET already in .env');
const cur = load();
writeFileSync(FILE, JSON.stringify({ ...cur, aubelle: { shopId: shop.id, storeId: store!.id, owner: me } }, null, 2) + '\n');
console.log(`Noren Merchant store ${store!.id} for shop ${shop.id}`);
process.exit(0);
