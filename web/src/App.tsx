import { useEffect, useState } from 'react';
import { usePath, linkProps } from './lib/router';
import { QA, connectWallet, disconnect, hasTestWallet, openTestWallet, qaRoles, restoreQa, restoreTestWallet, selectQa, useWho } from './lib/signer';
import { readable } from './lib/chain';
import { Mark } from './ui/kit';
import { Landing } from './pages/Landing';
import { Checkout } from './pages/Checkout';
import { Merchant } from './pages/Merchant';
import { Auditor } from './pages/Auditor';
import { Credit } from './pages/Credit';

const NAV = [
  { path: '/shop/harbor-loom', label: 'Checkout', match: '/shop' },
  { path: '/credit', label: 'Credit', match: '/credit' },
  { path: '/merchant', label: 'Merchant', match: '/merchant' },
  { path: '/auditor', label: 'Auditor', match: '/auditor' },
];

function WalletButton() {
  const who = useWho();
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !(e.target as HTMLElement).closest('.wallet-pick') && setOpen(false);
    addEventListener('click', close);
    return () => removeEventListener('click', close);
  }, [open]);
  if (QA) {
    const roles = qaRoles();
    return (
      <label className="qa-pick" title="QA build: Fuji test keys injected by the Playwright harness">
        <span>QA signer</span>
        <select value={who?.label ?? ''} onChange={(e) => selectQa(e.target.value)} aria-label="QA signer">
          {roles.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </label>
    );
  }
  if (who)
    return (
      <button className="btn btn-ghost-light wallet" onClick={disconnect} title={who.kind === 'guest' ? 'Test wallet kept in this browser. Click to sign out; it stays here for next time.' : 'Disconnect'}>
        <span className="dot" /> {who.label}
      </button>
    );
  return (
    <div className="wallet-pick">
      <button className="btn btn-light" aria-expanded={open} aria-haspopup="menu" onClick={() => setOpen((v) => !v)}>
        Connect wallet
      </button>
      {open && (
        <div className="wallet-menu" role="menu" onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}>
          <button
            role="menuitem"
            onClick={() => {
              setOpen(false);
              openTestWallet();
            }}
          >
            <b>{hasTestWallet() ? 'Your test wallet' : 'Test wallet'}</b>
            <small>{hasTestWallet() ? 'Kept in this browser' : 'Made in this browser, funded in one tap'}</small>
          </button>
          <button
            role="menuitem"
            onClick={() => {
              setOpen(false);
              connectWallet().catch((e) => setErr(readable(e)));
            }}
          >
            <b>Browser wallet</b>
            <small>Core or MetaMask on Fuji</small>
          </button>
        </div>
      )}
      {err && (
        <div className="toast" role="alert" onClick={() => setErr(null)}>
          {err}
        </div>
      )}
    </div>
  );
}

export function App() {
  const path = usePath();
  useEffect(() => {
    restoreQa();
    restoreTestWallet();
  }, []);
  const dark = path === '/';
  let page;
  if (path.startsWith('/shop/')) page = <Checkout slug={decodeURIComponent(path.slice(6))} />;
  else if (path === '/merchant') page = <Merchant />;
  else if (path === '/auditor') page = <Auditor />;
  else if (path === '/credit') page = <Credit />;
  else if (path === '/') page = <Landing />;
  else
    page = (
      <main className="wrap page-404">
        <h1>Nothing here</h1>
        <p>
          <a {...linkProps('/')}>Back to Noren</a>
        </p>
      </main>
    );
  return (
    <div className={dark ? 'shell shell-dark' : 'shell'}>
      <header className="top">
        <div className="top-in">
          <a className="brand" {...linkProps('/')} aria-label="Noren home">
            <Mark />
            <span>Noren</span>
          </a>
          <nav className="nav" aria-label="Main">
            {NAV.map((n) => (
              <a key={n.path} {...linkProps(n.path)} aria-current={path.startsWith(n.match) ? 'page' : undefined}>
                {n.label}
              </a>
            ))}
          </nav>
          <div className="top-r">
            <span className="net" title="Avalanche Fuji C-Chain (testnet)">
              <i /> Fuji
            </span>
            <WalletButton />
          </div>
        </div>
      </header>
      {page}
      <footer className="foot">
        <div className="wrap foot-in">
          <span>
            <Mark size={20} /> Noren on Avalanche Fuji. Test tokens only: tUSDC and tWBTC have no value.
          </span>
          <span className="foot-links">
            <a href="https://github.com/ava-labs/EncryptedERC" target="_blank" rel="noreferrer">
              Ava Labs eERC
            </a>
            <a href="https://docs.chain.link/data-feeds/price-feeds/addresses?network=avalanche&page=1" target="_blank" rel="noreferrer">
              Chainlink feeds
            </a>
          </span>
        </div>
      </footer>
    </div>
  );
}
