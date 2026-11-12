# Noren on Avalanche: win gap (honest, after the Nov 12 settlement-hub round)

Rubric: works 30, idea 25, depth 20, Avalanche fit 15, demo 10.

## What closed this round

| Gap (before) | Now |
|---|---|
| Who paid whom was public: an eERC transfer shows both addresses | Customers pay Noren's settlement hub; the hub pays shops in 3-minute batches with zero-value cover payouts (≥3 shops per batch); `NorenSettlement` records every batch. Snowtrace sees "paid Noren" and "Noren paid these shops". README says exactly what is hidden and the trust the hub adds. |
| The hosted site needed a funded wallet | **Connect wallet → Test wallet**, then the first payment starts with NorenGasStation's one-tx starter pack (gas, 100 tUSDC, 0.01 tWBTC). Run on the hosted production site by a fresh browser (`scripts/qa/judge.mjs`, README "Judge path"). |
| One auditor key for every shop | Per-shop accountants: a shop names any eERC-registered address in `NorenSettlement`; every payout statement is encrypted to it and its hash is on chain. It is a statement copy, not a second eERC auditor (unmodified eERC proves the auditor ciphertext against one key per contract); README says so. |
| Flaky Anvil test (2 failures in 1 of 5 runs) | Root cause: `scanLogs` ended at viem's cached block number (~4 s), missing the block just mined. Fixed with `cacheTime: 0`; each suite now gets a fresh Anvil on an OS-picked port. 5 of 5 runs green for both suites. |
| No AI | Merchant assistant on `claude-haiku-5-5`: tools run in the browser over the locally decrypted books; the chat shows each tool call. |

## Ship round (Nov 12, evening)

Screen audit of every route and state at 1440 and 375 (`docs/SCREEN-AUDIT.md`). Fixed: decrypted amounts were
off-screen on phones in the merchant, auditor and accountant tables; the credit page had no way to get gas for a fresh
test wallet; the unknown-shop and 404 states were bare; the landing's first screen was jargon. Redeployed; the hosted
site passes 22 of 22 state shots with 0 console errors and no overflow. No new art, no restyle.

Re-score: *Does it work* 8.8 → 8.9 (phones now show the numbers the product is about; credit is zero-setup too).
Everything else unchanged; weighted stays **≈ 8.3** (8.29). The video is still the biggest gap.

## Honest score

| Criterion | Weight | Score | Why |
|---|---|---|---|
| Does it work | 30 | 8.9 | Every flow runs on Fuji from the hosted site with zero setup; contracts verified; hub live on the VPS with crash recovery. Proofs take a few seconds in the browser, and a batch waits up to 3 minutes. |
| Idea & originality | 25 | 8.2 | A private checkout that hides amounts and the customer-shop link, with credit against BTC/AVAX in the same click. The hub is a known pattern (a processor/mixer-style batcher) applied cleanly to eERC. |
| Technical depth | 20 | 8.6 | eERC converter mode with the production verifiers, notes in eERC's metadata format, statement digests on chain, an auditor batch check that holds every line against ciphertexts, zero-value cover transfers, 77 Foundry + 22 Anvil tests with real proofs. |
| Avalanche fit | 15 | 8.0 | eERC is the core of the product; Chainlink Fuji feeds; native AVAX collateral and gas. No ICM/ICTT, no own L1, not mainnet. |
| Demo & communication | 10 | 6.5 | README, slides outline and screenshots are complete; **the ≤3 min video is not recorded yet**. |
| **Weighted** | | **≈ 8.3** | |

## What still separates it from a 9

1. **The video** (10% of the score): record the judge path on the hosted site, leading with the problem ("anyone can
   see where you shop and how much a shop makes") and the Snowtrace view of a hub batch. Only Nick can upload it.
2. **Anonymity set on a quiet testnet.** A batch with one customer and three shops (two of them cover) is the whole
   set. It grows with traffic and with more shops; a longer window would help but slows the demo.
3. **The hub is a single trusted operator** (sees every payment, holds money for one batch, can stall). Shops, the
   accountant, the auditor and customers can each detect misbehaviour; nothing forces liveness.
4. **Deposits and withdrawals stay public** (eERC converter mode). The checkout tops up in round 50s to blur prices.
5. **No ICM/ICTT** (accepting USDC from another L1) and no mainnet.

## Only Nick can do

- Record and upload the demo video; push the repo; submit the Speedrun form (closes Nov 14 22:59 UTC).
