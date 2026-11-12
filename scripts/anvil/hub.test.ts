// The settlement hub and the judge gas station end to end on a local Anvil chain (not a fork): the real Foundry
// deployment (Deploy + DeployHub), Ava Labs' eERC with its production verifiers, real proofs from the official SDK,
// and the hub service's own code (hub/src/hub.ts, hub/src/gas.ts) driving it.
//
//   node --test --test-force-exit scripts/anvil/hub.test.ts
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { createWalletClient, http, keccak256, parseEventLogs, toHex, verifyMessage, type Address, type Hex, type WalletClient } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import {
  NorenPrivate,
  accountantOf,
  checkStatement,
  circuitURLs,
  decryptNote,
  encryptedErcAbi,
  gasDigest,
  hubNote,
  norenMerchantsAbi,
  norenSettlementAbi,
  norenTokenAbi,
  parseStatement,
  privateTransferEvent,
  readBatches,
  readPayouts,
  receiptText,
  scanLogs,
  settledIn,
  statementDigest,
  type AuditorStatement,
  type HubDeployment,
} from '@noren-avax/sdk';
import { Hub } from '../../hub/src/hub.ts';
import { GasRelay } from '../../hub/src/gas.ts';
import { ROOT } from '../lib/env.ts';
import { startAnvil } from './chain.ts';

const ANVIL_DEV_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const keyOf = (label: string) => keccak256(toHex(`noren-hub-test:${label}`));
const circuits = circuitURLs(join(ROOT, 'web/public/circuits'));
// forge may only write under .anvil (foundry.toml fs_permissions); one folder per run.
const tmp = join(ROOT, '.anvil', `hub-${process.pid}`);
rmSync(tmp, { recursive: true, force: true });
mkdirSync(tmp, { recursive: true });

let A: Awaited<ReturnType<typeof startAnvil>>;
let d: HubDeployment;
const W: Record<string, WalletClient> = {};
const P: Record<string, NorenPrivate> = {};
let hub: Hub;
let gas: GasRelay;
const shop = { a: 0, b: 1, c: 2 };

const wallet = (k: Hex) => createWalletClient({ account: privateKeyToAccount(k), chain: A.chain, transport: http(A.rpc) });
const addr = (who: string) => W[who]!.account!.address;

async function send(w: WalletClient, address: Address, abi: readonly unknown[], functionName: string, args: unknown[]) {
  const hash = await w.writeContract({ address, abi: abi as never, functionName, args: args as never, account: w.account!, chain: A.chain } as never);
  const r = await A.pub.waitForTransactionReceipt({ hash });
  assert.equal(r.status, 'success', `${functionName} reverted`);
  return r;
}
const fund = (a: Address) => A.pub.request({ method: 'anvil_setBalance' as never, params: [a, toHex(10n ** 20n)] as never });
const forge = (script: string, env: Record<string, string>) =>
  execFileSync('forge', ['script', script, '--rpc-url', A.rpc, '--broadcast', '--slow'], { cwd: join(ROOT, 'contracts'), env: { ...process.env, NOREN_DEPLOYER_KEY: ANVIL_DEV_KEY, ...env }, stdio: 'ignore' });

before(async () => {
  A = await startAnvil();
  forge('script/Deploy.s.sol', { NOREN_OUT: join(tmp, 'base.json') });
  const base = JSON.parse(readFileSync(join(tmp, 'base.json'), 'utf8'));
  W.deployer = wallet(ANVIL_DEV_KEY);
  for (const who of ['hub', 'relayer', 'auditor', 'ownerA', 'ownerB', 'ownerC', 'accountant', 'stranger']) {
    W[who] = wallet(keyOf(who));
    if (who !== 'relayer') await fund(addr(who));
    P[who] = new NorenPrivate(A.pub, W[who]!, base, circuits);
  }
  await fund(addr('relayer'));
  for (const who of ['hub', 'auditor', 'ownerA', 'ownerB', 'ownerC', 'accountant']) assert.ok(await P[who]!.register(), `${who} registers`);
  await send(W.deployer!, base.encryptedERC, encryptedErcAbi, 'setAuditorPublicKey', [addr('auditor')]);
  for (const [who, name, slug] of [['ownerA', 'Harbor & Loom', 'harbor-loom'], ['ownerB', 'Kiln Row', 'kiln-row'], ['ownerC', 'Paper Lantern', 'paper-lantern']] as const)
    await send(W[who]!, base.norenMerchants, norenMerchantsAbi, 'openShop', [name, slug]);
  forge('script/DeployHub.s.sol', { NOREN_IN: join(tmp, 'base.json'), NOREN_OUT: join(tmp, 'hub.json'), NOREN_HUB: addr('hub'), NOREN_RELAYER: addr('relayer') });
  d = { ...base, ...JSON.parse(readFileSync(join(tmp, 'hub.json'), 'utf8')) };
  for (const who of Object.keys(P)) P[who] = new NorenPrivate(A.pub, W[who]!, d, circuits);
  for (const who of Object.keys(P)) await P[who]!.unlock();
  hub = new Hub({ pub: A.pub as never, wallet: W.hub!, d, circuits, stateFile: join(tmp, 'state.json'), everySec: 60, coverMin: 3, log: () => {} });
  await hub.start();
  gas = new GasRelay(A.pub as never, W.relayer!, d, 'test-salt');
});

