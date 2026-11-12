// The live Fuji demo, driven through the web app (QA build) with the QA signer. Every transaction the app sends is
// captured from its `noren:tx` events and written to deployments/fuji.json under "demo", with a screenshot per step.
//  1. the customer pays Harbor & Loom privately (tUSDC)
//  2. the customer borrows against tWBTC and pays on credit
//  3. the merchant decrypts revenue Snowtrace can't read, and withdraws part of it
//  4. the auditor decrypts the ledger
//  5. the customer repays the credit line
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { BASE, ROOT, SHOTS, qaPage, serve, withBrowser } from './harness.mjs';

const FILE = join(ROOT, 'deployments/fuji.json');
const steps = [];
const only = process.argv[2] ? process.argv[2].split(',').map(Number) : [1, 2, 3, 4, 5];
mkdirSync(SHOTS, { recursive: true });

async function record(n, title, as, txs, errors, shot) {
  steps.push({ step: n, title, as, txs, shot, consoleErrors: errors });
  const d = JSON.parse(readFileSync(FILE, 'utf8'));
  d.demo = d.demo ?? {};
  d.demo[`${n}`] = { title, as, at: new Date().toISOString(), txs, shot: shot.replace(/^.*\/shots\//, 'shots/') };
  writeFileSync(FILE, JSON.stringify(d, null, 2) + '\n');
  console.log(`step ${n} ${title}: ${txs.length} txs${errors.length ? `, console errors: ${errors.join(' | ')}` : ''}`);
  for (const t of txs) console.log(`   ${t.hash}  ${t.what}`);
}

async function pay(browser, n, item, method) {
  const { page, ctx, errors, txs } = await qaPage(browser, { as: 'customer' });
  await page.goto(`${BASE}/shop/harbor-loom`, { waitUntil: 'networkidle' });
  await page.getByRole('radio', { name: new RegExp(item) }).click();
  if (method === 'credit') await page.getByRole('radio', { name: /Pay with credit/ }).click();
  await page.waitForTimeout(3000);
  await page.getByRole('button', { name: /^Pay/ }).click();
  await page.waitForSelector('.receipt, .step-fail', { timeout: 300_000 });
  const failed = await page.$('.step-fail');
  const shot = `${SHOTS}/demo-${n}-${method}.png`;
  await page.screenshot({ path: shot, fullPage: true });
  if (failed) throw new Error(`step ${n} failed: ${await failed.innerText()}`);
  await record(n, method === 'credit' ? `Customer borrows against tWBTC and pays ${item} on credit` : `Customer pays ${item} privately`, 'customer', txs, errors, shot);
  await ctx.close();
}

const server = await serve();
try {
  await withBrowser(async (browser) => {
    if (only.includes(1)) await pay(browser, 1, 'Linen tote', 'private');
    if (only.includes(2)) await pay(browser, 2, 'Waxed canvas apron', 'credit');
    if (only.includes(3)) {
      const { page, ctx, errors, txs } = await qaPage(browser, { as: 'merchant' });
      await page.goto(`${BASE}/merchant`, { waitUntil: 'networkidle' });
      await page.getByRole('button', { name: 'Decrypt revenue' }).click();
      await page.waitForSelector('table', { timeout: 120_000 });
      await page.waitForTimeout(2000);
      await page.screenshot({ path: `${SHOTS}/demo-3-merchant-revenue.png`, fullPage: true });
      await page.getByLabel('Amount (tUSDC)').fill('24.00');
      await page.getByRole('button', { name: /Withdraw 24.00/ }).click();
      await page.waitForSelector('.ok-line, .err', { timeout: 300_000 });
      const err = await page.$('.err');
      if (err) throw new Error(`merchant withdraw failed: ${await err.innerText()}`);
      await page.waitForTimeout(4000);
      const shot = `${SHOTS}/demo-3-merchant-withdraw.png`;
      await page.screenshot({ path: shot, fullPage: true });
      await record(3, 'Merchant decrypts private revenue and withdraws 24.00 tUSDC', 'merchant', txs, errors, shot);
      await ctx.close();
    }
    if (only.includes(4)) {
      const { page, ctx, errors, txs } = await qaPage(browser, { as: 'auditor' });
      await page.goto(`${BASE}/auditor`, { waitUntil: 'networkidle' });
      await page.getByRole('button', { name: 'Decrypt the ledger' }).click();
      await page.waitForSelector('table', { timeout: 120_000 });
      await page.waitForTimeout(2000);
      const shot = `${SHOTS}/demo-4-auditor.png`;
      await page.screenshot({ path: shot, fullPage: true });
      await record(4, 'Auditor decrypts every payment and withdrawal', 'auditor', txs, errors, shot);
      await ctx.close();
    }
    if (only.includes(5)) {
      const { page, ctx, errors, txs } = await qaPage(browser, { as: 'customer' });
      await page.goto(`${BASE}/credit`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(4000);
      await page.getByRole('tab', { name: 'Repay' }).click();
      await page.getByRole('button', { name: /^Repay$/ }).click();
      await page.waitForSelector('.ok-line, .err', { timeout: 300_000 });
      const err = await page.$('.err');
      if (err) throw new Error(`repay failed: ${await err.innerText()}`);
      await page.waitForTimeout(5000);
      const shot = `${SHOTS}/demo-5-repay.png`;
      await page.screenshot({ path: shot, fullPage: true });
      await record(5, 'Customer repays the credit line in full', 'customer', txs, errors, shot);
      await ctx.close();
    }
  });
} finally {
  server.kill();
}
console.log(JSON.stringify(steps.map((s) => ({ step: s.step, txs: s.txs.length })), null, 0));
