// End-to-end privacy path on a local Anvil chain (not a fork): the real Foundry deployment, Ava Labs'
// eERC contracts with their production Groth16 verifiers, and real proofs from the official SDK.
// It also records the calldata as fixtures that contracts/test/NorenPrivacy.t.sol replays in Foundry.
//
//   node --test --test-force-exit scripts/anvil/privacy.test.ts   (snarkjs keeps worker threads alive)
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  createWalletClient,
  decodeFunctionData,
  encodeFunctionData,
  erc20Abi,
  http,
  keccak256,
  pad,
  parseEventLogs,
  toHex,
  type Address,
  type Hex,
  type WalletClient,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import {
  NorenPrivate,
  circuitURLs,
  encryptedErcAbi,
  local,
  norenCreditAbi,
  norenMerchantsAbi,
  norenTokenAbi,
  publicClientFor,
  type Deployment,
} from '@noren-avax/sdk';
import { ROOT } from '../lib/env.ts';
import { formatKey } from '../lib/babyjub.ts';

const PORT = 5391;
const RPC = `http://127.0.0.1:${PORT}`;
// Anvil's well-known first dev account (public test key, holds nothing anywhere else).
const ANVIL_DEV_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
// Same keys as Foundry's makeAddr(label): key = keccak256(label), so the fixtures replay at the same addresses.
const keyOf = (label: string) => keccak256(toHex(label));

const chain = local(RPC);
const pub = publicClientFor(chain, http(RPC));
const circuits = circuitURLs(join(ROOT, 'web/public/circuits'));
const wallet = (k: Hex) => createWalletClient({ account: privateKeyToAccount(k), chain, transport: http(RPC) });

let anvil: ChildProcess;
let d: Deployment;
const W: Record<string, WalletClient> = {};
const P: Record<string, NorenPrivate> = {};
const fx: Record<string, unknown> = {};

