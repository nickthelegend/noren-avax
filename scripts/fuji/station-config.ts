// Reads NorenGasStation's limits and, with an argument, raises the per-requester daily cap (owner only).
// Usage: node fuji/station-config.ts [perTagDaily]
import { norenGasStationAbi } from '@noren-avax/sdk';
import { load, pub, record, send, wallet } from './lib.ts';

const d = load() as ReturnType<typeof load> & { norenGasStation: `0x${string}` };
const c = { address: d.norenGasStation, abi: norenGasStationAbi } as const;
const [amt, cap, per, u, w] = await Promise.all(['dripAmount', 'dailyCap', 'perTagDaily', 'usdcPack', 'wbtcPack'].map((f) => pub.readContract({ ...c, functionName: f as never }) as Promise<bigint | number>));
console.log({ dripAmount: String(amt), dailyCap: Number(cap), perTagDaily: Number(per), usdcPack: String(u), wbtcPack: String(w) });
const want = process.argv[2] ? Number(process.argv[2]) : null;
if (want && want !== Number(per)) {
  const dep = wallet('DEPLOYER');
  record('station_per_tag', await send(dep, d.norenGasStation, norenGasStationAbi, 'configure', [amt, cap, want, u, w]), dep.account!.address, `NorenGasStation: ${want} starter packs per requester per day (film and judge runs)`);
}
process.exit(0);
