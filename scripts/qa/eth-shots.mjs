// Screenshots of every route of the Avalanche edition (the ETHGlobal UI) at 1440 and 375, against the hosted site or
// a local preview (NOREN_URL / NOREN_MERCHANT_URL), with horizontal-overflow and console-error checks. A fresh test
// wallet per context; nothing is signed except the in-browser "Use a test wallet" key creation.
// Usage: node scripts/qa/eth-shots.mjs [routeprefix]
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { withChromeLock } from '/Volumes/Extreme SSD/Projects/grokbot/orchestration/chrome-lock.mjs';

const APP = process.env.NOREN_URL ?? 'https://noren-avax.vercel.app';
const MER = process.env.NOREN_MERCHANT_URL ?? 'https://noren-avax-merchant.vercel.app';
const PAID = process.env.NOREN_PAID ?? 'ini4mah0vpiz';
const OUT = process.env.NOREN_SHOTS ?? '/Volumes/Extreme SSD/Projects/grokbot/orchestration/shots/avax-noren/eth-ui';
const routes = [
  { name: 'landing', url: `${APP}/`, full: true },
  { name: 'app-signin', url: `${APP}/#/app` },
  { name: 'app-home', url: `${APP}/#/app`, wallet: true },
  { name: 'app-pay', url: `${APP}/#/app/pay`, wallet: true },
  { name: 'app-earn', url: `${APP}/#/app/earn`, wallet: true },
  { name: 'app-credit', url: `${APP}/#/app/credit`, wallet: true },
  { name: 'app-borrow', url: `${APP}/#/app/borrow`, wallet: true },
  { name: 'app-swap', url: `${APP}/#/app/swap`, wallet: true },
  { name: 'merchant-signin', url: `${MER}/` },
  { name: 'checkout-paid', url: `${MER}/#/pay/${PAID}` },
  { name: 'checkout-unknown', url: `${MER}/#/pay/innotreal00` },
  { name: 'settlement', url: `${APP}/#/auditor` },
];
const only = process.argv[2];
mkdirSync(OUT, { recursive: true });
const report = [];
await withChromeLock(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    for (const r of routes) {
      if (only && !r.name.startsWith(only)) continue;
      for (const width of [1440, 375]) {
        const ctx = await browser.newContext({ viewport: { width, height: width === 375 ? 812 : 900 }, deviceScaleFactor: 1, isMobile: width === 375, hasTouch: width === 375 });
        const page = await ctx.newPage();
        const errors = [];
        page.on('console', (m) => m.type() === 'error' && errors.push(m.text().slice(0, 200)));
        page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
        await page.goto(r.url, { waitUntil: 'networkidle', timeout: 90_000 });
        if (r.wallet) {
          await page.getByRole('button', { name: 'Use a test wallet' }).first().click();
          await page.waitForTimeout(500);
          if (!page.url().endsWith(new URL(r.url).hash)) await page.goto(r.url, { waitUntil: 'networkidle' });
        }
        await page.waitForTimeout(7000);
        await page.evaluate(async () => {
          document.querySelectorAll('[data-reveal]').forEach((e) => e.classList.add('in'));
          for (const img of document.querySelectorAll('img[loading="lazy"]')) img.loading = 'eager';
          await new Promise((res) => setTimeout(res, 1200));
        });
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
        const file = `${OUT}/${r.name}-${width}.jpg`;
        await page.screenshot({ path: file, fullPage: !!r.full || width === 375, type: 'jpeg', quality: 78 });
        report.push({ route: r.name, width, overflow, errors });
        console.log(`${r.name.padEnd(18)} ${width}  overflow ${overflow}px  errors ${errors.length}${errors.length ? ': ' + errors[0] : ''}`);
        await ctx.close();
      }
    }
  } finally {
    await browser.close();
  }
});
writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
