# Noren on Avalanche: win gap (honest, after the Nov 13 ETHGlobal-edition round)

Rubric: works 30, idea 25, depth 20, Avalanche fit 15, demo 10.

## ETHGlobal-edition round (Nov 13, latest)

Nick: Noren on Avalanche must be the Noren submitted at ETHGlobal, same product, UI and film, stocks first. Done:
- The ETHGlobal UI as is (landing, Noren Merchant, hosted checkout, Noren app, Aubelle), every data path on Fuji.
- Stocks: NorenStockOracle (signed Yahoo Finance quotes; Chainlink has no equity feeds on Fuji), NorenStockDesk (pay
  with stocks, swap), NorenStockCredit (credit against stocks, pay in 3 / pay later, LTV that rises with on-time
  installments, Earn pool, liquidation), NorenStockStarter; 30 new Foundry tests; deployed and verified.
- Merchant API (SIWE, stores bound to on-chain shops, hashed keys, invoices marked paid by the hub from its decrypted
  notes) and the price relayer, live on the VPS; 9 Anvil tests.
- Hosted runs: Aubelle paid with stocks through the hosted checkout; pay in 3 from the app; repay → LTV 60 → 65%.

Honest re-score (before the film): works 8.8 (four hosted flows run from a fresh wallet; the hub adds up to ~45 s before
a payment shows as paid), idea 8.5 (stocks as payment and as collateral on the chain the NYSE plans to settle on),
depth 8.5 (eERC + hub + signed oracle + credit with a ladder and a pool), Avalanche fit 9.0 (eERC at the core; NYSE
link), demo pending the new film. What still blocks a 9: test stocks priced by one signer (no equity feed on Fuji),
the trusted hub, and the film.


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

## NEAR-UI round (Nov 13)

Nick: "Noren should have the same exact UI we have for NEAR." The web app now runs on Noren on NEAR's approved UI:
its stylesheets copied verbatim, its components, navy 3D kit, mark and fonts, with only the chain layer and labels
swapped (Avalanche, Snowtrace, test wallet / Core / MetaMask). Credit · Pay anyone · Debt-free carry the customer
flows; Merchant · Accountant · Auditor sit in a second pill group built from the same cards. Every Avalanche feature
still runs on Fuji (starter pack, eERC proofs in the browser, hub batches and signed receipts, Chainlink credit,
merchant books and assistant, accountant statements, auditor checks). Every route at 1440 and 375 laid side by side
with the NEAR screens (`docs/SCREEN-AUDIT.md`), 0 overflow, 0 console errors, redeployed and re-checked on the hosted
site. The film was re-recorded live on the new UI (v1 kept).

Re-score: Demo & communication moves with the film (below); the product scores are unchanged. One product, one look
across both chains, which is what Nick asked for; Avalanche fit is unchanged (the UI is the NEAR one by design,
disclosed under Prior work).

## Honest score

| Criterion | Weight | Score | Why |
|---|---|---|---|
| Does it work | 30 | 8.9 | Every flow runs on Fuji from the hosted site with zero setup; contracts verified; hub live on the VPS with crash recovery. Proofs take a few seconds in the browser, and a batch waits up to 3 minutes. |
| Idea & originality | 25 | 8.2 | A private checkout that hides amounts and the customer-shop link, with credit against BTC/AVAX in the same click. The hub is a known pattern (a processor/mixer-style batcher) applied cleanly to eERC. |
| Technical depth | 20 | 8.6 | eERC converter mode with the production verifiers, notes in eERC's metadata format, statement digests on chain, an auditor batch check that holds every line against ciphertexts, zero-value cover transfers, 77 Foundry + 22 Anvil tests with real proofs. |
| Avalanche fit | 15 | 8.0 | eERC is the core of the product; Chainlink Fuji feeds; native AVAX collateral and gas. No ICM/ICTT, no own L1, not mainnet. |
| Demo & communication | 10 | 8.0 | A 2:48 film (v6) recorded live in one take on the hosted site and Fuji (starter pack, private payment, payment on credit, the hub's batch, repay; Snowtrace for the payment, the batch, a payout and the repay; music bed; merchant, accountant and auditor views), on the approved Noren UI. Independent film judge (v2–v6): 7.5 film / 8 for this criterion; v6's claims all verified on chain, what blocks more is presentation (captions over rows, small text, covers not pointed at). |
| **Weighted** | | **≈ 8.44** | 2.67 + 2.05 + 1.72 + 1.20 + 0.80 |

## What still separates it from a 9

1. **Upload the film** (recorded, `videos/noren-avax/noren-avax-film.mp4`): only Nick can upload it.
2. **Anonymity set on a quiet testnet.** A batch with one customer and three shops (two of them cover) is the whole
   set. It grows with traffic and with more shops; a longer window would help but slows the demo.
3. **The hub is a single trusted operator** (sees every payment, holds money for one batch, can stall). Shops, the
   accountant, the auditor and customers can each detect misbehaviour; nothing forces liveness.
4. **Deposits and withdrawals stay public** (eERC converter mode). The checkout tops up in round 50s to blur prices.
5. **No ICM/ICTT** (accepting USDC from another L1) and no mainnet.
6. ~~Payout statements not padded~~ and ~~credit tops up the exact price~~: both fixed Nov 13 (hub redeployed with
   padded statements; credit in round lots of 50), verified on Fuji in batch #9 (three payouts of 3,428 bytes each;
   borrow 50.00 and top-up 50.00 for a 36.00 apron).

## Only Nick can do

- Upload the demo video (recorded); push the repo; submit the Speedrun form (closes Nov 14 22:59 UTC).
