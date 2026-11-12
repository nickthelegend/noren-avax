import { useEffect, useState } from 'react';
import { addressUrl, readPool, readPrices } from '@noren-avax/sdk';
import { go, linkProps, usePath } from './lib/router';
import { QA, connectWallet, disconnect, hasTestWallet, openTestWallet, qaRoles, restoreQa, restoreTestWallet, selectQa, useWho } from './lib/signer';
import { D, pub, readable } from './lib/chain';
import { useLoad } from './lib/hooks';
import { Logo, Icon } from './ui/nk/brand';
import { Landing } from './pages/Landing';
import { CreditTab } from './app/CreditTab';
import { PayTab } from './app/PayTab';
import { DebtFreeTab } from './app/DebtFreeTab';
import { MerchantTab } from './app/MerchantTab';
import { AccountantTab } from './app/AccountantTab';
import { AuditorTab } from './app/AuditorTab';
import { CustomerSide } from './app/Side';
import { Empty } from './app/common';
import type { Market } from './app/market';

type Tab = 'credit' | 'pay' | 'debt' | 'merchant' | 'accountant' | 'auditor';
const PEOPLE: { k: Tab; l: string; path: string }[] = [
  { k: 'credit', l: 'Credit', path: '/credit' },
  { k: 'pay', l: 'Pay anyone', path: '/shop/harbor-loom' },
  { k: 'debt', l: 'Debt-free', path: '/debt-free' },
];
const SHOPS: { k: Tab; l: string; path: string }[] = [
  { k: 'merchant', l: 'Merchant', path: '/merchant' },
  { k: 'accountant', l: 'Accountant', path: '/accountant' },
  { k: 'auditor', l: 'Auditor', path: '/auditor' },
];

function tabOf(path: string): Tab | null {
  if (path === '/credit') return 'credit';
  if (path === '/pay' || path.startsWith('/shop/')) return 'pay';
  if (path === '/debt-free') return 'debt';
  if (path === '/merchant') return 'merchant';
  if (path === '/accountant') return 'accountant';
  if (path === '/auditor') return 'auditor';
  return null;
}

export function App() {
  const path = usePath();
  useEffect(() => {
    restoreQa();
    restoreTestWallet();
  }, []);
  useEffect(() => {
    document.title = path === '/' ? 'Noren · Private checkout on Avalanche' : `Noren · ${[...PEOPLE, ...SHOPS].find((t) => t.k === tabOf(path))?.l ?? 'Not found'} on Avalanche`;
  }, [path]);
  if (path === '/') return <Landing />;
  return <Shell path={path} />;
}

function Shell({ path }: { path: string }) {
  const tab = tabOf(path);
  const who = useWho();
  const [wallet, setWallet] = useState(false);
  const prices = useLoad(() => readPrices(pub as never, D), [], 60_000);
  const pool = useLoad(() => readPool(pub as never, D), [], 60_000);
  const market: Market = { prices, pool, connect: () => setWallet(true) };
  const slug = path.startsWith('/shop/') ? decodeURIComponent(path.slice(6)) : 'harbor-loom';
  const tabs = (set: typeof PEOPLE, label: string) => (
    <div className="nk-tabs" role="tablist" aria-label={label}>
      {set.map((t) => (
        <button key={t.k} role="tab" aria-selected={tab === t.k} onClick={() => go(t.path)}>
          {tab === t.k && <span className="nk-tab-pill" aria-hidden />}
          <span className="nk-tab-l">{t.l}</span>
        </button>
      ))}
    </div>
  );
  return (
    <div className="nk nc na">
      <header className="nk-nav">
        <a className="nk-brand" {...linkProps('/')}>
          <Logo size={30} />
          <span>Noren</span>
          <small>Avalanche</small>
        </a>
        <div className="na-tabsets">
          {tabs(PEOPLE, 'Pay and borrow')}
          {tabs(SHOPS, 'Shops and books')}
        </div>
        <div className="nk-right">
          <span className="nk-net hide-s na-net">
            <i className={prices.error ? '' : 'on'} />
            Avalanche Fuji
          </span>
          <button className="nk-chip" onClick={() => setWallet(true)} aria-label={who ? `Wallet ${who.label}. Change wallet` : 'Connect a wallet'}>
            <span className={`nk-ava ${who ? '' : 'na-ava-off'}`} aria-hidden />
            {who ? who.label : 'Connect wallet'}
          </button>
        </div>
      </header>

      <main className="nk-main">
        <div className="nk-home">
          {tab === 'credit' && <CreditTab market={market} />}
          {tab === 'pay' && <PayTab slug={slug} market={market} />}
          {tab === 'debt' && <DebtFreeTab market={market} />}
          {tab === 'merchant' && <MerchantTab market={market} />}
          {tab === 'accountant' && <AccountantTab market={market} />}
          {tab === 'auditor' && <AuditorTab market={market} />}
          {tab === null && (
            <>
              <div className="nk-home-main">
                <section className="nk-card">
                  <div className="nk-card-h">
                    <div>
                      <b>Nothing here</b>
                      <p>This page doesn’t exist.</p>
                    </div>
                  </div>
                  <Empty art="warning" title="No Noren page at this link" action={<>
                    <a className="nk-btn" {...linkProps('/shop/harbor-loom')}>Pay a shop</a>
                    <a className="nk-btn" {...linkProps('/')}>Back to Noren</a>
                  </>}>
                    Try paying Harbor &amp; Loom, or go back to the start.
                  </Empty>
                </section>
              </div>
              <CustomerSide market={market} />
            </>
          )}
        </div>
      </main>
      <p className="nk-foot">
        Avalanche Fuji only. tUSDC and tWBTC are test tokens with no value. Private amounts use Ava Labs eERC; prices come from Chainlink. <a {...linkProps('/')}>About Noren on Avalanche</a>
      </p>
      {wallet && <WalletSheet close={() => setWallet(false)} />}
    </div>
  );
}

