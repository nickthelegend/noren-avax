// Noren's private money rail: Ava Labs' eERC (converter mode over tUSDC) driven through the official
// @avalabs/eerc-sdk EERC class. Customers shield tUSDC into an encrypted balance and pay shops with
// private transfers; shops decrypt what they received with their own key; the auditor decrypts the
// auditor ciphertext every transfer carries. Amounts are in cents (eERC units, 2 decimals).
import { EERC } from '@avalabs/eerc-sdk/dist/index.js';
import {
  decodeFunctionData,
  erc20Abi,
  parseAbiItem,
  type AbiEvent,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
} from 'viem';
import { encryptedErcAbi, registrarAbi } from './abi.ts';
import { EERC_DECIMALS, type Deployment } from './deployment.ts';
import { decryptNote, formatKey } from './hub.ts';

export interface CircuitURLs {
  register: { wasm: string; zkey: string };
  transfer: { wasm: string; zkey: string };
  withdraw: { wasm: string; zkey: string };
  mint: { wasm: string; zkey: string };
  burn: { wasm: string; zkey: string };
}

export function circuitURLs(base: string): CircuitURLs {
  const b = base.replace(/\/$/, '');
  return {
    register: { wasm: `${b}/registration/registration.wasm`, zkey: `${b}/registration/circuit_final.zkey` },
    transfer: { wasm: `${b}/transfer/transfer.wasm`, zkey: `${b}/transfer/transfer.zkey` },
    withdraw: { wasm: `${b}/withdraw/withdraw.wasm`, zkey: `${b}/withdraw/circuit_final.zkey` },
    // Converter mode never mints or burns; the SDK still wants the slots filled.
    mint: { wasm: `${b}/mint/mint.wasm`, zkey: `${b}/mint/mint.zkey` },
    burn: { wasm: `${b}/burn/burn.wasm`, zkey: `${b}/burn/burn.zkey` },
  };
}

type BalanceTuple = readonly [
  { c1: { x: bigint; y: bigint }; c2: { x: bigint; y: bigint } },
  bigint,
  readonly { pct: readonly bigint[]; index: bigint }[],
  readonly bigint[],
  bigint,
];

export interface PrivateBalance {
  cents: bigint;
  /** ElGamal ciphertext as stored on chain: c1.x, c1.y, c2.x, c2.y */
  encrypted: bigint[];
}

export interface ReceivedPayment {
  tx: Hex;
  block: bigint;
  from: Address;
  cents: bigint | null;
  memo: string | null;
  error?: string;
}

export interface AuditEntry {
  tx: Hex;
  block: bigint;
  kind: 'Transfer' | 'Withdraw' | 'Deposit';
  from: Address;
  to: Address | null;
  cents: bigint | null;
  error?: string;
}

export const privateTransferEvent = parseAbiItem(
  'event PrivateTransfer(address indexed from, address indexed to, uint256[7] auditorPCT, address indexed auditorAddress)',
);
export const withdrawEvent = parseAbiItem(
  'event Withdraw(address indexed user, uint256 amount, uint256 tokenId, uint256[7] auditorPCT, address indexed auditorAddress)',
);
export const depositEvent = parseAbiItem('event Deposit(address indexed user, uint256 amount, uint256 dust, uint256 tokenId)');
export const privateMessageEvent = parseAbiItem(
  'event PrivateMessage(address indexed from, address indexed to, (address messageFrom, address messageTo, string messageType, bytes encryptedMsg) metadata)',
);

/** getLogs in block windows, because public Fuji RPCs cap the range per call. */
export async function scanLogs<E extends AbiEvent>(
  pub: PublicClient,
  q: { address: Address; event: E; args?: Record<string, unknown>; fromBlock: bigint; toBlock?: bigint; step?: bigint },
) {
  // cacheTime 0: viem caches the block number for ~4 s, so a scan right after a transaction could end a block short.
  const to = q.toBlock ?? (await pub.getBlockNumber({ cacheTime: 0 }));
  const step = q.step ?? 2_000n;
  const windows: [bigint, bigint][] = [];
  for (let a = q.fromBlock; a <= to; a += step) windows.push([a, a + step - 1n > to ? to : a + step - 1n]);
  const out = [];
  for (let i = 0; i < windows.length; i += 4) {
    const batch = await Promise.all(
      windows.slice(i, i + 4).map(([f, t]) =>
        pub.getLogs({ address: q.address, event: q.event, args: q.args as never, fromBlock: f, toBlock: t }),
      ),
    );
    for (const b of batch) out.push(...b);
  }
  return out;
}

export class NorenPrivate {
  readonly eerc: EERC;
  readonly me: Address;
  readonly pub: PublicClient;
  readonly wallet: WalletClient;
  readonly d: Deployment;

