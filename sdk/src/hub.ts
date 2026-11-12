/// <reference path="./blake-hash.d.ts" />
// Noren's settlement hub, shared by the hub service, the web app and the tests.
//
// Customers pay the hub (an eERC account) instead of the shop, with a note encrypted to the hub that names the shop
// and the order. At intervals the hub pays every shop it owes, one private transfer per shop with the itemised
// statement as its encrypted note, plus zero-value cover transfers to other shops, and records the batch in
// NorenSettlement. Notes and statements use the eERC SDK's own metadata format (Poseidon encryption to a
// registered BabyJubJub key), so a shop's payout note decrypts with the same key that decrypts its balance.
import createBlakeHash from 'blake-hash/js.js';
import { keccak256, parseAbiItem, toBytes, type Address, type Hex, type PublicClient } from 'viem';
import { norenSettlementAbi, registrarAbi } from './abi.ts';
import type { Deployment } from './deployment.ts';
import { scanLogs } from './eerc.ts';

// ------------------------------------------------------------------ eERC key + metadata format

// Node has Buffer; the web app installs the `buffer` polyfill on globalThis (web/src/polyfills.ts).
type BufferLike = { from(v: string, enc: string): Uint8Array };
const Buf = () => (globalThis as unknown as { Buffer: BufferLike }).Buffer;
const utf8 = new TextEncoder();
const fromUtf8 = new TextDecoder();
const toHexStr = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
const fromHexStr = (h: string) => Uint8Array.from(h.match(/../g) ?? [], (x) => parseInt(x, 16));

const SUBORDER = 2736030358979909402780800718157159386076813972158567259200215660948447373041n;

/** The SDK's private-key formatting (blake512, prune, >> 3 mod the BabyJubJub subgroup order). */
export function formatKey(decryptionKey: string): bigint {
  const raw = createBlakeHash('blake512').update(Buf().from(decryptionKey.replace(/^0x/, ''), 'hex')).digest() as Uint8Array;
  const h = Uint8Array.from(raw.subarray(0, 32));
  h[0] = h[0]! & 248;
  h[31] = (h[31]! & 127) | 64;
  let le = 0n;
  for (let i = 31; i >= 0; i--) le = (le << 8n) | BigInt(h[i]!);
  return (le >> 3n) % SUBORDER;
}

type Point = [bigint, bigint] | bigint[];
export interface PoseidonLike {
  processPoseidonEncryption(p: { inputs: bigint[]; publicKey: Point }): Promise<{ cipher: bigint[]; nonce: bigint; authKey: Point }>;
  processPoseidonDecryption(p: { privateKey: bigint; authKey: Point; cipher: bigint[]; nonce: bigint; length: number }): bigint[];
}

const LIMB = 2n ** 250n;
const hex32 = (v: bigint) => v.toString(16).padStart(64, '0');

function textToLimbs(text: string): bigint[] {
  if (text === '') return [0n];
  const hex = toHexStr(utf8.encode(text));
  let v = BigInt(`0x${hex}`);
  const out: bigint[] = [];
  while (v > 0n) {
    out.push(v % LIMB);
    v /= LIMB;
  }
  return out.length ? out : [0n];
}

function limbsToText(limbs: bigint[]): string {
  if (limbs.length === 1 && limbs[0] === 0n) return '';
  let v = 0n;
  for (let i = limbs.length - 1; i >= 0; i--) v = v * LIMB + limbs[i]!;
  if (v === 0n) return '';
  let h = v.toString(16);
  if (h.length % 2) h = `0${h}`;
  return fromUtf8.decode(fromHexStr(h)).replace(/\u0000/g, '');
}

/** Encrypts `text` to a registered eERC public key, byte-for-byte in the eERC SDK's metadata format. */
export async function encryptNote(poseidon: PoseidonLike, publicKey: Point, text: string): Promise<Hex> {
  const limbs = textToLimbs(text);
  const { cipher, nonce, authKey } = await poseidon.processPoseidonEncryption({ inputs: limbs, publicKey });
  return `0x${[BigInt(limbs.length), nonce, authKey[0]!, authKey[1]!, ...cipher].map(hex32).join('')}`;
}

