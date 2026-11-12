// Signed-out and edge states from a build with no QA signer (production dist by default, or a hosted URL):
// every route signed out, the wallet sheet and a credit sheet open, an unknown shop, a 404, and a fresh test wallet with no balance.
// Overflow and console errors are reported per shot. No keys are read here.
import { mkdirSync, writeFileSync } from 'node:fs';
import { serve, withBrowser, BASE as LOCAL } from './harness.mjs';

const OUT = process.env.NOREN_SHOTS ?? '/Volumes/Extreme SSD/Projects/grokbot/orchestration/shots/avax-noren/states';
const HOSTED = process.env.NOREN_URL;
const BASE = HOSTED ?? LOCAL;
mkdirSync(OUT, { recursive: true });

const testWallet = async (p) => {
  await p.locator('header .nk-chip').click();
  await p.getByRole('button', { name: /test wallet/i }).click();
};
const shots = [
  { name: 'out-landing', path: '/' },
  { name: 'out-credit', path: '/credit' },
  { name: 'out-pay', path: '/shop/harbor-loom' },
  { name: 'out-debt-free', path: '/debt-free' },
  { name: 'out-merchant', path: '/merchant' },
  { name: 'out-accountant', path: '/accountant' },
  { name: 'out-auditor', path: '/auditor' },
  { name: 'unknown-shop', path: '/shop/no-such-shop' },
  { name: 'not-found', path: '/nope' },
  { name: 'wallet-sheet', path: '/shop/harbor-loom', act: async (p) => p.locator('header .nk-chip').click() },
  { name: 'deposit-sheet', path: '/credit', act: async (p) => p.getByRole('button', { name: /^Add collateral/ }).first().click() },
  { name: 'fresh-wallet-pay', path: '/shop/harbor-loom', act: testWallet },
  { name: 'fresh-wallet-merchant', path: '/merchant', act: testWallet },
  { name: 'fresh-wallet-credit', path: '/credit', act: testWallet },
];
const only = process.argv[2];
const server = HOSTED ? null : await serve('dist');
const report = [];
try {
  await withBrowser(async (browser) => {
    for (const s of shots) {
      if (only && !s.name.startsWith(only)) continue;
      for (const width of [1440, 375]) {
        const ctx = await browser.newContext({ viewport: { width, height: width === 375 ? 812 : 900 }, isMobile: width === 375, hasTouch: width === 375 });
        const page = await ctx.newPage();
        const errors = [];
        page.on('pageerror', (x) => errors.push(String(x)));
        page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
        await page.goto(BASE + s.path, { waitUntil: 'networkidle' });
        if (s.act) { try { await s.act(page); } catch (e) { errors.push('act: ' + String(e).slice(0, 120)); } }
        await page.waitForTimeout(5000);
        // Full-page capture: show scroll-revealed sections and load lazy art as a reader scrolling would.
        await page.evaluate(async () => {
          document.querySelectorAll('[data-reveal]').forEach((e) => e.classList.add('in'));
          for (const img of document.querySelectorAll('img[loading="lazy"]')) img.loading = 'eager';
          await new Promise((r) => setTimeout(r, 1200));
        });
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
        await page.screenshot({ path: `${OUT}/${s.name}-${width}.png`, fullPage: true });
        report.push({ shot: s.name, width, overflow, errors });
        console.log(`${s.name}@${width} overflow=${overflow} errors=${errors.length}${errors.length ? ' ' + errors.slice(0, 3).join(' | ') : ''}`);
        await ctx.close();
      }
    }
  });
} finally {
  server?.kill();
}
writeFileSync(`${OUT}/states-report.json`, JSON.stringify(report, null, 2));
