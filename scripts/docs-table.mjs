// Rewrites the <!-- demo --> block in README.md from deployments/fuji.json (live Fuji transactions).
import { readFileSync, writeFileSync } from 'node:fs';
const root = new URL('../', import.meta.url);
const d = JSON.parse(readFileSync(new URL('deployments/fuji.json', root)));
const tx = (h) => `[\`${h.slice(0, 10)}…\`](https://testnet.snowtrace.io/tx/${h})`;
let out = '| Step | Signer | Transactions (Snowtrace) |\n|---|---|---|\n';
for (const [n, s] of Object.entries(d.demo ?? {})) {
  out += `| ${n}. ${s.title} | ${s.as} | ${s.txs.length ? s.txs.map((t) => `${t.what}: ${tx(t.hash)}`).join('<br>') : 'no transaction (local decryption)'} |\n`;
}
let setup = '| Setup | Transaction |\n|---|---|\n';
for (const [k, v] of Object.entries(d.txs ?? {})) setup += `| ${v.what} | ${tx(v.hash)} |\n`;
let judge = '';
if (d.judge) {
  judge = `Run ${d.judge.at.slice(0, 16).replace('T', ' ')} UTC on ${d.judge.site} by \`scripts/qa/judge.mjs\` (a fresh browser, ${d.judge.wallet}, no keys from this machine):\n\n| Step | Transaction (Snowtrace) |\n|---|---|\n`;
  for (const t of d.judge.txs) judge += `| ${t.what} | ${tx(t.hash)} |\n`;
  judge += `\nAssistant's answer to "How much did I make this week?": "${d.judge.assistant}"\n`;
}
let batches = '';
if (d.hubBatches?.length) {
  batches = '| Batch | When (UTC) | Customer payments in | Shop payouts (real or cover; amounts encrypted) | Record |\n|---|---|---|---|---|\n';
  for (const b of d.hubBatches)
    batches += `| #${b.batch} | ${b.at.slice(0, 16).replace('T', ' ')} | ${b.payments.map(tx).join(' ')} | ${b.payouts.map((p) => `shop ${p.shop}: ${tx(p.tx)}`).join('<br>')} | ${tx(b.record)} |\n`;
}
const f = new URL('README.md', root);
let r = readFileSync(f, 'utf8');
r = r.replace(/<!-- demo -->[\s\S]*?<!-- \/demo -->/, `<!-- demo -->\n${out}<!-- /demo -->`);
r = r.replace(/<!-- setup -->[\s\S]*?<!-- \/setup -->/, `<!-- setup -->\n${setup}<!-- /setup -->`);
r = r.replace(/<!-- judge -->[\s\S]*?<!-- \/judge -->/, `<!-- judge -->\n${judge}<!-- /judge -->`);
r = r.replace(/<!-- batches -->[\s\S]*?<!-- \/batches -->/, `<!-- batches -->\n${batches}<!-- /batches -->`);
writeFileSync(f, r);
console.log('README tables updated');
