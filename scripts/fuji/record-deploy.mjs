// Copies the contract-creation and setup-call hashes from forge's broadcast log into deployments/fuji.json.
import { readFileSync, writeFileSync } from 'node:fs';
const b = JSON.parse(readFileSync(new URL('../../contracts/broadcast/Deploy.s.sol/43113/run-latest.json', import.meta.url)));
const f = new URL('../../deployments/fuji.json', import.meta.url);
const d = JSON.parse(readFileSync(f));
d.deployTxs = b.transactions.map((t) => ({ hash: t.hash, type: t.transactionType, contract: t.contractName ?? null, address: t.contractAddress ?? null, fn: t.function ?? null }));
writeFileSync(f, JSON.stringify(d, null, 2) + '\n');
console.log(`${d.deployTxs.length} deploy transactions recorded`);