/** Decrypts a note made by `encryptNote` (or by the eERC SDK) with a formatted private key. Throws on a wrong key. */
export function decryptNote(poseidon: PoseidonLike, privateKey: bigint, note: Hex): string {
  const c = note.replace(/^0x/, '');
  const word = (i: number) => BigInt(`0x${c.slice(i * 64, i * 64 + 64)}`);
  const length = Number(word(0));
  const cipher: bigint[] = [];
  for (let i = 256; i < c.length; i += 64) cipher.push(BigInt(`0x${c.slice(i, i + 64)}`));
  return limbsToText(poseidon.processPoseidonDecryption({ privateKey, authKey: [word(2), word(3)], cipher, nonce: word(1), length }));
}

// ------------------------------------------------------------------ the customer's note to the hub

export interface HubNote {
  shopId: number;
  order: string;
  /** a per-payment secret the customer keeps; it proves the customer when asking the hub for a receipt */
  claim: string;
  item: string;
}

const NOTE_PREFIX = 'noren:1:';

export function hubNote(n: HubNote): string {
  return `${NOTE_PREFIX}${n.shopId}:${n.order}:${n.claim}:${n.item.slice(0, 64)}`;
}

export function parseHubNote(text: string | null | undefined): HubNote | null {
  if (!text?.startsWith(NOTE_PREFIX)) return null;
  const m = /^noren:1:(\d{1,6}):([A-Za-z0-9]{1,16}):([0-9a-f]{16,64}):(.*)$/s.exec(text);
  if (!m) return null;
  return { shopId: Number(m[1]), order: m[2]!, claim: m[3]!, item: m[4]!.slice(0, 64) };
}

// ------------------------------------------------------------------ statements

export interface StatementItem {
  tx: Hex; // the customer's eERC payment to the hub
  cents: string;
  order: string;
  item: string;
}

/** What one shop is paid in one batch. JSON-encoded with a random salt; its keccak256 is the on-chain digest. */
export interface ShopStatement {
  v: 1;
  batch: number;
  shop: number;
  salt: string;
  total: string;
  cover: boolean;
  items: StatementItem[];
}

export interface Refund {
  tx: Hex; // the payment being returned
  cents: string;
  to: Address;
  refundTx: Hex;
  reason: string;
}

/** The whole batch, for the eERC auditor. Each shop's statement is the exact JSON string the shop received. */
export interface AuditorStatement {
  v: 1;
  batch: number;
  salt: string;
  payouts: { shop: number; owner: Address; payoutTx: Hex; statement: string }[];
  refunds: Refund[];
}

export const statementDigest = (json: string): Hex => keccak256(toBytes(json));

export function parseStatement(json: string): ShopStatement | null {
  try {
    const s = JSON.parse(json) as ShopStatement;
    if (s?.v !== 1 || !Array.isArray(s.items) || typeof s.total !== 'string') return null;
    return s;
  } catch {
    return null;
  }
}

/** Checks one shop statement: the items add up to the total, and, when given, the total is what the shop decrypted. */
export function checkStatement(s: ShopStatement, decryptedPayout?: bigint | null): string[] {
  const bad: string[] = [];
  const sum = s.items.reduce((a, it) => a + BigInt(it.cents), 0n);
  if (sum !== BigInt(s.total)) bad.push(`items add up to ${sum}, statement says ${s.total}`);
  if (s.cover && s.items.length) bad.push('a cover payout lists items');
  if (decryptedPayout != null && decryptedPayout !== BigInt(s.total)) bad.push(`payout decrypts to ${decryptedPayout}, statement says ${s.total}`);
  return bad;
}

// ------------------------------------------------------------------ on-chain record

