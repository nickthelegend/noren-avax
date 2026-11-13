// Noren Merchant's API and the stock price relayer on a local Anvil chain (not a fork): the real Foundry deployment
// (Deploy + DeployHub + DeployStocks), Ava Labs' eERC with real proofs, the hub service's own code. The API is served
// by hub/src/merchant.ts over real HTTP; sign-in is a real SIWE signature; the invoice is paid by a real private eERC
// payment that the hub decrypts. The price relayer reads live Yahoo Finance quotes (network needed).
//
//   node --test --test-force-exit scripts/anvil/merchant.test.ts
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { createWalletClient, http, keccak256, toHex, type Address, type Hex, type WalletClient } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { createSiweMessage } from 'viem/siwe';
import {
  NorenPrivate,
  circuitURLs,
  encryptedErcAbi,
  hubNote,
  norenMerchantsAbi,
  norenStockOracleAbi,
  readStockPrices,
  type HubDeployment,
  type StockDeployment,
} from '@noren-avax/sdk';
import { Hub } from '../../hub/src/hub.ts';
import { Merchant, methodOf } from '../../hub/src/merchant.ts';
import { PriceRelay } from '../../hub/src/prices.ts';
import { ROOT } from '../lib/env.ts';
import { startAnvil } from './chain.ts';

const ANVIL_DEV_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const keyOf = (label: string) => keccak256(toHex(`noren-merchant-test:${label}`));
const circuits = circuitURLs(join(ROOT, 'web/public/circuits'));
const tmp = join(ROOT, '.anvil', `merchant-${process.pid}`);
rmSync(tmp, { recursive: true, force: true });
mkdirSync(tmp, { recursive: true });

let A: Awaited<ReturnType<typeof startAnvil>>;
let d: HubDeployment & StockDeployment;
const W: Record<string, WalletClient> = {};
const P: Record<string, NorenPrivate> = {};
let hub: Hub;
let merchant: Merchant;
let server: Server;
let base: string;

const wallet = (k: Hex) => createWalletClient({ account: privateKeyToAccount(k), chain: A.chain, transport: http(A.rpc) });
const addr = (who: string) => W[who]!.account!.address;
const fund = (a: Address) => A.pub.request({ method: 'anvil_setBalance' as never, params: [a, toHex(10n ** 20n)] as never });
const forge = (script: string, env: Record<string, string>) =>
  execFileSync('forge', ['script', script, '--rpc-url', A.rpc, '--broadcast', '--slow'], { cwd: join(ROOT, 'contracts'), env: { ...process.env, NOREN_DEPLOYER_KEY: ANVIL_DEV_KEY, ...env }, stdio: 'ignore' });
async function send(w: WalletClient, address: Address, abi: readonly unknown[], functionName: string, args: unknown[]) {
  const hash = await w.writeContract({ address, abi: abi as never, functionName, args: args as never, account: w.account!, chain: A.chain } as never);
  assert.equal((await A.pub.waitForTransactionReceipt({ hash })).status, 'success', `${functionName} reverted`);
}

