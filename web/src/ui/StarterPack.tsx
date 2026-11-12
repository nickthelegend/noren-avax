import { useState } from 'react';
import type { Address } from 'viem';
import { getStarterPack } from '../lib/api';
import { readable } from '../lib/chain';
import { Note, TxLink } from './kit';

/** Shown when the connected wallet has no Fuji AVAX: one signature, and NorenGasStation sends gas and test tokens. */
export function StarterPack({ address }: { address: Address }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [hash, setHash] = useState<string | null>(null);
  if (hash)
    return (
      <Note tone="ok" art="sealed-coin" title="Funded: gas, 100 tUSDC and 0.01 tWBTC">
        <TxLink hash={hash} label="NorenGasStation on Snowtrace" />
      </Note>
    );
  return (
    <Note
      tone={err ? 'bad' : 'warn'}
      art="sealed-coin"
      title="This wallet has no Fuji AVAX"
      action={
        <button
          className="btn btn-dark"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setErr(null);
            try {
              setHash(await getStarterPack(address));
            } catch (e) {
              setErr(readable(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? 'Funding on Fuji…' : 'Get test funds'}
        </button>
      }
    >
      {err ?? 'Get gas, 100 test USDC and 0.01 test BTC in one tap. No faucet, no captcha.'}
    </Note>
  );
}