after(() => {
  A?.stop();
  rmSync(tmp, { recursive: true, force: true });
});

// ------------------------------------------------------------------ zero-setup start

let judgeKey: Hex;
test('an empty wallet signs once and gets gas, 100 tUSDC and 0.01 tWBTC in one relayed transaction', async () => {
  judgeKey = generatePrivateKey();
  const j = privateKeyToAccount(judgeKey);
  assert.equal(await A.pub.getBalance({ address: j.address }), 0n);
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);
  const sig = await j.signMessage({ message: { raw: gasDigest(31337, d.norenGasStation, j.address, deadline) } });
  const { hash } = await gas.drip({ to: j.address, deadline: String(deadline), sig }, '203.0.113.7');
  const rc = await A.pub.getTransactionReceipt({ hash });
  assert.equal(rc.from.toLowerCase(), addr('relayer').toLowerCase());
  assert.equal(await A.pub.getBalance({ address: j.address }), 2n * 10n ** 14n);
  const bal = (t: Address) => A.pub.readContract({ address: t, abi: norenTokenAbi, functionName: 'balanceOf', args: [j.address] });
  assert.equal(await bal(d.tUSDC), 100_000_000n);
  assert.equal(await bal(d.tWBTC), 1_000_000n);
  // Asking again, with a signature from someone else, or for a wallet that has AVAX: refused before any gas is spent.
  await assert.rejects(gas.drip({ to: j.address, deadline: String(deadline), sig }, '203.0.113.7'), /already/);
  const other = privateKeyToAccount(generatePrivateKey());
  const forged = await privateKeyToAccount(generatePrivateKey()).signMessage({ message: { raw: gasDigest(31337, d.norenGasStation, other.address, deadline) } });
  await assert.rejects(gas.drip({ to: other.address, deadline: String(deadline), sig: forged }, '203.0.113.8'), /not from this wallet/);
  const s = await gas.status('203.0.113.7');
  assert.equal(s.youLeft, 2);
});

test('the funded judge wallet registers for private payments and tops up', async () => {
  W.customer = wallet(judgeKey);
  // Anvil's default gas price is ~1 gwei, far above Fuji's ~160 wei, so the 0.0002 AVAX drip would not cover these
  // proofs here; on Fuji it does (the live judge run in deployments/fuji.json uses only the drip).
  await fund(addr('customer'));
  P.customer = new NorenPrivate(A.pub, W.customer, d, circuits);
  await P.customer.unlock();
  assert.ok(await P.customer.register());
  await P.customer.shield(100_000_000n);
  assert.equal((await P.customer.balance()).cents, 10_000n);
});

// ------------------------------------------------------------------ paying through the hub

test('a shop names its accountant; only registered keys qualify', async () => {
  await send(W.ownerA!, d.norenSettlement, norenSettlementAbi, 'setAccountant', [BigInt(shop.a), addr('accountant')]);
  assert.equal(await accountantOf(A.pub, d, shop.a), addr('accountant'));
  await assert.rejects(
    A.pub.simulateContract({ address: d.norenSettlement, abi: norenSettlementAbi, functionName: 'setAccountant', args: [BigInt(shop.b), addr('relayer')], account: W.ownerB!.account! }),
  );
});

const pays: Record<string, { tx: Hex; claim: string }> = {};
test('the customer pays the hub, not the shop: Snowtrace cannot link the customer to Harbor & Loom', async () => {
  const claim = () => keccak256(toHex(Math.random().toString())).slice(2, 34);
  for (const [k, cents, note] of [
    ['tote', 2_400n, { shopId: shop.a, order: 'A1B2C3', item: 'Linen tote' }],
    ['mug', 1_800n, { shopId: shop.a, order: 'D4E5F6', item: 'Stoneware mug' }],
  ] as const) {
    const c = claim();
    pays[k] = { tx: await P.customer!.pay(d.hub, cents, hubNote({ ...note, claim: c })), claim: c };
  }
  const c = claim();
  pays.bad = { tx: await P.customer!.pay(d.hub, 500n, 'pay the kiln please'), claim: c };
  const transfers = await scanLogs(A.pub, { address: d.encryptedERC, event: privateTransferEvent, args: { from: addr('customer') }, fromBlock: 0n });
  assert.equal(transfers.length, 3);
  for (const t of transfers) assert.equal((t.args.to as string).toLowerCase(), d.hub.toLowerCase());
});