function WalletSheet({ close }: { close: () => void }) {
  const who = useWho();
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const known = hasTestWallet();
  return (
    <div className="nk-modal" role="dialog" aria-modal="true" aria-label="Your wallet" onClick={(e) => e.target === e.currentTarget && close()} onKeyDown={(e) => e.key === 'Escape' && close()}>
      <div className="nk-sheet">
        <div className="nk-sheet-h">
          <b>{who ? 'Your wallet' : 'Connect a wallet'}</b>
          <button className="nk-x" onClick={close} aria-label="Close">
            ×
          </button>
        </div>
        <div style={{ overflowY: 'auto' }}>
          {who && (
            <div className="nc-sheet-3d">
              <span className="nk-ava" aria-hidden />
              <p style={{ overflowWrap: 'anywhere' }}>
                <b className="na-who">{who.label}</b>
                <span className="mono">{who.address}</span>
              </p>
            </div>
          )}
          {QA ? (
            <div className="nk-box">
              <label htmlFor="qa-signer">QA signer · Fuji test keys from the harness</label>
              <select id="qa-signer" className="nk-search" style={{ marginTop: 10 }} value={who?.label ?? ''} onChange={(e) => selectQa(e.target.value)}>
                {qaRoles().map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <ul className="nk-list">
              <li>
                <button
                  type="button"
                  aria-selected={who?.kind === 'guest'}
                  onClick={() => {
                    openTestWallet();
                    close();
                  }}
                >
                  <span className="nk-ava" aria-hidden />
                  <span>
                    <b>{known ? 'Your test wallet' : 'Test wallet'}</b>
                    <small>{known ? 'Kept in this browser' : 'Made in this browser, funded in one tap'}</small>
                  </span>
                </button>
              </li>
              <li>
                <button
                  type="button"
                  aria-selected={who?.kind === 'wallet'}
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    setErr(null);
                    try {
                      await connectWallet();
                      close();
                    } catch (e) {
                      setErr(readable(e));
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  <span className="nk-ava na-ava-core" aria-hidden />
                  <span>
                    <b>{busy ? 'Opening your wallet…' : 'Browser wallet'}</b>
                    <small>Core or MetaMask, switched to Fuji</small>
                  </span>
                </button>
              </li>
            </ul>
          )}
          {err && <p className="nk-err" role="alert">{err}</p>}
          {who && (
            <div className="na-btns">
              <a className="nk-btn" href={addressUrl(who.address)} target="_blank" rel="noreferrer">
                Open on Snowtrace <Icon.ext />
              </a>
              {!QA && (
                <button
                  className="nk-btn"
                  onClick={() => {
                    disconnect();
                    close();
                  }}
                >
                  Sign out
                </button>
              )}
            </div>
          )}
          <p className="nc-fine">
            {who?.kind === 'guest'
              ? 'The test wallet’s key stays in this browser. It holds Fuji test funds only; signing out keeps it here for next time.'
              : 'No wallet? The test wallet works with nothing installed: NorenGasStation funds it with gas and test tokens in one tap.'}
          </p>
        </div>
      </div>
    </div>
  );
}
