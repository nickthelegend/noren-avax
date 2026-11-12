// Mints more starter-pack tokens into NorenGasStation (the deployer owns the test tokens) so the AVAX and the tokens
// run out together. Usage: node fuji/stock-station.ts <packs>
import { formatEther } from 'viem';
import { norenGasStationAbi, norenTokenAbi } from '@noren-avax/sdk';
import { load, pub, record, send, wallet } from './lib.ts';

const packs = BigInt(process.argv[2] ?? '150');
const d = load() as ReturnType<typeof load> & { norenGasStation: `0x${string}` };
const w = wallet('DEPLOYER');
record('station_stock_usdc', await send(w, d.tUSDC, norenTokenAbi, 'mint', [d.norenGasStation, packs * 100_000_000n]), w.account!.address, `mint ${packs * 100n} tUSDC into NorenGasStation`);
record('station_stock_wbtc', await send(w, d.tWBTC, norenTokenAbi, 'mint', [d.norenGasStation, packs * 1_000_000n]), w.account!.address, `mint ${Number(packs) / 100} tWBTC into NorenGasStation`);
const room = (await pub.readContract({ address: d.norenGasStation, abi: norenGasStationAbi, functionName: 'room', args: ['0x' + '00'.repeat(32)] })) as readonly bigint[];
console.log(`station AVAX ${formatEther(await pub.getBalance({ address: d.norenGasStation }))}, packs funded ${room[2]}`);
process.exit(0);