test('the hub reads its payments and signs receipts only for whoever holds the claim', async () => {
  assert.equal(await hub.scan(), 3);
  assert.equal(await hub.settle(), null, 'nothing settles before the clock boundary');
  const bad = await hub.receipt(pays.tote!.tx, 'not-the-claim');
  assert.equal(bad.status, 'forbidden');
  const r = (await hub.receipt(pays.tote!.tx, pays.tote!.claim)) as { status: string; cents: string; shopId: number; order: string; signature: Hex; tx: Hex };
  assert.equal(r.status, 'queued');
  assert.equal(r.cents, '2400');
  assert.equal(r.shopId, shop.a);
  const text = receiptText({ tx: r.tx, shopId: r.shopId, cents: r.cents, order: r.order, chainId: 31337 });
  assert.ok(await verifyMessage({ address: d.hub, message: text, signature: r.signature }));
  assert.equal(hub.state.queued.find((q) => q.tx === pays.bad!.tx)?.problem, 'no Noren note (which shop?)');
});

test('one batch pays Harbor & Loom its total, two other shops zero as cover, and refunds the bad payment', async () => {
  const id = await hub.settle(true);
  assert.equal(id, 0);
  for (const k of ['tote', 'mug', 'bad']) assert.equal(await settledIn(A.pub, d, pays[k]!.tx), 0);
  const [b] = await readBatches(A.pub, d);
  assert.equal(b!.payments.length, 3);
  assert.equal(b!.payoutTxs.length, 3, 'three shops paid: one real, two cover');
  assert.equal(b!.refunds.length, 1);
  const payouts = await readPayouts(A.pub, d);
  assert.deepEqual(payouts.map((p) => p.shopId).sort(), [0, 1, 2]);
  // Every payout on chain comes from the hub; the amounts are ciphertexts like any other eERC transfer.
  for (const p of payouts) {
    const ev = parseEventLogs({ abi: encryptedErcAbi, logs: (await A.pub.getTransactionReceipt({ hash: p.payoutTx })).logs, eventName: 'PrivateTransfer' })[0]!;
    assert.equal((ev.args as { from: string }).from.toLowerCase(), d.hub.toLowerCase());
  }
  assert.equal((await P.customer!.balance()).cents, 10_000n - 2_400n - 1_800n - 500n + 500n);
});

test('the shop decrypts its payout and statement; both check out against the chain', async () => {
  const got = (await P.ownerA!.received()).filter((x) => x.from.toLowerCase() === d.hub.toLowerCase());
  assert.equal(got.length, 1);
  assert.equal(got[0]!.cents, 4_200n);
  const st = parseStatement(got[0]!.memo!)!;
  assert.equal(st.items.length, 2);
  assert.deepEqual(checkStatement(st, got[0]!.cents), []);
  const onChain = (await readPayouts(A.pub, d, shop.a))[0]!;
  assert.equal(onChain.payoutTx, got[0]!.tx);
  assert.equal(onChain.digest, statementDigest(got[0]!.memo!));
  assert.equal((await P.ownerA!.balance()).cents, 4_200n);
  // A cover payout is a real eERC transfer of zero with a statement that says so.
  const cover = (await P.ownerB!.received()).filter((x) => x.from.toLowerCase() === d.hub.toLowerCase())[0]!;
  assert.equal(cover.cents, 0n);
  assert.equal(parseStatement(cover.memo!)!.cover, true);
  assert.equal((await P.ownerB!.balance()).cents, 0n);
});

test('a tampered statement fails the checks', async () => {
  const got = (await P.ownerA!.received()).find((x) => x.from.toLowerCase() === d.hub.toLowerCase())!;
  const digest = (await readPayouts(A.pub, d, shop.a))[0]!.digest;
  const items = parseStatement(got.memo!)!;
  items.items[0]!.cents = '2500'; // an item changed: the lines no longer add up
  assert.match(checkStatement(items, got.cents).join(), /items add up to 4300/);
  const total = parseStatement(got.memo!)!;
  total.items[0]!.cents = '2500';
  total.total = '4300'; // lines and total changed together: the decrypted payout gives it away
  assert.match(checkStatement(total, got.cents).join(), /payout decrypts to 4200/);
  for (const st of [items, total]) assert.notEqual(statementDigest(JSON.stringify(st)), digest);
});