  constructor(pub: PublicClient, wallet: WalletClient, d: Deployment, circuits: CircuitURLs, decryptionKey?: string) {
    if (!wallet.account) throw new Error('The wallet has no account.');
    this.pub = pub;
    this.wallet = wallet;
    this.d = d;
    this.me = wallet.account.address;
    this.eerc = new EERC(pub as never, wallet as never, d.encryptedERC, d.registrar, true, circuits, decryptionKey);
  }

  /** Derives this wallet's eERC key from a signature (the SDK's scheme), unless one was passed in. */
  async unlock(): Promise<string> {
    if (this.eerc.isDecryptionKeySet) return '';
    return this.eerc.generateDecryptionKey();
  }

  get unlocked() {
    return this.eerc.isDecryptionKeySet;
  }

  async isRegistered(user: Address = this.me): Promise<boolean> {
    return (await this.pub.readContract({ address: this.d.registrar, abi: registrarAbi, functionName: 'isUserRegistered', args: [user] })) as boolean;
  }

  /** Registers the wallet's eERC public key (a Groth16 proof made on this device). Null when already registered. */
  async register(): Promise<Hex | null> {
    const r = await this.eerc.register();
    if (!r.transactionHash) return null;
    await this.wait(r.transactionHash as Hex);
    return r.transactionHash as Hex;
  }

  async auditorPublicKey(): Promise<bigint[]> {
    const p = (await this.pub.readContract({ address: this.d.encryptedERC, abi: encryptedErcAbi, functionName: 'auditorPublicKey' })) as readonly [bigint, bigint];
    return [p[0], p[1]];
  }

  async auditor(): Promise<Address> {
    return (await this.pub.readContract({ address: this.d.encryptedERC, abi: encryptedErcAbi, functionName: 'auditor' })) as Address;
  }

  /** The caller's private tUSDC balance, decrypted locally and checked against the on-chain ciphertext. */
  async balance(user: Address = this.me): Promise<PrivateBalance> {
    const r = (await this.pub.readContract({
      address: this.d.encryptedERC,
      abi: encryptedErcAbi,
      functionName: 'getBalanceFromTokenAddress',
      args: [user, this.d.tUSDC],
    })) as unknown as BalanceTuple;
    const encrypted = [r[0].c1.x, r[0].c1.y, r[0].c2.x, r[0].c2.y];
    if (encrypted.every((v) => v === 0n)) return { cents: 0n, encrypted };
    const cents = this.eerc.calculateTotalBalance(r[0] as never, r[2] as never, r[3] as never);
    if (cents < 0n) throw new Error('The private balance failed its consistency check (ciphertext and PCTs disagree).');
    return { cents, encrypted };
  }

  /** Approves (if needed) and deposits public tUSDC (6 decimals) into the private balance. */
  async shield(usdcAmount: bigint, memo?: string): Promise<{ approve: Hex | null; deposit: Hex }> {
    let approve: Hex | null = null;
    const allowance = await this.pub.readContract({ address: this.d.tUSDC, abi: erc20Abi, functionName: 'allowance', args: [this.me, this.d.encryptedERC] });
    if (allowance < usdcAmount) {
      approve = await this.wallet.writeContract({
        address: this.d.tUSDC,
        abi: erc20Abi,
        functionName: 'approve',
        args: [this.d.encryptedERC, 2n ** 255n],
        account: this.wallet.account!,
        chain: this.wallet.chain,
      });
      await this.wait(approve);
    }
    const r = await this.eerc.deposit(usdcAmount, this.d.tUSDC, EERC_DECIMALS, memo);
    await this.wait(r.transactionHash);
    return { approve, deposit: r.transactionHash };
  }

  /**
   * Private payment: the amount is a Groth16-proven ciphertext; the memo is encrypted to the payee.
   * A zero amount (the settlement hub's cover payouts) is valid for eERC's transfer circuit and contract; only the
   * SDK's client-side check refuses it, so that one check is relaxed for zero, just for this call.
   */
  async pay(to: Address, cents: bigint, memo?: string): Promise<Hex> {
    if (cents < 0n) throw new Error('A payment cannot be negative.');
    const bal = await this.balance();
    if (bal.cents < cents) throw new Error(`Private balance is ${bal.cents} cents; this payment needs ${cents}.`);
    const e = this.eerc as unknown as { validateAmount: (a: bigint, f?: bigint) => void };
    const own = Object.prototype.hasOwnProperty.call(e, 'validateAmount');
    if (cents === 0n)
      e.validateAmount = (a: bigint, f?: bigint) => {
        if (a < 0n || (f != null && a > f)) throw new Error('Invalid amount!');
      };
    try {
      const r = await this.eerc.transfer(to, cents, bal.encrypted, bal.cents, await this.auditorPublicKey(), this.d.tUSDC, memo);
      await this.wait(r.transactionHash);
      return r.transactionHash;
    } finally {
      if (cents === 0n && !own) delete (e as { validateAmount?: unknown }).validateAmount;
    }
  }

