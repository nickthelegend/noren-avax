// Screenshots of the Aubelle storefront at 1440 and 375 (home, product, bag drawer, bag page), with console errors and
// horizontal overflow checked. CHECKOUT=1 also presses "Checkout with Noren" and prints the invoice it lands on.
// Usage: node shop/scripts/shots.mjs <base url> <out dir> [prefix]
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { withChromeLock } from '/Volumes/Extreme SSD/Projects/grokbot/orchestration/chrome-lock.mjs';
const require = createRequire(new URL('../../scripts/package.json', import.meta.url));
const { chromium } = require('playwright-core');

const [base = 'https://noren-avax-shop.vercel.app', out = '.', prefix = 'aubelle'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const problems = [];
await withChromeLock(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    for (const [w, h] of [[1440, 900], [375, 812]]) {
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
      const page = await ctx.newPage();
      page.on('console', (m) => { if (m.type() === 'error') problems.push(`${w}: console ${m.text().slice(0, 200)}`); });
      page.on('pageerror', (e) => problems.push(`${w}: pageerror ${e.message}`));
      const shot = async (name) => {
        await page.waitForTimeout(900);
        const over = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
        if (over > 0) problems.push(`${w} ${name}: overflow ${over}px`);
        await page.screenshot({ path: join(out, `${prefix}-${name}-${w}.png`) });
      };
      await page.goto(`${base}/#/`, { waitUntil: 'networkidle' });
      await shot('home');
      await page.goto(`${base}/#/p/amelie-gingham`, { waitUntil: 'networkidle' });
      await shot('product');
      await page.getByRole('button', { name: 'S', exact: true }).first().click();
      await page.getByRole('button', { name: /add to bag/i }).first().click();
      await shot('drawer');
      await page.goto(`${base}/#/bag`, { waitUntil: 'networkidle' });
      await shot('bag');
      if (process.env.CHECKOUT === '1' && w === 1440) {
        await page.getByRole('button', { name: /checkout with/i }).last().click();
        await page.waitForURL((u) => !u.href.startsWith(base), { timeout: 30_000 }).catch(() => {});
        console.log('checkout landed on', page.url());
        await page.waitForTimeout(2500);
        await page.screenshot({ path: join(out, `${prefix}-checkout-${w}.png`) });
      }
      await ctx.close();
    }
  } finally { await browser.close(); }
});
console.log(problems.length ? problems.join('\n') : 'no console errors, no overflow');
