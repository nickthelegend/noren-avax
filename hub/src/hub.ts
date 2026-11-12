// Noren settlement hub: takes private customer payments, pays shops in batches, records each batch on chain.
//
//  1. scan(): reads every eERC PrivateTransfer to the hub, decrypts its amount (the receiver ciphertext in the proof)
//     and its note (shop, order, claim), and queues it. Payments with no valid note are queued for a refund.
//  2. settle(): on the cadence (every `everySec`, aligned to the clock), pays each shop that is owed the sum of its
//     payments in one private transfer whose encrypted note is the itemised statement, adds zero-value cover
//     transfers until at least `coverMin` shops are paid, refunds unroutable payments, then posts the batch to
//     NorenSettlement with the statement digests, the accountant copies and the auditor copy.
//  3. receipt(): a hub-signed receipt for the customer who holds the payment's claim secret.
//
// State (queued payments, the batch in flight) is a JSON file, so a restart picks up a half-done batch and finishes
// it; the chain stays the source of truth (settledIn / payoutRecorded are checked before anything is redone).
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { decodeFunctionData, type Address, type Hex, type PublicClient, type WalletClient } from 'viem';
import {
  NorenPrivate,
  encryptNote,
  encryptedErcAbi,
  norenSettlementAbi,
  parseHubNote,
  privateTransferEvent,
  publicKeyOf,
  readShops,
  receiptText,
  scanLogs,
  statementDigest,
  type AuditorStatement,
  type CircuitURLs,
  type HubDeployment,
  type ShopStatement,
} from '@noren-avax/sdk';

export interface Queued {
  tx: Hex;
  from: Address;
  block: string;
  cents: string;
  shopId: number | null;
  order: string;
  item: string;
  claim: string;
  problem: string | null;
  seenAt: number;
}

interface InFlight {
  batch: number;
  payments: Hex[];
  payouts: { shop: number; owner: Address; cents: string; statement: string; payoutTx: Hex | null }[];
  refunds: { tx: Hex; to: Address; cents: string; reason: string; refundTx: Hex | null }[];
  salt: string;
}

interface State {
  scannedTo: string;
  queued: Queued[];
  settled: Record<string, { batch: number; shopId: number | null; cents: string; order: string; claim: string; payoutTx: Hex | null; refundTx: Hex | null }>;
  inflight: InFlight | null;
  lastBatchAt: number;
  lastError: string | null;
}

export interface HubOptions {
  pub: PublicClient;
  wallet: WalletClient;
  d: HubDeployment;
  circuits: CircuitURLs;
  stateFile: string;
  everySec: number;
  coverMin: number;
  log?: (m: string) => void;
}

export class Hub {
  readonly priv: NorenPrivate;
  readonly o: HubOptions;
  state: State;
  busy = false;
  private log: (m: string) => void;

  constructor(o: HubOptions) {
    this.o = o;
    this.priv = new NorenPrivate(o.pub, o.wallet, o.d, o.circuits);
    this.log = o.log ?? ((m) => console.log(`[hub] ${new Date().toISOString()} ${m}`));
    this.state = existsSync(o.stateFile)
      ? JSON.parse(readFileSync(o.stateFile, 'utf8'))
      : { scannedTo: String(o.d.hubDeployBlock - 1), queued: [], settled: {}, inflight: null, lastBatchAt: 0, lastError: null };
  }

  get address() {
    return this.priv.me;
  }

