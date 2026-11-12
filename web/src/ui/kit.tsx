import type { ReactNode } from 'react';
import { addressUrl, txUrl } from '@noren-avax/sdk';
import { nameOf } from '../lib/chain';

export function Art({ name, size = 96, alt = '', className = '' }: { name: string; size?: number; alt?: string; className?: string }) {
  return <img className={`art ${className}`} src={`/art/3d/noren-3d-${name}.webp`} width={size} height={size} alt={alt} loading="lazy" decoding="async" />;
}

/** Money in dollars with the cents set lighter. */
export function Money({ usd, className = '', sign = '$' }: { usd: number | null | undefined; className?: string; sign?: string }) {
  if (usd == null || Number.isNaN(usd)) return <span className={`money ${className}`}>—</span>;
  const [w, c] = Math.abs(usd).toFixed(2).split('.');
  return (
    <span className={`money ${className}`}>
      {usd < 0 ? '−' : ''}
      <span className="money-sign">{sign}</span>
      {Number(w).toLocaleString('en-US')}
      <span className="money-c">.{c}</span>
    </span>
  );
}

export function TxLink({ hash, label }: { hash: string; label?: string }) {
  return (
    <a className="tx" href={txUrl(hash)} target="_blank" rel="noreferrer" title={hash}>
      {label ?? `${hash.slice(0, 8)}…${hash.slice(-6)}`}
      <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true"><path d="M4 2h6v6M10 2 3 9" fill="none" stroke="currentColor" strokeWidth="1.4" /></svg>
    </a>
  );
}

export function Addr({ a }: { a: string }) {
  return (
    <a className="addr" href={addressUrl(a)} target="_blank" rel="noreferrer" title={a}>
      {nameOf(a)}
    </a>
  );
}

export function Note({ art, title, children, tone = 'plain', action }: { art?: string; title: string; children?: ReactNode; tone?: 'plain' | 'bad' | 'ok' | 'warn'; action?: ReactNode }) {
  return (
    <div className={`note note-${tone}`} role={tone === 'bad' ? 'alert' : undefined}>
      {art && <Art name={art} size={72} />}
      <div className="note-body">
        <b>{title}</b>
        {children && <div className="note-text">{children}</div>}
        {action && <div className="note-action">{action}</div>}
      </div>
    </div>
  );
}

export function Skeleton({ w = '100%', h = 18 }: { w?: number | string; h?: number }) {
  return <span className="skel" style={{ width: w, height: h }} aria-hidden="true" />;
}

export type StepState = 'todo' | 'run' | 'done' | 'fail' | 'skip';
export type Step = { key: string; title: string; detail: string; state: StepState; hash?: string; error?: string };

export function Steps({ steps }: { steps: Step[] }) {
  return (
    <ol className="steps">
      {steps.map((s) => (
        <li key={s.key} className={`step step-${s.state}`}>
          <i aria-hidden="true">
            {s.state === 'done' ? (
              <svg width="12" height="12" viewBox="0 0 12 12"><path d="M2.5 6.5 5 9l4.5-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
            ) : s.state === 'run' ? (
              <span className="spin" />
            ) : s.state === 'fail' ? (
              '!'
            ) : null}
          </i>
          <div>
            <b>{s.title}</b>
            <small>{s.state === 'skip' ? 'Already done' : s.detail}</small>
            {s.hash && <TxLink hash={s.hash} />}
            {s.error && <p className="step-err">{s.error}</p>}
          </div>
        </li>
      ))}
    </ol>
  );
}

export function Mark({ size = 28 }: { size?: number }) {
  // The noren: a shop-front curtain split into three panels.
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="9" fill="var(--kaki)" />
      <path d="M7 9h18" stroke="var(--night)" strokeWidth="2.4" strokeLinecap="round" />
      <path d="M8.5 11.5h4.2v10.2c0 .6-.5 1-1 .8l-2.2-.9a1.6 1.6 0 0 1-1-1.5zM13.9 11.5h4.2v11.6c0 .5-.5.9-1 .7l-1.1-.4-1.1.4c-.5.2-1-.2-1-.7zM19.3 11.5h4.2v8.6c0 .7-.4 1.2-1 1.5l-2.2.9c-.5.2-1-.2-1-.8z" fill="var(--night)" />
    </svg>
  );
}
