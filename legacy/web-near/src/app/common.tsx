import type { ReactNode } from 'react';
import { addressUrl, txUrl } from '@noren-avax/sdk';
import { nameOf } from '../lib/chain';
import { Icon } from '../ui/nk/brand';
import { Art3d, type Art3dKey } from '../ui/nk/Art3d';

/** $1,234.56 (or $1,235 with digits = 0). Dollars come from tUSDC (6 dp), cents (2 dp) or Chainlink (8 dp). */
export const usd = (n: number | null | undefined, digits = 2) =>
  n == null || Number.isNaN(n) ? '—' : `${n < 0 ? '−' : ''}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
export const u6 = (v?: bigint | null) => (v == null ? null : Number(v) / 1e6);
export const u8 = (v?: bigint | null) => (v == null ? null : Number(v) / 1e8);
export const cents = (v?: bigint | null) => (v == null ? null : Number(v) / 100);
export const short = (a?: string | null) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '');
export const shortHash = (h: string) => `${h.slice(0, 6)}…${h.slice(-4)}`;
export const cap = (s: string) => (/^t[A-Z]/.test(s) ? s : s.replace(/^./, (c) => c.toUpperCase()));

/** "Open 0x12ab…cdef ↗" on Snowtrace, in the NEAR app's button style. */
export function TxBtn({ hash, label }: { hash: string; label?: string }) {
  return (
    <a className="nk-btn" href={txUrl(hash)} target="_blank" rel="noreferrer" title={hash}>
      {label ?? `Open ${shortHash(hash)}`} <Icon.ext />
    </a>
  );
}

/** A short tx link for the right edge of a list row. */
export function TxRef({ hash }: { hash: string }) {
  return (
    <a className="r mono" href={txUrl(hash)} target="_blank" rel="noreferrer" title={`${hash} on Snowtrace`}>
      {shortHash(hash)} <Icon.ext />
    </a>
  );
}

export function AddrLink({ a, className = 'mono' }: { a: string; className?: string }) {
  return (
    <a className={className} href={addressUrl(a)} target="_blank" rel="noreferrer" title={a}>
      {nameOf(a)}
    </a>
  );
}

export function Card({ title, sub, art, pill, children, className = '', id }: { title: ReactNode; sub?: ReactNode; art?: Art3dKey; pill?: ReactNode; children?: ReactNode; className?: string; id?: string }) {
  return (
    <section className={`nk-card ${className}`} id={id}>
      <div className="nk-card-h">
        {art ? (
          <div className="nc-h3d">
            <Art3d k={art} size={56} />
            <div>
              <b>{title}</b>
              {sub && <p>{sub}</p>}
            </div>
          </div>
        ) : (
          <div>
            <b>{title}</b>
            {sub && <p>{sub}</p>}
          </div>
        )}
        {pill}
      </div>
      {children}
    </section>
  );
}

export function Pill({ tone, children }: { tone?: 'live' | 'warn' | 'bad'; children: ReactNode }) {
  return <span className={`nk-pill ${tone ?? ''}`}>{children}</span>;
}

export function Empty({ art = 'empty', title, children, action }: { art?: Art3dKey; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="nk-pad">
      <div className="nk-empty">
        <Art3d k={art} size={72} />
        <b>{title}</b>
        {children && <p>{children}</p>}
        {action && <div className="na-empty-act">{action}</div>}
      </div>
    </div>
  );
}

export function Err({ children }: { children: ReactNode }) {
  return (
    <p className="nk-err" role="alert">
      {children}
    </p>
  );
}

/** One row of the NEAR Activity list: a status tile, a title and line, a right-hand cell. */
export function Row({ state = 'success', title, sub, right, kind }: { state?: 'success' | 'rejected' | 'run' | 'todo' | 'skip'; title: ReactNode; sub?: ReactNode; right?: ReactNode; kind?: string }) {
  return (
    <li data-kind={kind}>
      <span className={`nk-act-ic nl-dot ${state}`} aria-hidden>
        {state === 'success' || state === 'skip' ? <Icon.check /> : state === 'rejected' ? <Icon.x /> : state === 'run' ? <i className="na-spin" /> : <i className="na-todo" />}
      </span>
      <span>
        <b>{title}</b>
        {sub && <small>{sub}</small>}
      </span>
      {right ?? <span />}
    </li>
  );
}
