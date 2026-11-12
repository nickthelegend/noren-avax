// A fresh local Anvil chain for the end-to-end tests: a free port picked by the OS, and a check that the chain
// answering is the one this process started (block 0, our pid alive). Back-to-back runs used to share the fixed
// port 5391, so a run could reach the previous run's still-exiting Anvil and see its state.
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { http } from 'viem';
import { local, publicClientFor } from '@noren-avax/sdk';

export async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.unref();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const p = (s.address() as { port: number }).port;
      s.close(() => resolve(p));
    });
  });
}

export async function startAnvil(extra: string[] = []) {
  const port = await freePort();
  const rpc = `http://127.0.0.1:${port}`;
  const chain = local(rpc);
  const pub = publicClientFor(chain, http(rpc));
  const proc: ChildProcess = spawn('anvil', ['--port', String(port), '--chain-id', '31337', '--silent', '--code-size-limit', '100000', ...extra], { stdio: 'ignore' });
  let exited: number | null = null;
  proc.on('exit', (c) => (exited = c ?? -1));
  for (let i = 0; i < 100; i++) {
    if (exited !== null) throw new Error(`anvil exited with ${exited} before it answered on ${port}`);
    try {
      const n = await pub.getBlockNumber();
      if (n !== 0n) throw new Error(`the chain on ${port} is not fresh (block ${n})`);
      const stop = () => {
        if (exited === null) proc.kill('SIGTERM');
      };
      process.on('exit', stop);
      return { rpc, chain, pub, proc, stop };
    } catch (e) {
      if ((e as Error).message.includes('not fresh')) throw e;
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  proc.kill('SIGTERM');
  throw new Error('anvil did not start');
}