  private save() {
    mkdirSync(dirname(this.o.stateFile), { recursive: true });
    const tmp = `${this.o.stateFile}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.state, null, 1));
    renameSync(tmp, this.o.stateFile);
  }

  async start() {
    await this.priv.unlock();
    if (!(await this.priv.isRegistered())) throw new Error('Setup required: the hub key is not registered with the eERC Registrar');
    const onChain = (await this.o.pub.readContract({ address: this.o.d.norenSettlement, abi: norenSettlementAbi, functionName: 'hub' })) as Address;
    if (onChain.toLowerCase() !== this.address.toLowerCase()) throw new Error(`Setup required: NorenSettlement.hub() is ${onChain}, not this key (${this.address})`);
  }

  /** Next settlement time (unix seconds), aligned to the clock so customers can't be singled out by timing. */
  nextSettleAt(now = Date.now() / 1000) {
    const e = this.o.everySec;
    return Math.floor(now / e) * e + e;
  }

  /** Reads new payments to the hub and queues them. */
  async scan(): Promise<number> {
    const head = await this.o.pub.getBlockNumber({ cacheTime: 0 });
    const from = BigInt(this.state.scannedTo) + 1n;
    if (from > head) return 0;
    const logs = await scanLogs(this.o.pub, { address: this.o.d.encryptedERC, event: privateTransferEvent, args: { to: this.address }, fromBlock: from, toBlock: head });
    let n = 0;
    for (const l of logs) {
      const tx = l.transactionHash as Hex;
      if (this.state.settled[tx] || this.state.queued.some((q) => q.tx === tx)) continue;
      if (this.state.inflight?.payments.includes(tx)) continue;
      this.state.queued.push(await this.read(tx, l.args.from as Address, l.blockNumber!));
      n++;
    }
    this.state.scannedTo = String(head);
    this.save();
    if (n) this.log(`queued ${n} payment(s)`);
    return n;
  }

  private async read(tx: Hex, from: Address, block: bigint): Promise<Queued> {
    const q: Queued = { tx, from, block: String(block), cents: '0', shopId: null, order: '', item: '', claim: '', problem: null, seenAt: Math.floor(Date.now() / 1000) };
    try {
      const t = await this.o.pub.getTransaction({ hash: tx });
      const call = decodeFunctionData({ abi: encryptedErcAbi, data: t.input });
      const proof = (call.args as unknown as unknown[])[2] as { publicSignals: readonly bigint[] };
      q.cents = String(this.priv.eerc.decryptPCT(proof.publicSignals.slice(16, 23) as bigint[]));
    } catch (e) {
      q.problem = `amount unreadable: ${(e as Error).message}`;
      return q;
    }
    let note: string | null = null;
    try {
      note = await this.priv.memo(tx, block, this.address);
    } catch (e) {
      q.problem = `note unreadable: ${(e as Error).message}`;
    }
    const n = parseHubNote(note);
    if (!n) q.problem ??= 'no Noren note (which shop?)';
    else Object.assign(q, { shopId: n.shopId, order: n.order, item: n.item, claim: n.claim });
    return q;
  }

  /** Settles everything queued, if it is time (or `force`). Returns the batch id, or null if nothing was done. */
  async settle(force = false): Promise<number | null> {
    if (this.busy) return null;
    this.busy = true;
    try {
      if (!this.state.inflight) {
        if (!this.state.queued.length) return null;
        if (!force && Date.now() / 1000 < this.nextSettleAt(Math.min(...this.state.queued.map((q) => q.seenAt)))) return null;
        await this.plan();
        if (!this.state.inflight) {
          this.save();
          return null; // everything queued was already settled on chain
        }
      }
      return await this.finish();
    } catch (e) {
      this.state.lastError = (e as Error).message.slice(0, 300);
      this.save();
      this.log(`settle failed: ${this.state.lastError}`);
      throw e;
    } finally {
      this.busy = false;
    }
  }

  private async plan() {
    const { pub, d } = this.o;
    // Drop anything the chain already settled (a restart after a recorded batch).
    const fresh: Queued[] = [];
    for (const q of this.state.queued) {
      const v = (await pub.readContract({ address: d.norenSettlement, abi: norenSettlementAbi, functionName: 'settledIn', args: [q.tx] })) as bigint;
      if (v === 0n) fresh.push(q);
    }
    this.state.queued = fresh;
    if (!fresh.length) return;
    const shops = await readShops(pub as never, d);
    const byId = new Map(shops.map((s) => [s.id, s]));
    const batch = Number(await pub.readContract({ address: d.norenSettlement, abi: norenSettlementAbi, functionName: 'batchCount' }));
    const due = new Map<number, Queued[]>();
    const refunds: InFlight['refunds'] = [];
    for (const q of fresh) {
      const problem = q.problem ?? (q.shopId == null || !byId.has(q.shopId) ? `unknown shop ${q.shopId}` : null);
      if (problem) {
        // Unroutable money goes back to the sender in this batch; a zero transfer with no note needs nothing back.
        if (BigInt(q.cents) > 0n) refunds.push({ tx: q.tx, to: q.from, cents: q.cents, reason: problem, refundTx: null });
        continue;
      }
      due.set(q.shopId!, [...(due.get(q.shopId!) ?? []), q]);
    }
    // Cover: pay zero to other shops so the set of shops paid doesn't tell which ones sold.
    const others = shops.map((s) => s.id).filter((id) => !due.has(id));
    shuffle(others);
    const cover = others.slice(0, Math.max(0, this.o.coverMin - due.size));
    const payouts: InFlight['payouts'] = [];
    for (const id of [...due.keys(), ...cover]) {
      const items = (due.get(id) ?? []).map((q) => ({ tx: q.tx, cents: q.cents, order: q.order, item: q.item }));
      const st: ShopStatement = {
        v: 1,
        batch,
        shop: id,
        salt: randomBytes(16).toString('hex'),
        total: String(items.reduce((a, it) => a + BigInt(it.cents), 0n)),
        cover: items.length === 0,
        items,
      };
      payouts.push({ shop: id, owner: byId.get(id)!.owner, cents: st.total, statement: JSON.stringify(st), payoutTx: null });
    }
    shuffle(payouts);
    this.state.inflight = { batch, payments: fresh.map((q) => q.tx), payouts, refunds, salt: randomBytes(16).toString('hex') };
    this.state.queued = [];
    this.save();
    this.log(`batch ${batch}: ${fresh.length} payment(s) -> ${due.size} shop(s) + ${cover.length} cover, ${refunds.length} refund(s)`);
  }

  private async finish(): Promise<number> {
    const f = this.state.inflight!;
    const { pub, d } = this.o;
    const need = [...f.payouts.filter((p) => !p.payoutTx).map((p) => BigInt(p.cents)), ...f.refunds.filter((r) => !r.refundTx).map((r) => BigInt(r.cents))].reduce((a, b) => a + b, 0n);
    const bal = (await this.priv.balance()).cents;
    if (bal < need) throw new Error(`hub private balance ${bal} cents is short of ${need} owed in batch ${f.batch}`);
    for (const p of f.payouts) {
      if (p.payoutTx) continue;
      p.payoutTx = await this.priv.pay(p.owner, BigInt(p.cents), p.statement);
      this.save();
      this.log(`batch ${f.batch}: paid shop ${p.shop} ${p.payoutTx}`);
    }
    for (const r of f.refunds) {
      if (r.refundTx) continue;
      r.refundTx = await this.priv.pay(r.to, BigInt(r.cents), `Noren refund for ${r.tx}: ${r.reason}`.slice(0, 200));
      this.save();
      this.log(`batch ${f.batch}: refunded ${r.tx} ${r.refundTx}`);
    }
    const recorded = (await pub.readContract({ address: d.norenSettlement, abi: norenSettlementAbi, functionName: 'payoutRecorded', args: [f.payouts[0]?.payoutTx ?? f.refunds[0]!.refundTx!] })) as boolean;
    if (!recorded) {
      const auditorKey = await this.priv.auditorPublicKey();
      const aud: AuditorStatement = {
        v: 1,
        batch: f.batch,
        salt: f.salt,
        payouts: f.payouts.map((p) => ({ shop: p.shop, owner: p.owner, payoutTx: p.payoutTx!, statement: p.statement })),
        refunds: f.refunds.map((r) => ({ tx: r.tx, cents: r.cents, to: r.to, refundTx: r.refundTx!, reason: r.reason })),
      };
      const forAuditor = await encryptNote(this.priv.eerc.poseidon as never, auditorKey, JSON.stringify(aud));
      const payouts = [];
      for (const p of f.payouts) {
        const acct = (await pub.readContract({ address: d.norenSettlement, abi: norenSettlementAbi, functionName: 'accountantOf', args: [BigInt(p.shop)] })) as Address;
        const forAccountant = acct === '0x0000000000000000000000000000000000000000' ? '0x' : await encryptNote(this.priv.eerc.poseidon as never, await publicKeyOf(pub, d, acct), p.statement);
        payouts.push({ shopId: BigInt(p.shop), payoutTx: p.payoutTx!, digest: statementDigest(p.statement), forAccountant });
      }
      const args = [f.payments, payouts, f.refunds.map((r) => r.refundTx!), forAuditor] as const;
      const { request } = await pub.simulateContract({ address: d.norenSettlement, abi: norenSettlementAbi, functionName: 'settle', args: args as never, account: this.o.wallet.account! });
      const h = await this.o.wallet.writeContract(request as never);
      const r = await pub.waitForTransactionReceipt({ hash: h, pollingInterval: 500, timeout: 120_000 });
      if (r.status !== 'success') throw new Error(`settle reverted: ${h}`);
      this.log(`batch ${f.batch}: recorded ${h}`);
    }
    for (const tx of f.payments) {
      const p = f.payouts.find((x) => x.statement.includes(tx));
      const st = p ? (JSON.parse(p.statement) as ShopStatement).items.find((i) => i.tx === tx) : null;
      const rf = f.refunds.find((x) => x.tx === tx);
      this.state.settled[tx] = {
        batch: f.batch,
        shopId: p?.shop ?? null,
        cents: st?.cents ?? rf?.cents ?? '0',
        order: st?.order ?? '',
        claim: '',
        payoutTx: p?.payoutTx ?? null,
        refundTx: rf?.refundTx ?? null,
      };
    }
    this.state.inflight = null;
    this.state.lastBatchAt = Date.now() / 1000;
    this.state.lastError = null;
    this.save();
    return f.batch;
  }

  /** A signed receipt for the payer: only for whoever knows the payment's claim secret (it was in the note). */
  async receipt(tx: Hex, claim: string) {
    const q = this.state.queued.find((x) => x.tx === tx);
    const inflight = this.state.inflight?.payments.includes(tx);
    let rec: { shopId: number | null; cents: string; order: string; claim: string; status: string; batch: number | null; payoutTx: Hex | null; refundTx: Hex | null } | null = null;
    if (q) rec = { ...q, status: q.problem ? 'refund pending' : 'queued', batch: null, payoutTx: null, refundTx: null };
    else if (inflight) {
      const p = this.state.inflight!.payouts.find((x) => x.statement.includes(tx));
      const it = p ? (JSON.parse(p.statement) as ShopStatement).items.find((i) => i.tx === tx) : null;
      rec = { shopId: p?.shop ?? null, cents: it?.cents ?? '0', order: it?.order ?? '', claim: '', status: 'settling', batch: this.state.inflight!.batch, payoutTx: p?.payoutTx ?? null, refundTx: null };
    } else if (this.state.settled[tx]) rec = { ...this.state.settled[tx]!, status: this.state.settled[tx]!.refundTx ? 'refunded' : 'settled' };
    if (!rec) return { status: 'unknown' as const };
    // The claim is only kept while queued; after that the stored claim hash in the original note is checked again.
    const want = rec.claim || (await this.claimOf(tx));
    if (!want || want !== claim) return { status: 'forbidden' as const };
    const body = { tx, shopId: rec.shopId ?? -1, cents: rec.cents, order: rec.order, chainId: this.o.d.chainId };
    const signature = await this.o.wallet.signMessage({ account: this.o.wallet.account!, message: receiptText(body) });
    return { ...body, status: rec.status, batch: rec.batch, payoutTx: rec.payoutTx, refundTx: rec.refundTx, hub: this.address, signature, nextSettleAt: this.nextSettleAt() };
  }

  private async claimOf(tx: Hex): Promise<string | null> {
    const t = await this.o.pub.getTransaction({ hash: tx });
    const n = parseHubNote(await this.priv.memo(tx, t.blockNumber!, this.address));
    return n?.claim ?? null;
  }

  status() {
    return {
      hub: this.address,
      everySec: this.o.everySec,
      coverMin: this.o.coverMin,
      queued: this.state.queued.length,
      settling: !!this.state.inflight,
      nextSettleAt: this.nextSettleAt(),
      lastBatchAt: this.state.lastBatchAt || null,
      lastError: this.state.lastError,
    };
  }
}

function shuffle<T>(a: T[]) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomBytes(4).readUInt32BE(0) % (i + 1);
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
}
