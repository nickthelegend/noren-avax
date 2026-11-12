// One-time Fuji setup: register the auditor's eERC key and set it on the contract; register the demo shop's
// owner, open the shop and list its catalogue. The customer flows run from the web app.
import { encryptedErcAbi, norenMerchantsAbi, readShops } from '@noren-avax/sdk';
import { load, privateFor, pub, record, send, wallet } from './lib.ts';

const d = load();
const deployer = wallet('DEPLOYER');
const auditor = wallet('AUDITOR');
const merchant = wallet('MERCHANT');

for (const [name, w] of [['auditor', auditor], ['merchant', merchant]] as const) {
  const p = privateFor(w, d);
  if (await p.isRegistered()) console.log(`${name} already registered`);
  else record(`register_${name}`, (await p.register())!, w.account!.address, `${name} registers its eERC public key (Groth16 registration proof)`);
}
const current = (await pub.readContract({ address: d.encryptedERC, abi: encryptedErcAbi, functionName: 'auditor' })) as string;
if (current.toLowerCase() !== auditor.account!.address.toLowerCase()) {
  const h = await send(deployer, d.encryptedERC, encryptedErcAbi, 'setAuditorPublicKey', [auditor.account!.address]);
  record('set_auditor', h, deployer.account!.address, 'eERC owner sets the auditor key', { auditor: auditor.account!.address });
}
let shop = (await readShops(pub as never, d)).find((s) => s.slug === 'harbor-loom');
if (!shop) {
  record('open_shop', await send(merchant, d.norenMerchants, norenMerchantsAbi, 'openShop', ['Harbor & Loom', 'harbor-loom']), merchant.account!.address, 'Harbor & Loom opens on Noren Merchant');
  shop = (await readShops(pub as never, d)).find((s) => s.slug === 'harbor-loom')!;
}
const items: [string, bigint][] = [['Linen tote', 2400n], ['Waxed canvas apron', 3600n], ['Stoneware mug', 1800n], ['Wool throw', 6400n]];
for (const [i, [name, cents]] of items.entries()) {
  if (shop.items.some((it) => it.name === name)) continue;
  record(`list_item_${i}`, await send(merchant, d.norenMerchants, norenMerchantsAbi, 'listItem', [BigInt(shop.id), name, cents]), merchant.account!.address, `lists ${name} at ${Number(cents) / 100} tUSDC`);
}
console.log('setup done');
process.exit(0);