export const batchSettledEvent = parseAbiItem(
  'event BatchSettled(uint256 indexed batchId, uint64 at, bytes32[] payments, bytes32[] payoutTxs, bytes32[] refunds, bytes forAuditor)',
);
export const shopPayoutEvent = parseAbiItem(
  'event ShopPayout(uint256 indexed batchId, uint256 indexed shopId, bytes32 payoutTx, bytes32 digest, address accountant, bytes forAccountant)',
);
export const accountantSetEvent = parseAbiItem('event AccountantSet(uint256 indexed shopId, address indexed accountant)');

export interface HubDeployment extends Deployment {
  norenSettlement: Address;
  norenGasStation: Address;
  hub: Address;
  relayer: Address;
  hubDeployBlock: number;
}

export const hasHub = (d: Deployment): d is HubDeployment => !!(d as Partial<HubDeployment>).norenSettlement;

export interface BatchRecord {
  batchId: number;
  at: number;
  block: bigint;
  tx: Hex;
  payments: Hex[];
  payoutTxs: Hex[];
  refunds: Hex[];
  forAuditor: Hex;
}

export interface PayoutRecord {
  batchId: number;
  shopId: number;
  payoutTx: Hex;
  digest: Hex;
  accountant: Address;
  forAccountant: Hex;
  block: bigint;
}

export async function readBatches(pub: PublicClient, d: HubDeployment): Promise<BatchRecord[]> {
  const logs = await scanLogs(pub, { address: d.norenSettlement, event: batchSettledEvent, fromBlock: BigInt(d.hubDeployBlock) });
  return logs
    .map((l) => ({
      batchId: Number(l.args.batchId),
      at: Number(l.args.at),
      block: l.blockNumber!,
      tx: l.transactionHash!,
      payments: [...(l.args.payments as readonly Hex[])],
      payoutTxs: [...(l.args.payoutTxs as readonly Hex[])],
      refunds: [...(l.args.refunds as readonly Hex[])],
      forAuditor: l.args.forAuditor as Hex,
    }))
    .sort((a, b) => b.batchId - a.batchId);
}

export async function readPayouts(pub: PublicClient, d: HubDeployment, shopId?: number): Promise<PayoutRecord[]> {
  const logs = await scanLogs(pub, {
    address: d.norenSettlement,
    event: shopPayoutEvent,
    args: shopId == null ? undefined : { shopId: BigInt(shopId) },
    fromBlock: BigInt(d.hubDeployBlock),
  });
  return logs
    .map((l) => ({
      batchId: Number(l.args.batchId),
      shopId: Number(l.args.shopId),
      payoutTx: l.args.payoutTx as Hex,
      digest: l.args.digest as Hex,
      accountant: l.args.accountant as Address,
      forAccountant: l.args.forAccountant as Hex,
      block: l.blockNumber!,
    }))
    .sort((a, b) => b.batchId - a.batchId);
}

export async function accountantOf(pub: PublicClient, d: HubDeployment, shopId: number): Promise<Address> {
  return (await pub.readContract({ address: d.norenSettlement, abi: norenSettlementAbi, functionName: 'accountantOf', args: [BigInt(shopId)] })) as Address;
}

/** The batch a payment was settled in (null while it waits for the next batch). Read straight from the chain. */
export async function settledIn(pub: PublicClient, d: HubDeployment, paymentTx: Hex): Promise<number | null> {
  const v = (await pub.readContract({ address: d.norenSettlement, abi: norenSettlementAbi, functionName: 'settledIn', args: [paymentTx] })) as bigint;
  return v === 0n ? null : Number(v - 1n);
}

export async function publicKeyOf(pub: PublicClient, d: Deployment, user: Address): Promise<[bigint, bigint]> {
  const k = (await pub.readContract({ address: d.registrar, abi: registrarAbi, functionName: 'getUserPublicKey', args: [user] })) as readonly bigint[];
  return [k[0]!, k[1]!];
}

// ------------------------------------------------------------------ gas station request

