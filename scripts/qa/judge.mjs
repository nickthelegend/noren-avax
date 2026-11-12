// The zero-setup judge path, run against the hosted production site (no QA signer, no keys from this machine):
// a fresh browser gets a test wallet, one tap of NorenGasStation funds it, it pays Harbor & Loom through the
// settlement hub, opens its own shop, names itself accountant, pays its own shop, waits for the hub's batch, then
// reads its revenue, asks the assistant and opens its statements. Every transaction the page announced is written to
// deployments/fuji.json under "judge"; screenshots go to the shots folder.
//
//   node scripts/qa/judge.mjs [base-url]      (default https://noren-avax.vercel.app)
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, SHOTS, withBrowser } from './harness.mjs';

const BASE = process.argv[2] ?? 'https://noren-avax.vercel.app';
const OUT = join(SHOTS, '9round');
mkdirSync(OUT, { recursive: true });
const log = (m) => console.log(`${new Date().toISOString().slice(11, 19)} ${m}`);

await withBrowser(async (browser) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  const txs = [];
  page.on('pageerror', (x) => errors.push(String(x)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.exposeFunction('__norenRecordTx', (d) => {
    txs.push({ ...d, page: new URL(page.url()).pathname });
    log(`tx ${d.hash} ${d.what}`);
  });
  await ctx.addInitScript(() => addEventListener('noren:tx', (ev) => window.__norenRecordTx?.(ev.detail)));
  const shot = (name) => page.screenshot({ path: join(OUT, `${name}.png`), fullPage: true });

  // 1. Empty test wallet -> one tap pays Harbor & Loom (the plan starts with the starter pack).
  await page.goto(`${BASE}/shop/harbor-loom`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Connect wallet' }).click();
  await page.getByRole('menuitem', { name: /Test wallet/ }).click();
  const who = (await page.locator('.wallet').innerText()).trim();
  log(`wallet: ${who}`);
  await page.getByRole('button', { name: /^Pay 24\.00/ }).click();
  await page.locator('.receipt').waitFor({ timeout: 240_000 });
  await page.getByText('Receipt signed by the hub').waitFor({ timeout: 60_000 });
  await shot('judge-1-paid-via-hub');
  log('paid Harbor & Loom via the hub');

  // 2. Open a shop with the sample values and name this wallet its accountant.
  await page.getByRole('link', { name: 'Merchant' }).click();
  await page.getByRole('button', { name: 'Open shop' }).click();
  await page.getByRole('heading', { name: /^Test shop/ }).waitFor({ timeout: 240_000 });
  await page.getByRole('button', { name: 'Use this wallet' }).click();
  await page.getByText('Statements go to').waitFor({ timeout: 120_000 });
  const slug = (await page.locator('.sub a').first().innerText()).replace('/shop/', '').trim();
  log(`opened ${slug}`);

  // 3. Pay the new shop and wait for the hub's batch.
  await page.locator(`a[href="/shop/${slug}"]`).first().click();
  await page.getByRole('button', { name: /^Pay 12\.00/ }).click();
  await page.locator('.receipt').waitFor({ timeout: 240_000 });
  await page.getByText(/Settled to/).waitFor({ timeout: 480_000 });
  await page.getByText('Shop payout').waitFor({ timeout: 60_000 });
  const payout = await page.getByRole('link', { name: 'Shop payout' }).getAttribute('href');
  txs.push({ hash: payout.split('/tx/')[1], what: 'hub payout to the test shop (batch)', page: `/shop/${slug}` });
  await shot('judge-2-settled');
  log(`settled: ${payout}`);

  // 4. Merchant view: decrypt, check the payout, ask the assistant.
  await page.getByRole('link', { name: 'Merchant' }).click();
  await page.locator('table').waitFor({ timeout: 120_000 });
  await page.getByText('✓').first().waitFor({ timeout: 60_000 });
  await page.getByRole('button', { name: 'How much did I make this week?' }).click();
  await page.locator('.chat-tool').first().waitFor({ timeout: 60_000 });
  await page.locator('.chat-bot:not(.faint)').first().waitFor({ timeout: 60_000 });
  const answer = await page.locator('.chat-bot:not(.faint)').last().innerText();
  log(`assistant: ${answer}`);
  await shot('judge-3-merchant');

  // 5. Accountant view.
  await page.getByRole('link', { name: 'Auditor' }).click();
  const read = page.getByRole('button', { name: 'Read my statements' });
  if (await read.isVisible().catch(() => false)) await read.click();
  await page.getByText('Statements for you').waitFor({ timeout: 120_000 });
  await page.locator('table').waitFor({ timeout: 120_000 });
  await shot('judge-4-accountant');

  const file = join(ROOT, 'deployments/fuji.json');
  const d = JSON.parse(readFileSync(file, 'utf8'));
  d.judge = { at: new Date().toISOString(), site: BASE, wallet: who, shop: slug, assistant: answer, txs, consoleErrors: errors };
  writeFileSync(file, JSON.stringify(d, null, 2) + '\n');
  log(`done: ${txs.length} txs, ${errors.length} console errors`);
  if (errors.length) console.log(errors.slice(0, 5).join('\n'));
  await ctx.close();
});
