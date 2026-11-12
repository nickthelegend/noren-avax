import { useState } from 'react';
import { erc20Abi, formatEther, parseEther, parseUnits, type Abi, type Address } from 'viem';
import { AVAX, norenCreditAbi, norenTokenAbi, readPosition, readWallet } from '@noren-avax/sdk';
import { getStarterPack } from '../lib/api';
import { D, pub, readable } from '../lib/chain';
import { useWho, write } from '../lib/signer';
import { Art3d } from '../ui/nk/Art3d';
import { Mark } from '../ui/nk/marks';
import { TxBtn, cap, u6, usd } from './common';
import { useAccount } from './market';

export type CreditAct = 'deposit' | 'borrow' | 'repay' | 'withdraw';
const TITLE: Record<CreditAct, string> = { deposit: 'Add collateral', borrow: 'Borrow tUSDC', repay: 'Repay your credit', withdraw: 'Withdraw collateral' };

/** The sheet behind every credit action. Each one is a real NorenCredit call from the connected wallet on Fuji. */
export function CreditSheet({ action, close, connect }: { action: CreditAct; close: () => void; connect: () => void }) {
  const who = useWho();
  const acct = useAccount();
  const [asset, setAsset] = useState<'btc' | 'avax'>('btc');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<{ hash: string; what: string }[]>([]);
  const a = acct.data;
  const p = a?.pos;
  const pick = action === 'deposit' || action === 'withdraw';
  const unit = action === 'borrow' || action === 'repay' ? 'tUSDC' : asset === 'btc' ? 'tWBTC' : 'AVAX';
  const placeholder = action === 'deposit' ? (asset === 'btc' ? '0.01' : '0.005') : action === 'repay' ? 'Everything owed' : action === 'borrow' ? (p ? (u6(p.available)! > 0 ? Math.min(20, Math.floor(u6(p.available)!)).toFixed(2) : '0.00') : '20.00') : '0.00';

  async function run() {
    if (!who) return connect();
    setBusy(true);
    setErr(null);
    const hashes: { hash: string; what: string }[] = [];
    const w = async (to: Address, abi: Abi, fn: string, args: unknown[], what: string, value?: bigint) => {
      const hash = await write(to, abi, fn, args, what, value);
      hashes.push({ hash, what });
      setDone([...hashes]);
      return hash;
    };
    try {
      if (action === 'deposit') {
        if (asset === 'btc') {
          const amt = amount.trim() ? parseUnits(amount.trim(), 8) : 1_000_000n;
          const wal = await readWallet(pub as never, D, who.address);
          if (wal.wbtc < amt) await w(D.tWBTC, norenTokenAbi as Abi, 'faucet', [], 'tWBTC faucet');
          const al = await pub.readContract({ address: D.tWBTC, abi: erc20Abi, functionName: 'allowance', args: [who.address, D.norenCredit] });
          if (al < amt) await w(D.tWBTC, erc20Abi as Abi, 'approve', [D.norenCredit, 2n ** 255n], 'approve tWBTC');
          await w(D.norenCredit, norenCreditAbi as Abi, 'depositCollateral', [D.tWBTC, amt], `lock ${Number(amt) / 1e8} tWBTC`);
        } else {
          const amt = parseEther(amount.trim() || '0.005');
          await w(D.norenCredit, norenCreditAbi as Abi, 'depositAvax', [], `lock ${formatEther(amt)} AVAX`, amt);
        }
      } else if (action === 'borrow') {
        const amt = parseUnits(amount.trim() || placeholder, 6);
        if (amt <= 0n) throw Error('Enter an amount to borrow, like 20.00');
        await w(D.norenCredit, norenCreditAbi as Abi, 'borrow', [amt, who.address], `borrow ${(Number(amt) / 1e6).toFixed(2)} tUSDC`);
      } else if (action === 'repay') {
        const all = !amount.trim();
        const amt = all ? 2n ** 256n - 1n : parseUnits(amount.trim(), 6);
        const debt = (await readPosition(pub as never, D, who.address)).debt;
        if (debt === 0n) throw Error('Nothing is owed on this wallet.');
        const need = all ? debt + debt / 1000n + 10n : amt;
        const wal = await readWallet(pub as never, D, who.address);
        if (wal.usdc < (all ? debt : amt)) throw Error(`You need ${usd(u6(all ? debt : amt))} public tUSDC in this wallet to repay; you have ${usd(u6(wal.usdc))}.`);
        const al = await pub.readContract({ address: D.tUSDC, abi: erc20Abi, functionName: 'allowance', args: [who.address, D.norenCredit] });
        if (al < need) await w(D.tUSDC, erc20Abi as Abi, 'approve', [D.norenCredit, 2n ** 255n], 'approve tUSDC');
        await w(D.norenCredit, norenCreditAbi as Abi, 'repay', [who.address, amt], all ? 'repay in full' : `repay ${amount.trim()} tUSDC`);
      } else {
        const token = asset === 'btc' ? D.tWBTC : AVAX;
        const held = asset === 'btc' ? p?.btc ?? 0n : p?.avax ?? 0n;
        const amt = amount.trim() ? (asset === 'btc' ? parseUnits(amount.trim(), 8) : parseEther(amount.trim())) : held;
        if (amt <= 0n) throw Error(`No ${unit} is locked on this wallet.`);
        await w(D.norenCredit, norenCreditAbi as Abi, 'withdrawCollateral', [token, amt], `withdraw ${asset === 'btc' ? Number(amt) / 1e8 : formatEther(amt)} ${unit}`);
      }
      setAmount('');
    } catch (e) {
      setErr(readable(e));
    } finally {
      setBusy(false);
      acct.reload();
    }
  }

  const finished = done.length > 0 && !busy && !err;
  return (
    <div className="nk-modal" role="dialog" aria-modal="true" aria-label={TITLE[action]} onClick={(e) => e.target === e.currentTarget && !busy && close()}>
      <div className="nk-sheet">
        <div className="nk-sheet-h">
          <b>{TITLE[action]}</b>
          <button className="nk-x" onClick={close} aria-label="Close" disabled={busy}>
            ×
          </button>
        </div>
        <div style={{ overflowY: 'auto' }}>
          {!who ? (
            <div className="nc-sheet-3d">
              <Art3d k="shield" size={52} />
              <p>Connect a wallet on Avalanche Fuji. The test wallet works with nothing installed.</p>
            </div>
          ) : (
            a && a.wallet.avax === 0n && <StarterCard address={who.address} compact />
          )}
          {pick && (
            <div className="nk-band" role="radiogroup" aria-label="Collateral">
              <span>Collateral</span>
              {(['btc', 'avax'] as const).map((k) => (
                <button key={k} type="button" role="radio" aria-checked={asset === k} aria-pressed={asset === k} disabled={busy} onClick={() => { setAsset(k); setAmount(''); }}>
                  {k === 'btc' ? 'tWBTC' : 'AVAX'}
                </button>
              ))}
            </div>
          )}
          <div className="nk-box" style={{ marginTop: 10 }}>
            <label htmlFor="na-act-amt">
              <span>Amount in {unit}</span>
              {action === 'borrow' && p && <span className="mono">{usd(u6(p.available))} available</span>}
              {action === 'repay' && p && <span className="mono">{usd(u6(p.debt))} owed</span>}
            </label>
            <div className="nk-row">
              <input id="na-act-amt" inputMode="decimal" value={amount} placeholder={placeholder} disabled={busy} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))} aria-label={`Amount in ${unit}`} />
              <span className="nk-token" data-static="true">
                <Mark id={unit === 'tUSDC' ? 'USDC' : unit === 'AVAX' ? 'AVAX' : 'BTC'} size={28} />
                {unit}
              </span>
            </div>
          </div>
          <p className="nc-fine">
            {a
              ? `In your wallet: ${usd(u6(a.wallet.usdc))} tUSDC · ${Number(a.wallet.wbtc) / 1e8} tWBTC · ${Number(formatEther(a.wallet.avax)).toFixed(4)} AVAX.`
              : who
                ? 'Reading your balances…'
                : 'Fuji test tokens only; no real value.'}
          </p>
          {who ? (
            <button className="nk-cta" disabled={busy} onClick={run}>
              {busy ? 'Confirming on Fuji…' : action === 'deposit' ? 'Lock collateral' : action === 'borrow' ? 'Borrow to my wallet' : action === 'repay' ? (amount.trim() ? `Repay ${amount.trim()} tUSDC` : 'Repay everything owed') : 'Withdraw collateral'}
            </button>
          ) : (
            <button className="nk-cta" onClick={connect}>
              Connect a wallet
            </button>
          )}
          {err && <p className="nk-err" role="alert">{err}</p>}
          {done.length > 0 && (
            <div className="nc-receipt" role="status" aria-live="polite">
              <div className="nc-receipt-h">
                <Art3d k={finished ? 'success' : err ? 'warning' : 'hourglass'} size={44} />
                <b>{finished ? 'Confirmed on Avalanche Fuji' : err ? 'Stopped' : 'Confirming on Fuji…'}</b>
              </div>
              <div className="na-btns">
                {done.map((d) => (
                  <TxBtn key={d.hash} hash={d.hash} label={cap(d.what)} />
                ))}
              </div>
            </div>
          )}
          <p className="nc-fine">
            {action === 'deposit'
              ? 'A first tWBTC lock draws test tWBTC from its faucet and approves NorenCredit. Priced by Chainlink on Fuji.'
              : action === 'borrow'
                ? 'NorenCredit checks the Chainlink price is fresh and your limit holds, then lends from the pool.'
                : action === 'repay'
                  ? 'Repaying needs public tUSDC in this wallet and works even when a price is stale.'
                  : 'Collateral returns to this wallet. What stays locked must still cover the debt.'}
          </p>
        </div>
      </div>
    </div>
  );
}

/** One signature, and NorenGasStation sends gas and test tokens to a wallet with no Fuji AVAX. */
export function StarterCard({ address, compact }: { address: Address; compact?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [hash, setHash] = useState<string | null>(null);
  const body = (
    <div className={`na-starter ${hash ? 'done' : ''}`}>
      <Art3d k={hash ? 'success' : 'medal'} size={compact ? 52 : 64} />
      <div>
        <b>{hash ? 'Funded: gas, 100 tUSDC and 0.01 tWBTC' : 'This wallet has no Fuji AVAX'}</b>
        <p>{hash ? 'NorenGasStation sent the starter pack in one transaction.' : 'Get gas, 100 test USDC and 0.01 test BTC in one tap. No faucet, no captcha.'}</p>
        {err && <p className="nk-err" role="alert">{err}</p>}
        {hash ? (
          <TxBtn hash={hash} label="NorenGasStation on Snowtrace" />
        ) : (
          <button
            className="nk-btn na-kaki"
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
        )}
      </div>
    </div>
  );
  if (compact) return body;
  return <section className="nk-card na-starter-card">{body}</section>;
}