async function waitRpc() {
  for (let i = 0; i < 50; i++) {
    try {
      await pub.getBlockNumber();
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  throw new Error('anvil did not start');
}

async function send(w: WalletClient, address: Address, abi: readonly unknown[], functionName: string, args: unknown[], value?: bigint) {
  const hash = await w.writeContract({ address, abi: abi as never, functionName, args: args as never, value, account: w.account!, chain } as never);
  const r = await pub.waitForTransactionReceipt({ hash });
  assert.equal(r.status, 'success', `${functionName} reverted`);
  return r;
}

/** Sends raw calldata and expects a revert (estimateGas fails, so the tx never lands). */
async function expectRevert(from: Address, to: Address, data: Hex) {
  await assert.rejects(pub.call({ account: from, to, data }), 'expected a revert');
}

before(async () => {
  anvil = spawn('anvil', ['--port', String(PORT), '--chain-id', '31337', '--silent', '--code-size-limit', '100000'], { stdio: 'ignore' });
  await waitRpc();
  const out = join(ROOT, '.anvil');
  mkdirSync(out, { recursive: true });
  execFileSync('forge', ['script', 'script/Deploy.s.sol', '--rpc-url', RPC, '--broadcast', '--slow'], {
    cwd: join(ROOT, 'contracts'),
    env: { ...process.env, NOREN_DEPLOYER_KEY: ANVIL_DEV_KEY, NOREN_OUT: join(out, 'local.json') },
    stdio: 'ignore',
  });
  d = JSON.parse(readFileSync(join(out, 'local.json'), 'utf8'));
  W.deployer = wallet(ANVIL_DEV_KEY);
  for (const who of ['customer', 'merchant', 'auditor', 'stranger']) {
    W[who] = wallet(keyOf(who));
    await pub.request({ method: 'anvil_setBalance' as never, params: [W[who]!.account!.address, toHex(10n ** 20n)] as never });
    P[who] = new NorenPrivate(pub, W[who]!, d, circuits);
  }
});

after(() => {
  anvil?.kill('SIGTERM');
});

test('three parties register their eERC keys with Groth16 proofs', async () => {
  fx.registrations = {};
  for (const who of ['customer', 'merchant', 'auditor']) {
    const h = await P[who]!.register();
    assert.ok(h, `${who} registered`);
    const tx = await pub.getTransaction({ hash: h! });
    (fx.registrations as Record<string, Hex>)[who] = tx.input;
    assert.ok(await P[who]!.isRegistered());
  }
  assert.equal(await P.stranger!.isRegistered(), false);
  await send(W.deployer!, d.encryptedERC, encryptedErcAbi, 'setAuditorPublicKey', [W.auditor!.account!.address]);
  assert.equal(await P.customer!.auditor(), W.auditor!.account!.address);
});

test('a shop opens only after registering for private payments', async () => {
  await assert.rejects(
    pub.simulateContract({ address: d.norenMerchants, abi: norenMerchantsAbi, functionName: 'openShop', args: ['Stranger Things', 'stranger'], account: W.stranger!.account! }),
  );
  await send(W.merchant!, d.norenMerchants, norenMerchantsAbi, 'openShop', ['Kinari Studio', 'kinari']);
  await send(W.merchant!, d.norenMerchants, norenMerchantsAbi, 'listItem', [0n, 'Linen tote', 2400n]);
});

let pay1: Hex;
test('customer pays the shop privately: the amount is nowhere on chain in the clear', async () => {
  await send(W.customer!, d.tUSDC, norenTokenAbi, 'faucet', []);
  const shielded = await P.customer!.shield(100_000_000n, undefined); // 100 tUSDC -> 10,000 cents
  const dep = decodeFunctionData({ abi: encryptedErcAbi, data: (await pub.getTransaction({ hash: shielded.deposit })).input });
  fx.deposits = [{ amount: (dep.args as unknown[])[0], amountPCT: (dep.args as unknown[])[2] }];
  assert.equal((await P.customer!.balance()).cents, 10_000n);

  const lockedBefore = await pub.readContract({ address: d.tUSDC, abi: erc20Abi, functionName: 'balanceOf', args: [d.encryptedERC] });
  pay1 = await P.customer!.pay(W.merchant!.account!.address, 2_400n, 'order 1 · Linen tote');
  const tx = await pub.getTransaction({ hash: pay1 });
  const rc = await pub.getTransactionReceipt({ hash: pay1 });
  (fx.transfers = [] as Hex[]).push(tx.input);

  // No public token moved; the contract's tUSDC is unchanged.
  const erc20Moves = parseEventLogs({ abi: erc20Abi, logs: rc.logs, eventName: 'Transfer' });
  assert.equal(erc20Moves.length, 0);
  const lockedAfter = await pub.readContract({ address: d.tUSDC, abi: erc20Abi, functionName: 'balanceOf', args: [d.encryptedERC] });
  assert.equal(lockedAfter, lockedBefore);
  // The plaintext amount (2400 cents, or 24 tUSDC in 6 decimals) appears in no calldata or log word.
  const words = (h: Hex) => (h.slice(2).match(/.{64}/g) ?? []).map((w) => BigInt(`0x${w}`));
  const corpus = [tx.input.slice(10), ...rc.logs.flatMap((l) => [l.data.slice(2), ...l.topics.map((t) => t.slice(2))])].join('');
  for (const v of [2_400n, 24_000_000n]) assert.ok(!words(`0x${corpus}` as Hex).includes(v), `plaintext ${v} found on chain`);
  assert.ok(!corpus.includes(pad(toHex(2_400n)).slice(2)));
});

test('the shop decrypts its revenue and the memo with its own key', async () => {
  assert.equal((await P.merchant!.balance()).cents, 2_400n);
  const got = await P.merchant!.received();
  assert.equal(got.length, 1);
  assert.equal(got[0]!.cents, 2_400n);
  assert.equal(got[0]!.memo, 'order 1 · Linen tote');
  assert.equal(got[0]!.from, W.customer!.account!.address);
});

test('the auditor decrypts the same payment; other keys cannot', async () => {
  const a = await P.auditor!.audit();
  const t = a.find((e) => e.tx === pay1)!;
  assert.equal(t.kind, 'Transfer');
  assert.equal(t.cents, 2_400n);
  // The customer's key run over the auditor ciphertext does not give the amount.
  const notAuditor = await P.customer!.audit().catch(() => []);
  assert.equal(notAuditor.filter((e) => e.kind === 'Transfer').length, 0, 'auditor logs are filtered to the auditor address');
  const log = (await pub.getTransactionReceipt({ hash: pay1 })).logs;
  const ev = parseEventLogs({ abi: encryptedErcAbi, logs: log, eventName: 'PrivateTransfer' })[0]!;
  let wrong: bigint | null = null;
  try {
    wrong = P.customer!.eerc.decryptPCT([...(ev.args as { auditorPCT: readonly bigint[] }).auditorPCT]);
  } catch {
    wrong = null;
  }
  assert.notEqual(wrong, 2_400n);
});

let pay2: Hex;
test('borrow against tWBTC and pay the shop privately with the credit', async () => {
  await send(W.customer!, d.tWBTC, norenTokenAbi, 'faucet', []); // 0.01 tWBTC = $730 at the local feed
  await send(W.customer!, d.tWBTC, erc20Abi, 'approve', [d.norenCredit, 10n ** 6n]);
  await send(W.customer!, d.norenCredit, norenCreditAbi, 'depositCollateral', [d.tWBTC, 1_000_000n]);
  await send(W.customer!, d.norenCredit, norenCreditAbi, 'borrow', [36_000_000n, W.customer!.account!.address]);
  const s = await P.customer!.shield(36_000_000n);
  const dep = decodeFunctionData({ abi: encryptedErcAbi, data: (await pub.getTransaction({ hash: s.deposit })).input });
  (fx.deposits as unknown[]).push({ amount: (dep.args as unknown[])[0], amountPCT: (dep.args as unknown[])[2] });
  pay2 = await P.customer!.pay(W.merchant!.account!.address, 3_600n, 'order 2 · Indigo throw, on credit');
  (fx.transfers as Hex[]).push((await pub.getTransaction({ hash: pay2 })).input);
  assert.equal((await P.merchant!.balance()).cents, 6_000n);
  assert.equal((await P.customer!.balance()).cents, 10_000n - 2_400n + 3_600n - 3_600n);
  const debt = await pub.readContract({ address: d.norenCredit, abi: norenCreditAbi, functionName: 'debtOf', args: [W.customer!.account!.address] });
  assert.ok((debt as bigint) >= 36_000_000n);
});

test('a tampered proof, a replayed proof and a stolen proof are all rejected on chain', async () => {
  const input = (await pub.getTransaction({ hash: pay2 })).input;
  const call = decodeFunctionData({ abi: encryptedErcAbi, data: input });
  const args = [...(call.args as unknown[])];
  const proof = structuredClone(args[2]) as { proofPoints: { a: bigint[] }; publicSignals: bigint[] };
  // 1. tamper: claim a different receiver ciphertext
  proof.publicSignals = [...proof.publicSignals];
  proof.publicSignals[14] = proof.publicSignals[14]! + 1n;
  const tampered = encodeFunctionData({ abi: encryptedErcAbi, functionName: 'transfer', args: [args[0], args[1], proof, args[3], args[4]] as never });
  await expectRevert(W.customer!.account!.address, d.encryptedERC, tampered);
  // 2. replay the exact payment: the sender's balance ciphertext no longer matches
  await expectRevert(W.customer!.account!.address, d.encryptedERC, input);
  // 3. someone else submits the customer's proof
  await expectRevert(W.auditor!.account!.address, d.encryptedERC, input);
});

test('the shop withdraws its private revenue to public tUSDC; the auditor sees the withdrawal', async () => {
  const before = await pub.readContract({ address: d.tUSDC, abi: erc20Abi, functionName: 'balanceOf', args: [W.merchant!.account!.address] });
  const h = await P.merchant!.withdraw(6_000n, 'payout');
  fx.withdraw = (await pub.getTransaction({ hash: h })).input;
  const afterBal = await pub.readContract({ address: d.tUSDC, abi: erc20Abi, functionName: 'balanceOf', args: [W.merchant!.account!.address] });
  assert.equal(afterBal - before, 60_000_000n);
  assert.equal((await P.merchant!.balance()).cents, 0n);
  const a = await P.auditor!.audit();
  assert.equal(a.find((e) => e.tx === h)?.cents, 6_000n);
});

test('the customer repays the credit line', async () => {
  const me = W.customer!.account!.address;
  // Interest accrued per second; pay what the contract reports plus a cent of headroom.
  await send(W.deployer!, d.tUSDC, norenTokenAbi, 'mint', [me, 1_000_000n]);
  await send(W.customer!, d.tUSDC, erc20Abi, 'approve', [d.norenCredit, 10n ** 12n]);
  await send(W.customer!, d.norenCredit, norenCreditAbi, 'repay', [me, 2n ** 256n - 1n]);
  assert.equal(await pub.readContract({ address: d.norenCredit, abi: norenCreditAbi, functionName: 'debtOf', args: [me] }), 0n);
});

test('write the Foundry fixtures', async () => {
  const keys: Record<string, string> = {};
  for (const who of ['customer', 'merchant', 'auditor']) {
    const raw = await P[who]!.eerc.generateDecryptionKey();
    const sk = formatKey(raw);
    const pk = P[who]!.eerc.curve.generatePublicKey(sk);
    const onchain = (await pub.readContract({ address: d.registrar, abi: [{ type: 'function', name: 'getUserPublicKey', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256[2]' }] }] as const, functionName: 'getUserPublicKey', args: [W[who]!.account!.address] })) as readonly bigint[];
    assert.deepEqual([pk[0], pk[1]], [onchain[0], onchain[1]], `${who} scalar matches the registered key`);
    keys[who] = sk.toString();
  }
  const out = {
    note: 'Recorded by scripts/anvil/privacy.test.ts on Anvil (chain 31337) with @avalabs/eerc-sdk 1.0.2 proofs. Test-only keys.',
    customer: W.customer!.account!.address,
    merchant: W.merchant!.account!.address,
    auditor: W.auditor!.account!.address,
    sk: keys,
    amounts: { pay1: '2400', pay2: '3600', withdraw: '6000' },
    registrations: fx.registrations,
    deposits: (fx.deposits as { amount: bigint; amountPCT: readonly bigint[] }[]).map((x) => ({ amount: x.amount.toString(), amountPCT: x.amountPCT.map(String) })),
    transfers: fx.transfers,
    withdraw: fx.withdraw,
  };
  mkdirSync(join(ROOT, 'contracts/test/fixtures'), { recursive: true });
  writeFileSync(join(ROOT, 'contracts/test/fixtures/eerc-anvil.json'), JSON.stringify(out, null, 2));
});

process.on('exit', () => anvil?.kill('SIGTERM'));
