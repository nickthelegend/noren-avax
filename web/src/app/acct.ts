/** Everything the Noren app reads for the connected wallet on Fuji, in one place. Nothing is a placeholder. */
import { useCallback, useEffect, useState } from "react";
import { erc20Abi, type Address } from "viem";
import { STOCKS, norenStockCreditAbi, norenStockOracleAbi, readCredit, stockToken, type CreditView, type StockSym } from "@noren-avax/sdk";
import { D, pub, readable } from "../lib/chain";
import { isUnlocked, privateSession, useSignerVersion, useWho } from "../lib/signer";

export type Stock = { sym: StockSym; name: string; token: Address; balance: bigint; price8: bigint; marketTime: number; fresh: boolean; value6: bigint };
export type Pool = { totalAssets: bigint; outstanding: bigint; fees: bigint; cash: bigint; myValue: bigint; myShares: bigint };
export type Acct = {
  address: Address; avax: bigint; usdc: bigint; wbtc: bigint; stocks: Stock[]; stocks6: bigint;
  priv: bigint | null; credit: CreditView | null; pool: Pool | null;
};

export function useAcct() {
  const who = useWho();
  const ver = useSignerVersion();
  const [acct, setAcct] = useState<Acct | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const load = useCallback(async () => {
    if (!who) { setAcct(null); return; }
    const a = who.address;
    try {
      const [avax, usdc, wbtc, stocks, credit, pool] = await Promise.all([
        pub.getBalance({ address: a }),
        pub.readContract({ address: D.tUSDC, abi: erc20Abi, functionName: "balanceOf", args: [a] }) as Promise<bigint>,
        pub.readContract({ address: D.tWBTC, abi: erc20Abi, functionName: "balanceOf", args: [a] }) as Promise<bigint>,
        Promise.all(STOCKS.map(async (s) => {
          const token = stockToken(D, s);
          const [balance, last] = await Promise.all([
            pub.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [a] }) as Promise<bigint>,
            pub.readContract({ address: D.stockOracle, abi: norenStockOracleAbi, functionName: "last", args: [token] }) as Promise<readonly [bigint, bigint, bigint, boolean]>,
          ]);
          return { sym: s.sym, name: s.name, token, balance, price8: last[0], marketTime: Number(last[1]), fresh: last[3], value6: (balance * last[0]) / 10n ** 20n };
        })),
        readCredit(pub as never, D, a).catch(() => null),
        readPool(a).catch(() => null),
      ]);
      const priv = isUnlocked() ? (await privateSession().balance()).cents : null;
      setAcct({ address: a, avax, usdc, wbtc, stocks, stocks6: stocks.reduce((s, x) => s + x.value6, 0n), priv, credit, pool });
      setErr(null);
    } catch (e) { setErr(readable(e)); }
  }, [who?.address, ver]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setAcct(null); load(); const t = setInterval(load, 15_000); const on = () => { setTimeout(load, 600); setTimeout(load, 4000); }; addEventListener("noren:tx", on); return () => { clearInterval(t); removeEventListener("noren:tx", on); }; }, [load]);
  return { who, acct, err, reload: () => { setTick(tick + 1); load(); } };
}

export async function readPool(me?: Address): Promise<Pool> {
  const c = { address: D.stockCredit, abi: norenStockCreditAbi } as const;
  const [totalAssets, outstanding, fees, cash, myValue, myShares] = await Promise.all([
    pub.readContract({ ...c, functionName: "totalAssets" }) as Promise<bigint>,
    pub.readContract({ ...c, functionName: "outstandingPrincipal" }) as Promise<bigint>,
    pub.readContract({ ...c, functionName: "feesEarned" }) as Promise<bigint>,
    pub.readContract({ address: D.tUSDC, abi: erc20Abi, functionName: "balanceOf", args: [D.stockCredit] }) as Promise<bigint>,
    me ? (pub.readContract({ ...c, functionName: "valueOf", args: [me] }) as Promise<bigint>) : Promise.resolve(0n),
    me ? (pub.readContract({ ...c, functionName: "sharesOf", args: [me] }) as Promise<bigint>) : Promise.resolve(0n),
  ]);
  return { totalAssets, outstanding, fees, cash, myValue, myShares };
}

export const u6 = (v?: bigint | null) => (v == null ? "–" : (Number(v) / 1e6).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
export const c2 = (v?: bigint | null) => (v == null ? "–" : (Number(v) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
export const sh = (v: bigint, dp = 4) => (Number(v) / 1e18).toLocaleString("en-US", { maximumFractionDigits: dp });
export const p8 = (v: bigint) => (Number(v) / 1e8).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const when = (t: number) => new Date(t * 1000).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC", timeZoneName: "short" });