/** What a new wallet signs (personal_sign of these 32 raw bytes) to ask NorenGasStation for its starter pack. */
export function gasDigest(chainId: number, station: Address, to: Address, deadline: bigint): Hex {
  const enc = (v: bigint) => v.toString(16).padStart(64, '0');
  const data = `0x${toHexStr(utf8.encode('Noren gas'))}${enc(BigInt(chainId))}${station.slice(2).toLowerCase()}${to.slice(2).toLowerCase()}${enc(deadline)}` as Hex;
  return keccak256(data);
}

/** The text a hub receipt signature covers (EIP-191, signed by the hub key named in NorenSettlement.hub()). */
export function receiptText(r: { tx: Hex; shopId: number; cents: string; order: string; chainId: number }): string {
  return `Noren receipt\nchain ${r.chainId}\npayment ${r.tx.toLowerCase()}\nshop ${r.shopId}\namount ${r.cents}\norder ${r.order}`;
}

/**
 * The eERC auditor's check of one batch: decrypt its auditor copy, then hold every line against the auditor
 * ciphertext of the transfer it names. `amountOf` returns what the auditor key decrypts for a transfer (or null).
 */
export function auditBatch(
  b: BatchRecord,
  aud: AuditorStatement,
  payouts: PayoutRecord[],
  amountOf: (tx: Hex) => bigint | null,
): { problems: string[]; paidIn: bigint; paidOut: bigint; shops: number; cover: number } {
  const problems: string[] = [];
  let paidIn = 0n;
  let paidOut = 0n;
  let cover = 0;
  const seen = new Map<string, number>();
  const low = (h: string) => h.toLowerCase();
  if (aud.batch !== b.batchId) problems.push(`statement is for batch ${aud.batch}`);
  for (const p of aud.payouts) {
    const st = parseStatement(p.statement);
    if (!st) {
      problems.push(`shop ${p.shop}: unreadable statement`);
      continue;
    }
    if (st.cover) cover++;
    const rec = payouts.find((x) => low(x.payoutTx) === low(p.payoutTx));
    if (!rec) problems.push(`shop ${p.shop}: payout not recorded in this batch`);
    else if (rec.digest !== statementDigest(p.statement)) problems.push(`shop ${p.shop}: statement digest differs from the chain`);
    const out = amountOf(p.payoutTx);
    if (out == null) problems.push(`shop ${p.shop}: payout amount unreadable`);
    else {
      paidOut += out;
      problems.push(...checkStatement(st, out).map((m) => `shop ${p.shop}: ${m}`));
    }
    for (const it of st.items) {
      seen.set(low(it.tx), (seen.get(low(it.tx)) ?? 0) + 1);
      const a = amountOf(it.tx);
      if (a !== BigInt(it.cents)) problems.push(`payment ${it.tx.slice(0, 10)}…: statement says ${it.cents}, ciphertext ${a ?? 'unreadable'}`);
    }
  }
  for (const r of aud.refunds) {
    seen.set(low(r.tx), (seen.get(low(r.tx)) ?? 0) + 1);
    const a = amountOf(r.tx);
    const back = amountOf(r.refundTx);
    if (a == null || a !== back) problems.push(`refund ${r.refundTx.slice(0, 10)}…: returns ${back ?? '?'} of ${a ?? '?'}`);
    if (back != null) paidOut += back;
  }
  for (const tx of b.payments) {
    const a = amountOf(tx);
    if (a == null) problems.push(`payment ${tx.slice(0, 10)}…: unreadable`);
    else paidIn += a;
    const n = seen.get(low(tx)) ?? 0;
    // A zero transfer with no note needs no line; anything else must appear exactly once.
    if (n !== 1 && !(n === 0 && a === 0n)) problems.push(`payment ${tx.slice(0, 10)}… appears ${n} times`);
  }
  for (const tx of seen.keys()) if (!b.payments.some((p) => low(p) === tx)) problems.push(`line ${tx.slice(0, 10)}… is not a payment of this batch`);
  if (paidIn !== paidOut) problems.push(`paid in ${paidIn}, paid out ${paidOut}`);
  return { problems, paidIn, paidOut, shops: aud.payouts.length, cover };
}
