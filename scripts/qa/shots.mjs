// Screenshots of every route at 1440 and 375 from the QA build, with overflow and console-error checks.
// Unlocking a private view is a local signature (no transaction).
import { mkdirSync, writeFileSync } from 'node:fs';
import { BASE, SHOTS as ROOT_SHOTS, qaPage, serve, withBrowser } from './harness.mjs';

const SHOTS = process.env.NOREN_SHOTS ?? ROOT_SHOTS;

const routes = [
  { name: 'landing', path: '/', as: 'customer' },
  { name: 'checkout', path: '/shop/harbor-loom', as: 'customer' },
  { name: 'credit', path: '/credit', as: 'customer' },
  { name: 'merchant', path: '/merchant', as: 'merchant', unlock: 'Decrypt revenue' },
  { name: 'auditor', path: '/auditor', as: 'auditor', unlock: 'Decrypt the ledger' },
  { name: 'auditor-other', path: '/auditor', as: 'customer' },
  { name: 'accountant', path: '/auditor', as: 'accountant', unlock: 'Read my statements' },
];
const only = process.argv[2];
mkdirSync(SHOTS, { recursive: true });
const server = await serve();
const report = [];
try {
  await withBrowser(async (browser) => {
    for (const r of routes) {
      if (only && !r.name.startsWith(only)) continue;
      for (const width of [1440, 375]) {
        const { page, ctx, errors } = await qaPage(browser, { width, height: width === 375 ? 812 : 900, as: r.as, mobile: width === 375 });
        await page.goto(BASE + r.path, { waitUntil: 'networkidle' });
        if (r.unlock) {
          await page.getByRole('button', { name: r.unlock }).click();
          await page.waitForSelector('table, .note', { timeout: 120_000 });
        }
        await page.waitForTimeout(6000);
        await page.evaluate(async () => {
          for (const img of document.querySelectorAll('img[loading="lazy"]')) img.loading = 'eager';
          await new Promise((res) => setTimeout(res, 800));
        });
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
        const file = `${SHOTS}/${r.name}-${width}.png`;
        await page.screenshot({ path: file, fullPage: true });
        report.push({ route: r.name, width, overflow, errors });
        console.log(`${r.name}@${width} overflow=${overflow} errors=${errors.length}${errors.length ? ' ' + errors.slice(0, 3).join(' | ') : ''}`);
        await ctx.close();
      }
    }
  });
} finally {
  server.kill();
}
writeFileSync(`${SHOTS}/report.json`, JSON.stringify(report, null, 2));