async function api(path: string, init: { method?: string; token?: string; body?: unknown; ip?: string } = {}) {
  const r = await fetch(`${base}${path}`, {
    method: init.method ?? (init.body ? 'POST' : 'GET'),
    headers: { 'content-type': 'application/json', ...(init.token ? { authorization: `Bearer ${init.token}` } : {}), ...(init.ip ? { 'x-real-ip': init.ip } : {}) },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  return { status: r.status, body: (await r.json()) as any };
}

async function signIn(who: string, chainId = 31337) {
  const { body } = await api('/api/auth/nonce');
  const message = createSiweMessage({ address: addr(who), chainId, domain: 'noren-avax-merchant.vercel.app', nonce: body.nonce, uri: 'https://noren-avax-merchant.vercel.app', version: '1', statement: 'Sign in to Noren Merchant' });
  const signature = await W[who]!.signMessage({ account: W[who]!.account!, message });
  return api('/api/auth/siwe', { body: { message, signature } });
}

before(async () => {
  A = await startAnvil();
  forge('script/Deploy.s.sol', { NOREN_OUT: join(tmp, 'base.json') });
  const b0 = JSON.parse(readFileSync(join(tmp, 'base.json'), 'utf8'));
  W.deployer = wallet(ANVIL_DEV_KEY);
  for (const who of ['hub', 'relayer', 'auditor', 'owner', 'other', 'customer', 'pricer']) {
    W[who] = wallet(keyOf(who));
    await fund(addr(who));
    P[who] = new NorenPrivate(A.pub, W[who]!, b0, circuits);
  }
  for (const who of ['hub', 'auditor', 'owner', 'other']) assert.ok(await P[who]!.register(), `${who} registers`);
  await send(W.deployer!, b0.encryptedERC, encryptedErcAbi, 'setAuditorPublicKey', [addr('auditor')]);
  await send(W.owner!, b0.norenMerchants, norenMerchantsAbi, 'openShop', ['Aubelle', 'aubelle']);
  await send(W.other!, b0.norenMerchants, norenMerchantsAbi, 'openShop', ['Juhu Chai House', 'juhu-chai']);
  forge('script/DeployHub.s.sol', { NOREN_IN: join(tmp, 'base.json'), NOREN_OUT: join(tmp, 'hub.json'), NOREN_HUB: addr('hub'), NOREN_RELAYER: addr('relayer') });
  forge('script/DeployStocks.s.sol', { NOREN_IN: join(tmp, 'base.json'), NOREN_OUT: join(tmp, 'stocks.json'), NOREN_PRICER: addr('pricer'), NOREN_STOCK_PACKS: '5' });
  d = { ...b0, ...JSON.parse(readFileSync(join(tmp, 'hub.json'), 'utf8')), ...JSON.parse(readFileSync(join(tmp, 'stocks.json'), 'utf8')) };
  for (const who of Object.keys(P)) P[who] = new NorenPrivate(A.pub, W[who]!, d, circuits);
  for (const who of ['hub', 'owner', 'customer']) await P[who]!.unlock();
  merchant = new Merchant({ pub: A.pub as never, d, file: join(tmp, 'merchant.json'), chainId: 31337, perMinute: 5 });
  hub = new Hub({
    pub: A.pub as never, wallet: W.hub!, d, circuits, stateFile: join(tmp, 'state.json'), everySec: 60, coverMin: 2, log: () => {},
    onPayment: (q) => merchant.markPaid(q),
    onSettled: (b, items) => merchant.markSettled(b, items),
  });
  await hub.start();
  server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    const send = (s: number, data: unknown) => {
      res.writeHead(s, { 'content-type': 'application/json' });
      res.end(JSON.stringify(data));
    };
    try {
      const body = async () => {
        let s = '';
        for await (const c of req) s += c;
        return s ? JSON.parse(s) : {};
      };
      if (!(await merchant.handle(req, url, String(req.headers['x-real-ip'] ?? 'local'), body, send))) send(404, { error: 'not found' });
    } catch (e) {
      send((e as { status?: number }).status ?? 500, { error: (e as Error).message });
    }
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});

after(() => {
  server?.close();
  A?.stop();
  rmSync(tmp, { recursive: true, force: true });
});

// ------------------------------------------------------------------ sign in, stores, keys

let session: string;
let store: { id: string; shopId: number };
let secret: string;

test('sign in with Ethereum: a real SIWE signature on this chain gives a session; replays and other chains do not', async () => {
  const r = await signIn('owner');
  assert.equal(r.status, 200);
  assert.equal(r.body.address, addr('owner'));
  session = r.body.token;
  const wrong = await signIn('owner', 43114);
  assert.equal(wrong.status, 400);
  assert.match(wrong.body.error, /chain 31337/);
  // The same message and signature a second time: the nonce is spent.
  const { body } = await api('/api/auth/nonce');
  const message = createSiweMessage({ address: addr('owner'), chainId: 31337, domain: 'noren.test', nonce: body.nonce, uri: 'https://noren.test', version: '1' });
  const signature = await W.owner!.signMessage({ account: W.owner!.account!, message });
  assert.equal((await api('/api/auth/siwe', { body: { message, signature } })).status, 200);
  assert.equal((await api('/api/auth/siwe', { body: { message, signature } })).status, 401);
  // Someone else's signature over the owner's message.
  const { body: n2 } = await api('/api/auth/nonce');
  const m2 = createSiweMessage({ address: addr('owner'), chainId: 31337, domain: 'noren.test', nonce: n2.nonce, uri: 'https://noren.test', version: '1' });
  const forged = await W.other!.signMessage({ account: W.other!.account!, message: m2 });
  assert.equal((await api('/api/auth/siwe', { body: { message: m2, signature: forged } })).status, 401);
});

test('a store is an on-chain shop the session owns; someone else’s shop is refused', async () => {
  const theirs = await api('/api/stores', { token: session, body: { shopId: 1, name: 'Not mine' } });
  assert.equal(theirs.status, 403);
  assert.equal((await api('/api/stores', { token: session, body: { shopId: 9, name: 'Nope' } })).status, 404);
  const r = await api('/api/stores', { token: session, body: { shopId: 0, name: 'Aubelle' } });
  assert.equal(r.status, 201);
  assert.match(r.body.secretKey, /^sk_test_[0-9a-f]{64}$/);
  store = r.body.store;
  secret = r.body.secretKey;
  assert.equal((await api('/api/stores', { token: session, body: { shopId: 0, name: 'Again' } })).status, 409);
  const list = await api('/api/stores', { token: session });
  assert.equal(list.body.length, 1);
  assert.ok(!JSON.stringify(list.body).includes(secret.slice(14, 40)), 'the secret key is never shown again');
  assert.ok(!readFileSync(join(tmp, 'merchant.json'), 'utf8').includes(secret), 'only its hash is stored');
  const k = await api(`/api/stores/${store.id}/keys`, { token: session, method: 'POST' });
  assert.equal(k.status, 201);
  assert.notEqual(k.body.secretKey, secret);
  assert.equal((await api('/api/stores', { token: session })).body[0].keys.length, 2);
  assert.equal((await api('/api/stores', { token: 'nope' })).status, 401);
});

// ------------------------------------------------------------------ invoices

let invoice: { id: string; url: string; amountCents: number };
test('the shop’s server creates a checkout with its secret key; the checkout reads it without a key', async () => {
  const bad = await api('/api/invoices', { token: secret, body: { amountCents: 0, description: 'x' } });
  assert.equal(bad.status, 400);
  const r = await api('/api/invoices', { token: secret, body: { amountCents: 14_800, description: 'Amélie Gingham, size S', successUrl: 'https://noren-avax-shop.vercel.app/thanks', metadata: { cart: 'c1' } } });
  assert.equal(r.status, 201);
  invoice = r.body;
  assert.match(invoice.id, /^in[a-z0-9]{10}$/);
  assert.equal(invoice.url, `https://noren-avax-merchant.vercel.app/#/pay/${invoice.id}`);
  const pub = await api(`/api/invoices/${invoice.id}`);
  assert.equal(pub.body.status, 'open');
  assert.equal(pub.body.merchantName, 'Aubelle');
  assert.equal(pub.body.shopId, 0);
  assert.equal(pub.body.metadata, undefined, 'metadata stays private to the store');
  const listed = await api(`/api/stores/${store.id}/invoices`, { token: secret });
  assert.equal(listed.body[0].metadata.cart, 'c1');
  // Another store's session cannot read Aubelle's invoices.
  const other = (await signIn('other')).body.token;
  assert.equal((await api(`/api/stores/${store.id}/invoices`, { token: other })).status, 403);
});

test('invoice creation is rate-limited per store', async () => {
  let last = 0;
  for (let i = 0; i < 6; i++) last = (await api('/api/invoices', { token: session, body: { storeId: store.id, amountCents: 100, description: `link ${i}` }, ip: `198.51.100.${i}` })).status;
  assert.equal(last, 429);
});

test('a private payment naming the invoice marks it paid; the method comes from the note; no customer address is kept', async () => {
  await send(W.deployer!, d.tUSDC, [{ type: 'function', name: 'mint', inputs: [{ type: 'address' }, { type: 'uint256' }], outputs: [], stateMutability: 'nonpayable' }], 'mint', [addr('customer'), 500_000_000n]);
  assert.ok(await P.customer!.register());
  await P.customer!.shield(500_000_000n);
  // Underpaying the same invoice does not mark it paid.
  await P.customer!.pay(d.hub, 14_700n, hubNote({ shopId: 0, order: invoice.id, claim: 'ab'.repeat(8), item: 'stocks:Amélie Gingham' }));
  await hub.scan();
  assert.equal((await api(`/api/invoices/${invoice.id}`)).body.status, 'open');
  // Naming the right order at another shop does not either.
  await P.customer!.pay(d.hub, 14_800n, hubNote({ shopId: 1, order: invoice.id, claim: 'cd'.repeat(8), item: 'private:x' }));
  await hub.scan();
  assert.equal((await api(`/api/invoices/${invoice.id}`)).body.status, 'open');
  const tx = await P.customer!.pay(d.hub, 14_800n, hubNote({ shopId: 0, order: invoice.id, claim: 'ef'.repeat(8), item: 'stocks:Amélie Gingham' }));
  await hub.scan();
  const paid = (await api(`/api/invoices/${invoice.id}`)).body;
  assert.equal(paid.status, 'paid');
  assert.equal(paid.paymentTx, tx);
  assert.equal(paid.method, 'stocks');
  assert.ok(!readFileSync(join(tmp, 'merchant.json'), 'utf8').toLowerCase().includes(addr('customer').slice(2).toLowerCase()));
  const ev = (await api(`/api/stores/${store.id}/events`, { token: secret })).body;
  assert.equal(ev[0].type, 'invoice.paid');
  assert.equal(methodOf('payin3:Dress'), 'payin3');
  assert.equal(methodOf('weird:Dress'), 'private');
  assert.equal(methodOf('Dress'), 'private');
});

test('when the hub settles the batch the invoice gets its batch and the shop’s payout', async () => {
  const batch = await hub.settle(true);
  assert.equal(batch, 0);
  const inv = (await api(`/api/invoices/${invoice.id}`)).body;
  assert.equal(inv.batch, 0);
  assert.match(inv.payoutTx, /^0x[0-9a-f]{64}$/);
  const got = (await P.owner!.received()).find((x) => x.tx === inv.payoutTx);
  assert.ok(got, 'the payout is a real private transfer to the shop owner');
  assert.equal(got!.cents, 14_800n + 14_700n);
  const ev = (await api(`/api/stores/${store.id}/events`, { token: session })).body;
  assert.equal(ev[0].type, 'payout.settled');
  assert.deepEqual(ev[0].data.invoices, [invoice.id]);
});

// ------------------------------------------------------------------ stock prices

test('the price relayer signs live Yahoo Finance quotes and NorenStockOracle accepts them; a stale report is skipped', async () => {
  const relay = new PriceRelay({ pub: A.pub as never, wallet: W.relayer!, signer: privateKeyToAccount(keyOf('pricer')), d, chainId: 31337, log: () => {} });
  const tx = await relay.run();
  assert.ok(tx, relay.lastError ?? 'submitted');
  const onChain = await readStockPrices(A.pub as never, d);
  assert.equal(onChain.length, 5);
  for (const p of onChain) {
    assert.ok(p.fresh, `${p.sym} fresh`);
    assert.ok(p.price8 > 1_00000000n, `${p.sym} has a price`);
  }
  // A second run inside 9 minutes signs a new report but does not spend gas on it.
  assert.equal(await relay.run(), null);
  const s = await relay.status();
  assert.equal(s.quotes.length, 5);
  assert.ok(s.onchain?.fresh);
  // A report signed by any other key is refused by the contract.
  await new Promise((r) => setTimeout(r, 1100));
  const forged = new PriceRelay({ pub: A.pub as never, wallet: W.relayer!, signer: privateKeyToAccount(keyOf('mallory')), d, chainId: 31337, log: () => {} });
  assert.equal(await forged.run(true), null);
  assert.match(forged.lastError!, /BadSignature|reverted/);
  const [p8] = (await A.pub.readContract({ address: d.stockOracle, abi: norenStockOracleAbi, functionName: 'last', args: [d.tNVDA] })) as readonly bigint[];
  assert.equal(p8, onChain[0]!.price8);
});
