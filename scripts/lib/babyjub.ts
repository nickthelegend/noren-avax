// The eERC SDK's private-key formatting (blake512, prune, >> 3 mod the BabyJubJub subgroup order), used by
// tests to hand Foundry the scalar it needs for an on-chain ElGamal decryption check.
import createBlakeHash from 'blake-hash';

const SUBORDER = 2736030358979909402780800718157159386076813972158567259200215660948447373041n;

export function formatKey(decryptionKey: string): bigint {
  const h = Buffer.from(createBlakeHash('blake512').update(Buffer.from(decryptionKey.replace(/^0x/, ''), 'hex')).digest().subarray(0, 32));
  h[0] = h[0]! & 248;
  h[31] = (h[31]! & 127) | 64;
  const le = BigInt(`0x${Buffer.from(h).reverse().toString('hex')}`);
  return (le >> 3n) % SUBORDER;
}
