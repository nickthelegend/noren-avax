// Copies the hub's settlement batches from NorenSettlement on Fuji into deployments/fuji.json ("hubBatches").
import { writeFileSync } from 'node:fs';
import { readBatches, readPayouts, type HubDeployment } from '@noren-avax/sdk';
import { FILE, load, pub } from './lib.ts';

const d = load() as ReturnType<typeof load> & HubDeployment;
const [batches, payouts] = await Promise.all([readBatches(pub as never, d), readPayouts(pub as never, d)]);
const out = batches
  .sort((a, b) => a.batchId - b.batchId)
  .map((b) => ({
    batch: b.batchId,
    at: new Date(b.at * 1000).toISOString(),
    record: b.tx,
    payments: b.payments,
    payouts: payouts.filter((p) => p.batchId === b.batchId).map((p) => ({ shop: p.shopId, tx: p.payoutTx, accountant: p.accountant !== '0x0000000000000000000000000000000000000000' })),
    refunds: b.refunds,
  }));
writeFileSync(FILE, JSON.stringify({ ...load(), hubBatches: out }, null, 2) + '\n');
console.log(`${out.length} batches recorded`);
process.exit(0);