test('the shop’s accountant decrypts its copy of the statement; no other key does', async () => {
  const p = (await readPayouts(A.pub, d, shop.a))[0]!;
  assert.equal(p.accountant, addr('accountant'));
  const text = P.accountant!.readNote(p.forAccountant);
  assert.equal(statementDigest(text), p.digest);
  assert.equal(parseStatement(text)!.total, '4200');
  assert.throws(() => decryptNote(P.ownerB!.eerc.poseidon as never, P.ownerB!.secretKey(), p.forAccountant));
  const unaccounted = (await readPayouts(A.pub, d, shop.b))[0]!;
  assert.equal(unaccounted.forAccountant, '0x');
});

test('the auditor checks the whole batch against eERC ciphertexts: every payment once, payouts add up', async () => {
  const [b] = await readBatches(A.pub, d);
  const aud = JSON.parse(P.auditor!.readNote(b!.forAuditor)) as AuditorStatement;
  const audit = await P.auditor!.audit();
  const amount = (tx: Hex) => audit.find((e) => e.tx === tx && e.kind === 'Transfer')!.cents!;
  let inSum = 0n;
  let outSum = 0n;
  const seen = new Set<string>();
  const onChain = await readPayouts(A.pub, d);
  for (const p of aud.payouts) {
    const st = parseStatement(p.statement)!;
    assert.equal(statementDigest(p.statement), onChain.find((x) => x.payoutTx === p.payoutTx)!.digest);
    assert.equal(amount(p.payoutTx), BigInt(st.total), `payout to shop ${p.shop} matches its statement`);
    outSum += amount(p.payoutTx);
    for (const it of st.items) {
      assert.equal(amount(it.tx), BigInt(it.cents), `payment ${it.tx} matches`);
      seen.add(it.tx);
    }
  }
  for (const r of aud.refunds) {
    assert.equal(amount(r.tx), amount(r.refundTx));
    outSum += amount(r.refundTx);
    seen.add(r.tx);
  }
  for (const tx of b!.payments) inSum += amount(tx);
  assert.deepEqual([...seen].sort(), [...b!.payments].sort());
  assert.equal(inSum, outSum);
  assert.equal(inSum, 4_700n);
  assert.equal((await P.hub!.balance()).cents, 0n);
});

test('the hub cannot settle a payment twice, even through a fresh process', async () => {
  assert.equal(await hub.settle(true), null);
  const again = new Hub({ pub: A.pub as never, wallet: W.hub!, d, circuits, stateFile: join(tmp, 'state-fresh.json'), everySec: 60, coverMin: 3, log: () => {} });
  await again.start();
  await again.scan(); // re-reads every payment since the deploy block
  await assert.rejects(
    A.pub.simulateContract({
      address: d.norenSettlement,
      abi: norenSettlementAbi,
      functionName: 'settle',
      args: [[pays.tote!.tx], [{ shopId: 0n, payoutTx: keccak256('0x01'), digest: keccak256('0x02'), forAccountant: '0x01' }], [], '0x'],
      account: W.hub!.account!,
    }),
    /AlreadySettled/,
  );
  assert.equal(await again.settle(true), null, 'the fresh hub drops payments the chain already settled');
});

test('a hub that crashes mid-batch finishes it on restart without paying anyone twice', async () => {
  const c = 'aa'.repeat(8);
  const tx = await P.customer!.pay(d.hub, 1_200n, hubNote({ shopId: shop.a, order: 'G7H8J9', item: 'Wool throw', claim: c }));
  await hub.scan();
  const realPay = hub.priv.pay.bind(hub.priv);
  let calls = 0;
  hub.priv.pay = async (...a) => {
    if (++calls === 2) throw new Error('simulated crash');
    return realPay(...a);
  };
  await assert.rejects(hub.settle(true), /simulated crash/);
  assert.ok(hub.state.inflight);
  const restarted = new Hub({ pub: A.pub as never, wallet: W.hub!, d, circuits, stateFile: join(tmp, 'state.json'), everySec: 60, coverMin: 3, log: () => {} });
  await restarted.start();
  assert.equal(await restarted.settle(), 1);
  assert.equal(await settledIn(A.pub, d, tx), 1);
  assert.equal((await P.ownerA!.balance()).cents, 4_200n + 1_200n);
  assert.equal((await readBatches(A.pub, d))[0]!.payoutTxs.length, 3);
  const r = (await restarted.receipt(tx, c)) as { status: string; batch: number };
  assert.equal(r.status, 'settled');
  assert.equal(r.batch, 1);
});
