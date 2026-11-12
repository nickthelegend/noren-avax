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
const f = new URL('README.md', root);
let r = readFileSync(f, 'utf8');
r = r.replace(/<!-- demo -->[\s\S]*?<!-- \/demo -->/, `<!-- demo -->\n${out}<!-- /demo -->`);
r = r.replace(/<!-- setup -->[\s\S]*?<!-- \/setup -->/, `<!-- setup -->\n${setup}<!-- /setup -->`);
writeFileSync(f, r);
console.log('README tables updated');
