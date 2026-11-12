/**
 * Shared Playwright harness: one headless Chrome at a time (withChromeLock, shared with other sessions), the
 * production-isolated QA build (web/dist-qa) served by `vite preview`, and the QA signer. The role keys are read
 * from the repo's gitignored .env inside this process and injected into the page as window.__NOREN_QA__; they are
 * never printed, logged or written anywhere. Only QA builds (VITE_QA=1) read that object.
 */
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { withChromeLock } from '/Volumes/Extreme SSD/Projects/grokbot/orchestration/chrome-lock.mjs';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
export const PORT = Number(process.env.NOREN_PORT ?? 5361);
export const BASE = `http://127.0.0.1:${PORT}`;
export const SHOTS = '/Volumes/Extreme SSD/Projects/grokbot/orchestration/shots/avax-noren';

function env() {
  const out = {};
  for (const line of readFileSync(join(ROOT, '.env'), 'utf8').split('\n')) {
    const m = /^([A-Z_]+)=(.*)$/.exec(line.trim());
    if (m) out[m[1]] = m[2];
  }
  return out;
}

export async function serve(dir = 'dist-qa') {
  const p = spawn('npx', ['vite', 'preview', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort', '--outDir', dir], { cwd: join(ROOT, 'web'), stdio: 'ignore' });
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(BASE)).ok) return p;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  p.kill();
  throw new Error('preview server did not start');
}

export async function withBrowser(fn) {
  return withChromeLock(async () => {
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    try {
      return await fn(browser);
    } finally {
      await browser.close();
    }
  });
}

export async function qaPage(browser, { width = 1440, height = 900, as = 'customer', mobile = false } = {}) {
  const e = env();
  const keys = { customer: e.NOREN_CUSTOMER_KEY, merchant: e.NOREN_MERCHANT_KEY, auditor: e.NOREN_AUDITOR_KEY, accountant: e.NOREN_ACCOUNTANT_KEY };
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile });
  await ctx.addInitScript(([k, who]) => {
    window.__NOREN_QA__ = { keys: k };
    try { sessionStorage.setItem('noren:qa', who); } catch {}
  }, [keys, as]);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (x) => errors.push(String(x)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  const txs = [];
  await page.exposeFunction('__norenRecordTx', (d) => txs.push(d));
  await ctx.addInitScript(() => addEventListener('noren:tx', (ev) => window.__norenRecordTx?.(ev.detail)));
  return { page, ctx, errors, txs };
}
