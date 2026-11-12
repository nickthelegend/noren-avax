// Fuji setup for the settlement hub round. Idempotent: every step checks the chain first.
//  1. Noren's deployer gives the new role accounts a little AVAX (Fuji gas is ~160 wei; these last for months).
//  2. The hub, two more shop owners and Harbor & Loom's accountant register eERC keys (Groth16 proofs, made here).
//  3. Kiln Row and Paper Lantern open with their catalogues (the hub's cover set needs more than one shop).
//  4. DeployHub.s.sol deploys NorenSettlement and NorenGasStation (verified on Routescan) and stocks the station.
//  5. Harbor & Loom names its accountant in NorenSettlement.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { formatEther, parseEther, type Address } from 'viem';
import { FUJI_RPC_2, norenMerchantsAbi, norenSettlementAbi, readShops } from '@noren-avax/sdk';
import { ROOT, need } from '../lib/env.ts';
import { FILE, load, privateFor, pub, record, send, wallet, type Role } from './lib.ts';

const deployer = wallet('DEPLOYER');
const gasFor: [Role, string][] = [['HUB', '0.004'], ['RELAYER', '0.006'], ['MERCHANT2', '0.002'], ['MERCHANT3', '0.002'], ['ACCOUNTANT', '0.002']];
for (const [role, amt] of gasFor) {
  const to = wallet(role).account!.address;
  const bal = await pub.getBalance({ address: to });
  if (bal >= parseEther(amt) / 2n) continue;
  const hash = await deployer.sendTransaction({ to, value: parseEther(amt), account: deployer.account!, chain: deployer.chain });
  await pub.waitForTransactionReceipt({ hash });
  record(`gas_${role.toLowerCase()}`, hash, deployer.account!.address, `deployer sends ${amt} AVAX for gas to the ${role.toLowerCase()} account`);
}

let d = load();
for (const role of ['HUB', 'MERCHANT2', 'MERCHANT3', 'ACCOUNTANT'] as Role[]) {
  const p = privateFor(wallet(role), d);
  if (await p.isRegistered()) continue;
  record(`register_${role.toLowerCase()}`, (await p.register())!, wallet(role).account!.address, `${role.toLowerCase()} registers its eERC public key (Groth16 registration proof)`);
}

const shops: [Role, string, string, [string, bigint][]][] = [
  ['MERCHANT2', 'Kiln Row', 'kiln-row', [['Speckled bowl', 2200n], ['Pour-over cone', 2800n], ['Bud vase', 1600n]]],
  ['MERCHANT3', 'Paper Lantern', 'paper-lantern', [['Washi notebook', 1400n], ['Brass pen', 3200n], ['Letterpress cards', 1200n]]],
];
for (const [role, name, slug, items] of shops) {
  const w = wallet(role);
  let s = (await readShops(pub as never, d)).find((x) => x.slug === slug);
  if (!s) {
    record(`open_${slug}`, await send(w, d.norenMerchants, norenMerchantsAbi, 'openShop', [name, slug]), w.account!.address, `${name} opens on Noren Merchant`);
    s = (await readShops(pub as never, d)).find((x) => x.slug === slug)!;
  }
  for (const [i, [item, cents]] of items.entries()) {
    if (s.items.some((it) => it.name === item)) continue;
    record(`list_${slug}_${i}`, await send(w, d.norenMerchants, norenMerchantsAbi, 'listItem', [BigInt(s.id), item, cents]), w.account!.address, `${name} lists ${item} at ${Number(cents) / 100} tUSDC`);
  }
}

if (!(d as { norenSettlement?: string }).norenSettlement) {
  const out = join(ROOT, 'deployments/fuji-hub.json');
  const key = need('NOREN_DEPLOYER_KEY');
  const r = spawnSync(
    'forge',
    ['script', 'script/DeployHub.s.sol', '--rpc-url', FUJI_RPC_2, '--broadcast', '--slow', '--verify', '--verifier', 'etherscan',
      '--verifier-url', 'https://api.routescan.io/v2/network/testnet/evm/43113/etherscan', '--etherscan-api-key', 'verifyContract'],
    {
      cwd: join(ROOT, 'contracts'),
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
      env: { ...process.env, NOREN_DEPLOYER_KEY: key, NOREN_IN: FILE, NOREN_OUT: out, NOREN_HUB: wallet('HUB').account!.address, NOREN_RELAYER: wallet('RELAYER').account!.address },
    },
  );
  const scrub = (s: string) => s.split(key.replace(/^0x/, '')).join('<redacted>');
  console.log(scrub(r.stdout ?? '').split('\n').filter((l) => /Noren|Success|verif|Error|error/.test(l)).join('\n'));
  if (r.status !== 0) {
    console.error(scrub(r.stderr ?? '').slice(-3000));
    process.exit(r.status ?? 1);
  }
  const hub = JSON.parse(readFileSync(out, 'utf8'));
  const b = JSON.parse(readFileSync(join(ROOT, 'contracts/broadcast/DeployHub.s.sol/43113/run-latest.json'), 'utf8'));
  const cur = load();
  const what: Record<string, string> = { NorenSettlement: 'deploy NorenSettlement', NorenGasStation: 'deploy NorenGasStation' };
  cur.txs = cur.txs ?? {};
  let n = 0;
  for (const t of b.transactions as { hash: `0x${string}`; contractName?: string; transactionType: string; function?: string }[]) {
    const label = t.transactionType === 'CREATE' ? what[t.contractName ?? ''] ?? `deploy ${t.contractName}` : `${t.function ?? 'call'} (station stock or AVAX)`;
    cur.txs[`hub_deploy_${n++}`] = { hash: t.hash, by: cur.deployer, what: label };
  }
  Object.assign(cur, hub);
  writeFileSync(FILE, JSON.stringify(cur, null, 2) + '\n');
  console.log('hub contracts recorded in deployments/fuji.json');
}

d = load();
const hd = d as typeof d & { norenSettlement: Address };
const harbor = (await readShops(pub as never, d)).find((s) => s.slug === 'harbor-loom')!;
const accountant = wallet('ACCOUNTANT').account!.address;
const cur = (await pub.readContract({ address: hd.norenSettlement, abi: norenSettlementAbi, functionName: 'accountantOf', args: [BigInt(harbor.id)] })) as Address;
if (cur.toLowerCase() !== accountant.toLowerCase())
  record('set_accountant', await send(wallet('MERCHANT'), hd.norenSettlement, norenSettlementAbi, 'setAccountant', [BigInt(harbor.id), accountant]), wallet('MERCHANT').account!.address, 'Harbor & Loom names its accountant in NorenSettlement', { accountant });
console.log(`deployer left ${formatEther(await pub.getBalance({ address: deployer.account!.address }))} AVAX`);
process.exit(0);