  /** The formatted BabyJubJub secret of this wallet's eERC key (for notes and statements). Needs unlock(). */
  secretKey(): bigint {
    const k = (this.eerc as unknown as { decryptionKey?: string }).decryptionKey;
    if (!k) throw new Error('Unlock the private balance first.');
    return formatKey(k);
  }

  /** Decrypts any note encrypted to this wallet's eERC key (payment memos, statements). */
  readNote(note: Hex): string {
    return decryptNote(this.eerc.poseidon as never, this.secretKey(), note);
  }

  /** Turns private cents back into public tUSDC in the caller's wallet. */
  async withdraw(cents: bigint, memo?: string): Promise<Hex> {
    const bal = await this.balance();
    if (bal.cents < cents) throw new Error(`Private balance is ${bal.cents} cents; withdrawing ${cents} is not possible.`);
    const r = await this.eerc.withdraw(cents, bal.encrypted, bal.cents, await this.auditorPublicKey(), this.d.tUSDC, memo);
    await this.wait(r.transactionHash);
    return r.transactionHash;
  }

  /** Payments received by `merchant`, each decrypted with this wallet's key from the proof's receiver PCT. */
  async received(merchant: Address = this.me, fromBlock = BigInt(this.d.deployBlock)): Promise<ReceivedPayment[]> {
    const logs = await scanLogs(this.pub, { address: this.d.encryptedERC, event: privateTransferEvent, args: { to: merchant }, fromBlock });
    const out: ReceivedPayment[] = [];
    for (const l of logs) {
      const tx = l.transactionHash as Hex;
      const p: ReceivedPayment = { tx, block: l.blockNumber!, from: l.args.from as Address, cents: null, memo: null };
      try {
        const t = await this.pub.getTransaction({ hash: tx });
        const call = decodeFunctionData({ abi: encryptedErcAbi, data: t.input });
        const proof = (call.args as unknown as unknown[])[2] as { publicSignals: readonly bigint[] };
        p.cents = this.eerc.decryptPCT(proof.publicSignals.slice(16, 23) as bigint[]);
        if ((call.args as unknown as unknown[]).length > 4) p.memo = await this.memo(tx, l.blockNumber!, merchant);
      } catch (e) {
        p.error = (e as Error).message;
      }
      out.push(p);
    }
    return out.sort((a, b) => Number(b.block - a.block));
  }

  /** The encrypted note an eERC transaction carried to `to`, decrypted with this wallet's key; null if it has none. */
  async memo(tx: Hex, block: bigint, to: Address = this.me): Promise<string | null> {
    const logs = await this.pub.getLogs({ address: this.d.encryptedERC, event: privateMessageEvent, args: { to }, fromBlock: block, toBlock: block });
    const mine = logs.find((l) => l.transactionHash === tx);
    if (!mine) return null;
    return this.readNote((mine.args.metadata as { encryptedMsg: Hex }).encryptedMsg);
  }

  /** Every transfer and withdrawal on the contract, decrypted with the auditor key (only works for the auditor). */
  async audit(fromBlock = BigInt(this.d.deployBlock)): Promise<AuditEntry[]> {
    const [transfers, withdrawals, deposits] = await Promise.all([
      scanLogs(this.pub, { address: this.d.encryptedERC, event: privateTransferEvent, args: { auditorAddress: this.me }, fromBlock }),
      scanLogs(this.pub, { address: this.d.encryptedERC, event: withdrawEvent, args: { auditorAddress: this.me }, fromBlock }),
      scanLogs(this.pub, { address: this.d.encryptedERC, event: depositEvent, fromBlock }),
    ]);
    const out: AuditEntry[] = [];
    const dec = (pct: readonly bigint[]) => {
      try {
        return { cents: this.eerc.decryptPCT([...pct]) };
      } catch (e) {
        return { cents: null, error: (e as Error).message };
      }
    };
    for (const l of transfers)
      out.push({ tx: l.transactionHash as Hex, block: l.blockNumber!, kind: 'Transfer', from: l.args.from as Address, to: l.args.to as Address, ...dec(l.args.auditorPCT as readonly bigint[]) });
    for (const l of withdrawals)
      out.push({ tx: l.transactionHash as Hex, block: l.blockNumber!, kind: 'Withdraw', from: l.args.user as Address, to: null, ...dec(l.args.auditorPCT as readonly bigint[]) });
    for (const l of deposits)
      out.push({ tx: l.transactionHash as Hex, block: l.blockNumber!, kind: 'Deposit', from: l.args.user as Address, to: null, cents: (l.args.amount as bigint) / 10_000n });
    return out.sort((a, b) => Number(b.block - a.block));
  }

  async wait(hash: Hex) {
    const r = await this.pub.waitForTransactionReceipt({ hash, pollingInterval: 500, timeout: 120_000 });
    if (r.status !== 'success') throw new Error(`Transaction reverted: ${hash}`);
    return r;
  }
}
