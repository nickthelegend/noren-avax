import { useCallback, useEffect, useRef, useState } from 'react';
import { readable } from './chain';

export type Load<T> = { data: T | undefined; error: string | null; loading: boolean; reload: () => void };

/** Loads `fn`, reloads after every Noren transaction and every `everyMs`. Keeps the last good data while refreshing. */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[], everyMs = 0, afterTxMs: number[] = [400, 3500]): Load<T> {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);
  const run = useCallback(() => {
    const id = ++seq.current;
    setLoading(true);
    fn()
      .then((d) => {
        if (id !== seq.current) return;
        setData(d);
        setError(null);
      })
      .catch((e) => id === seq.current && setError(readable(e)))
      .finally(() => id === seq.current && setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => {
    setData(undefined);
    run();
    // Public Fuji RPCs sit behind load balancers and can trail a block: read now and once more a bit later.
    // A burst of transactions (a payment plan sends several) re-reads once per delay, not once per transaction.
    let timers: ReturnType<typeof setTimeout>[] = [];
    const onTx = () => {
      timers.forEach(clearTimeout);
      timers = afterTxMs.map((ms) => setTimeout(run, ms));
    };
    addEventListener('noren:tx', onTx);
    const t = everyMs ? setInterval(run, everyMs) : undefined;
    return () => {
      removeEventListener('noren:tx', onTx);
      timers.forEach(clearTimeout);
      if (t) clearInterval(t);
    };
  }, [run, everyMs]);
  return { data, error, loading, reload: run };
}

export function useNow(ms = 30_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

export function ago(sec: number, now = Date.now()) {
  const s = Math.max(0, Math.round(now / 1000 - sec));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}
