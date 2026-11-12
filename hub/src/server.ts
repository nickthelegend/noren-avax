// Noren's API: the settlement hub loop, the gas-station relay and payment receipts.
//
//   GET  /api/health    hub + relayer addresses, balances, what is missing ("setup_required")
//   GET  /api/hub       settlement cadence, queue length (never amounts), next batch time
//   GET  /api/gas       today's starter packs left for this requester
//   POST /api/gas       { to, deadline, sig } -> NorenGasStation.drip by the relayer
//   POST /api/receipt   { tx, claim } -> the hub's signed receipt for that payment
//
// Keys come from the environment or NOREN_ENV_FILE by variable name: NOREN_HUB_KEY, NOREN_RELAYER_KEY,
// NOREN_GAS_SALT. Missing ones turn the matching endpoint into "Setup required"; nothing is faked.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWalletClient, formatEther, http, nonceManager, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { circuitURLs, fuji, fujiTransport, hasHub, local, publicClientFor, type Deployment } from '@noren-avax/sdk';
import { Hub } from './hub.ts';
import { GasRelay, HttpError } from './gas.ts';
import { Assistant } from './ask.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');

function readEnv(path: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!existsSync(path)) return out;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (m) out[m[1]!] = m[2]!.replace(/^["']|["']$/g, '');
  }
  return out;
}

const env = { ...readEnv(process.env.NOREN_ENV_FILE ?? join(ROOT, '.env')), ...process.env } as Record<string, string | undefined>;
const key = (v: string) => (v.startsWith('0x') ? v : `0x${v}`) as Hex;

const d = JSON.parse(readFileSync(env.NOREN_DEPLOYMENT ?? join(ROOT, 'deployments/fuji.json'), 'utf8')) as Deployment;
const chain = d.chainId === 43113 ? fuji : local(env.NOREN_RPC ?? 'http://127.0.0.1:8545');
const transport = d.chainId === 43113 && !env.NOREN_RPC ? fujiTransport() : http(env.NOREN_RPC);
const pub = publicClientFor(chain, transport);
const circuits = circuitURLs(env.NOREN_CIRCUITS ?? join(ROOT, 'web/public/circuits'));
const PORT = Number(env.PORT ?? 5370);
const EVERY = Number(env.NOREN_SETTLE_EVERY ?? 180);
const COVER = Number(env.NOREN_COVER_MIN ?? 3);

const setup: string[] = [];
if (!hasHub(d)) setup.push('deployment has no norenSettlement / norenGasStation (run scripts/fuji/deploy-hub.ts)');
if (!env.NOREN_HUB_KEY) setup.push('NOREN_HUB_KEY');
if (!env.NOREN_RELAYER_KEY) setup.push('NOREN_RELAYER_KEY');
if (!env.NOREN_GAS_SALT) setup.push('NOREN_GAS_SALT');

const wallet = (k: string) => createWalletClient({ account: privateKeyToAccount(key(k), { nonceManager }), chain, transport });
let hub: Hub | null = null;
let hubError: string | null = null;
if (hasHub(d) && env.NOREN_HUB_KEY) {
  hub = new Hub({ pub: pub as never, wallet: wallet(env.NOREN_HUB_KEY), d, circuits, stateFile: env.NOREN_STATE ?? join(ROOT, '.hub/state.json'), everySec: EVERY, coverMin: COVER });
}
const gas = hasHub(d) && env.NOREN_RELAYER_KEY && env.NOREN_GAS_SALT ? new GasRelay(pub as never, wallet(env.NOREN_RELAYER_KEY), d, env.NOREN_GAS_SALT) : null;
const ask = new Assistant(env.ANTHROPIC_API_KEY ?? null, env.NOREN_ASK_MODEL ?? 'claude-haiku-5-5', Number(env.NOREN_ASK_DAILY ?? 300));

async function loop() {
  if (!hub) return;
  try {
    await hub.start();
    hubError = null;
  } catch (e) {
    hubError = (e as Error).message;
    console.error(`[hub] ${hubError}`);
    setTimeout(loop, 60_000);
    return;
  }
  console.log(`[hub] ${hub.address} settling every ${EVERY}s, cover set >= ${COVER}`);
  const tick = async () => {
    try {
      await hub!.scan();
      await hub!.settle();
    } catch (e) {
      console.error(`[hub] tick: ${(e as Error).message.slice(0, 300)}`);
    }
    setTimeout(tick, 10_000);
  };
  tick();
}

function ipOf(req: IncomingMessage) {
  // Behind Traefik, X-Real-IP is set by the proxy; locally it is the socket address.
  return String(req.headers['x-real-ip'] ?? req.headers['x-forwarded-for'] ?? req.socket.remoteAddress ?? '').split(',')[0]!.trim();
}

async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  let s = '';
  for await (const c of req) {
    s += c;
    if (s.length > 64_000) throw new HttpError(413, 'body too large');
  }
  try {
    return s ? JSON.parse(s) : {};
  } catch {
    throw new HttpError(400, 'body must be JSON');
  }
}

function send(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, {
    'content-type': 'application/json',
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'content-type',
    'cache-control': 'no-store',
  });
  res.end(JSON.stringify(data, (_, v) => (typeof v === 'bigint' ? v.toString() : v)));
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  try {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'GET, POST' });
      return res.end();
    }
    if (url.pathname === '/api/health') {
      const out: Record<string, unknown> = { ok: setup.length === 0 && !hubError, chainId: d.chainId, setup_required: setup, hubError, ask: ask.ready };
      if (hub) {
        out.hub = hub.address;
        out.hubAvax = formatEther(await pub.getBalance({ address: hub.address }));
      }
      if (gas) out.gas = await gas.status(ipOf(req));
      return send(res, 200, out);
    }
    if (url.pathname === '/api/hub' && req.method === 'GET') {
      if (!hub) return send(res, 503, { error: `Setup required: ${setup.join(', ')}` });
      return send(res, 200, { ...hub.status(), error: hubError });
    }
    if (url.pathname === '/api/gas') {
      if (!gas) return send(res, 503, { error: `Setup required: ${setup.join(', ')}` });
      if (req.method === 'GET') return send(res, 200, await gas.status(ipOf(req)));
      if (req.method === 'POST') return send(res, 200, await gas.drip((await body(req)) as never, ipOf(req)));
    }
    if (url.pathname === '/api/receipt' && req.method === 'POST') {
      if (!hub) return send(res, 503, { error: `Setup required: ${setup.join(', ')}` });
      const b = await body(req);
      if (!/^0x[0-9a-fA-F]{64}$/.test(String(b.tx)) || typeof b.claim !== 'string') throw new HttpError(400, 'tx and claim are required');
      const r = await hub.receipt(String(b.tx).toLowerCase() as Hex, b.claim);
      if (r.status === 'forbidden') throw new HttpError(403, 'That claim does not match this payment.');
      if (r.status === 'unknown') throw new HttpError(404, 'The hub has not seen this payment yet. It reads Fuji every 10 seconds.');
      return send(res, 200, r);
    }
    if (url.pathname === '/api/ask' && req.method === 'POST') return send(res, 200, await ask.reply((await body(req)) as never, ipOf(req)));
    send(res, 404, { error: 'not found' });
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    if (status === 500) console.error(e);
    send(res, status, { error: (e as Error).message.slice(0, 400) });
  }
});

server.listen(PORT, env.NOREN_HOST ?? '127.0.0.1', () => console.log(`[api] http://${env.NOREN_HOST ?? '127.0.0.1'}:${PORT}`));
loop();
for (const s of ['SIGINT', 'SIGTERM'] as const) process.on(s, () => process.exit(0));
