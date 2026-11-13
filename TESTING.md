# Testing

Five layers. None of them mocks a chain client or an RPC: unit tests run on Foundry's in-memory EVM, the privacy
suites run real Groth16 proofs against Ava Labs' production verifiers, the fork suite reads the real Chainlink feeds on
Fuji, and the live demo sends real Fuji transactions from the web app.

| Suite | Where it runs | Tests | Command |
|---|---|---|---|
| `NorenCreditTest` | Foundry, in-memory EVM | 28 (2 fuzz × 256 runs) | `pnpm test:contracts` |
| `NorenPrivacyTest` | Foundry, Ava Labs prod verifiers, SDK-made proofs | 9 | `pnpm test:contracts` |
| `NorenCreditForkTest` | Foundry, fork of Avalanche Fuji (real Chainlink feeds) | 4 | `NOREN_FORK=1 forge test --root contracts --match-contract Fork` |
| `NorenSettlementTest` | Foundry, Ava Labs Registrar + prod registration verifier, SDK-made registrations | 16 (1 fuzz) | `pnpm test:contracts` |
| `NorenGasStationTest` | Foundry, in-memory EVM | 24 (1 fuzz) | `pnpm test:contracts` |
| `NorenStocksTest` | Foundry, in-memory EVM | 30 | `pnpm test:contracts` |
| `privacy.test.ts` | Local Anvil (not a fork), full deployment, `@avalabs/eerc-sdk` proofs | 10 | `pnpm test:anvil` |
| `hub.test.ts` | Local Anvil, Deploy + DeployHub, real proofs, the hub service's own code (`hub/src`) | 12 | `node --test --test-force-exit scripts/anvil/hub.test.ts` |
| `merchant.test.ts` | Local Anvil, real eERC payments, the API's merchant and price-relayer code | 9 | `node --test --test-force-exit scripts/anvil/merchant.test.ts` |
| Hosted runs (Nov 13) | Avalanche Fuji, the hosted UI, fresh test wallets: pay with stocks (Aubelle → hosted checkout), pay in 3 against stocks (Noren app), repay an installment, merchant store + link + payment | 4 flows | by hand in a browser; `scripts/qa/eth-shots.mjs` for screenshots |
| Screens | Every route of the ETHGlobal UI at 1440 and 375, overflow and console errors | 12 routes × 2 | `node scripts/qa/eth-shots.mjs` |
| Judge path | Avalanche Fuji, the hosted production site, a fresh browser and test wallet (no QA signer, no local keys) | 1 run, every step | `node scripts/qa/judge.mjs` |
| Live demo | Avalanche Fuji, through the web app with the QA signer | 5 steps | `node scripts/qa/demo.mjs` |
| Screen states | Production build (or the hosted site with `NOREN_URL`), no keys: every route signed out, a fresh test wallet, wallet menu, unknown shop, 404 | 11 states × 2 widths | `node scripts/qa/states.mjs` |

Last run (Nov 12 2026, settlement-hub round): 77 passed in `forge test` (the 4 fork tests skip unless
`NOREN_FORK=1`), 10 of 10 in `privacy.test.ts` and 12 of 12 in `hub.test.ts`, **each Anvil suite five times in a row,
all green** (logs summarised below). Each privacy run re-records the fixtures with fresh proof randomness, and
`forge test` passes with the newly recorded file.

**The flaky Anvil test, found and fixed.** Five back-to-back runs of the old suite reproduced it twice: "the shop
withdraws…" failed because the auditor's ledger did not contain the withdrawal just sent. `scanLogs` ended its block
window at `pub.getBlockNumber()`, and viem caches the block number for about 4 seconds (`cacheTime`, the polling
interval), so a scan right after a transaction could stop one block short. It now reads the head with
`cacheTime: 0` (the hub's scanner too). The suites also start their own Anvil on a port the OS picks and refuse a
chain that isn't at block 0, so a run can no longer talk to a previous run's Anvil that is still shutting down.

| Run | privacy.test.ts | hub.test.ts |
|---|---|---|
| 1 | 10 / 10 | 12 / 12 |
| 2 | 10 / 10 | 12 / 12 |
| 3 | 10 / 10 | 12 / 12 |
| 4 | 10 / 10 | 12 / 12 |
| 5 | 10 / 10 | 12 / 12 |

Nov 13 (stocks round): `forge test` 107 passed (4 fork tests skip without `NOREN_FORK=1`), `merchant.test.ts` 9 of 9,
`hub.test.ts` 12 of 12. Screens: every route at 1440 and 375 with 0 px horizontal overflow and 0 console errors
(`orchestration/shots/avax-noren/eth-ui/report.json`).

## What each suite proves

**Stocks (`contracts/test/NorenStocks.t.sol`)**
- Oracle: a signed report is stored; refused with a wrong signer, a tampered price, a replayed or older report, a report
  from the future, a report signed for another oracle, an unlisted token; reads refuse a report over an hour old.
- Desk: sells at the price minus 0.5%, `quoteSellIn` covers an exact amount, slippage and stale prices are refused,
  buys at the price plus 0.5%.
- Credit: the limit is 60% of the stock's value; pay in 3 with on-time installments raises the LTV 5 points each up to
  75%; a late installment counts as late and doesn't raise it; over-limit, stale-price and bad-plan draws are refused;
  pay later is one payment in 30 days; collateral can't leave while it backs debt and can when there is none;
  liquidation only below 85% of value, with the 5% bonus and the 50% close factor.
- Earn pool: repaid fees raise the share value; a second supplier gets fair shares; withdrawals wait for cash that
  isn't lent out. Starter pack: once per address.

**Credit (`contracts/test/NorenCredit.t.sol`)**
- Borrow within the limit, borrow straight to a shop (`borrow(amount, shop)`), borrow over the limit, without
  collateral, beyond pool liquidity; AVAX and tWBTC collateral and both together.
- Repay partially, in full (`type(uint256).max`), for someone else, with no debt (reverts); 6% APR accrues to exactly
  1.06× over a year.
- Liquidation once health < 1 (exact seized amount at the oracle price plus the 5% bonus), refused while healthy,
  the 50% close factor, capping at the collateral actually held, no self-liquidation of a healthy position.
- Oracle safety: a feed older than its max age is refused for borrow, withdraw, liquidate and every read; zero and
  negative prices are refused; a future `updatedAt` is refused; a fresh update makes it usable again.
- Attacks and admin: re-entering `borrow` from the AVAX withdrawal callback is blocked; only the owner lists assets and
  sets the rate; unsafe listings (LTV ≥ threshold, threshold × (1 + bonus) > 1, no staleness bound) are rejected.
- Fuzz: no borrow ever opens a liquidatable position; repaying what `debtOf` reports always clears it.

**Privacy (`contracts/test/NorenPrivacy.t.sol`)**, replaying the proofs that the official SDK produced in the Anvil
suite (`contracts/test/fixtures/eerc-anvil.json`; eERC deposits encrypt with fixed randomness, so the same sequence
rebuilds the exact ciphertexts the proofs were made against):
- Registration proofs bind the sender (someone else submitting it fails) and can't be replayed.
- A shop can only open after its owner registers an eERC key; slugs are unique and validated; only the owner lists.
- **Pay:** no ERC-20 moves and the contract's public tUSDC is unchanged; the plaintext amount (2400 cents / 24e6) is in
  no log word; the merchant's stored balance is a ciphertext that **ElGamal-decrypts on chain to exactly 2400 with the
  merchant's scalar** and not with the customer's or the auditor's.
- The `PrivateTransfer` event carries the auditor ciphertext, addressed to the auditor.
- A tampered proof (one bit of the receiver ciphertext) is rejected; a stolen proof (sent by another address) and a
  replayed proof are rejected; a payment re-pointed at an unregistered address is rejected.
- **Borrow and pay:** lock tWBTC, borrow 36 tUSDC, shield, pay privately; the merchant decrypts 60.00 in total; the
  merchant withdraws 60 tUSDC publicly; the customer repays in full. The merchant's withdraw proof is useless to anyone
  else.

**Settlement record (`contracts/test/NorenSettlement.t.sol`)**, with the real Registrar and SDK-made registrations:
- Only the hub settles; only the owner rotates the hub, and only to a key registered with eERC (customers must be able
  to pay it); the old hub loses access.
- A payment settles at most once, across batches and within one batch; a payout tx can't be reused (also not as a
  refund); one payout per shop per batch; unknown shops, empty batches, zero hashes and more than 32 payouts are refused.
- Only a shop's owner names its accountant; the accountant must have an eERC key; once named, every payout to that shop
  must carry the accountant's statement; it can be removed. Events carry the digest, the accountant and the blob.
- Fuzz: settled payments stay settled in the batch that settled them.

**Gas station (`contracts/test/NorenGasStation.t.sol`)**: KumiGasStation's 21 cases (forged, moved, cross-station,
malleated, short and expired signatures; once per wallet; wallets with AVAX and contracts refused; daily and
per-requester caps; empty station; owner-only config, withdraw and relayer rotation; fuzz over signer keys) plus the
token pack: a drip pays AVAX, 100 tUSDC and 0.01 tWBTC; a station without tokens fails loudly and pays nothing; a
gas-only pack works; the pack is spendable at once.

**Hub end to end (`scripts/anvil/hub.test.ts`)**, driving `hub/src/hub.ts` and `hub/src/gas.ts`:
- An empty wallet signs once and the relayer's `drip` gives it AVAX, 100 tUSDC and 0.01 tWBTC; asking twice, a
  signature from another key are refused before any gas is spent, and the per-requester count drops.
- The funded wallet registers and tops up; a shop names its accountant (an unregistered address is refused).
- The customer pays the hub twice for Harbor & Loom and once with no note: **every `PrivateTransfer` from the
  customer goes to the hub, none to a shop.**
- The hub queues them, won't settle before the clock boundary, signs a receipt only for the holder of the claim, and
  the receipt verifies against the hub address.
- One batch: Harbor & Loom gets 42.00, two other shops get zero (cover), the note-less 5.00 is refunded; three
  payouts, all from the hub, recorded with digests.
- The shop decrypts 42.00 and the statement, which adds up and matches the digest on chain; a cover payout decrypts to
  0 with a statement that says cover; tampered statements fail both checks.
- The accountant decrypts its copy (and no other key does); a shop without an accountant gets no copy.
- The auditor decrypts the batch and checks it against the auditor ciphertexts: every payment once, every payout equals
  its statement, paid in = paid out = 47.00; the hub's balance ends at zero.
- The hub can't settle a payment twice, even from a fresh process with empty state.
- A hub that crashes after its first payout finishes the batch on restart, pays nobody twice, and still answers the
  receipt as settled.

**Fork (`contracts/test/NorenCreditFork.t.sol`)**: the feeds are Chainlink's (`BTC / USD`, `AVAX / USD`), the limit is
computed from the live BTC price, AVAX collateral is valued at the live AVAX price, and the real feed is refused once
`updatedAt + 25h` has passed.

**Anvil end to end (`scripts/anvil/privacy.test.ts`)**: deploys with the same Foundry script, registers three keys,
opens a shop, pays privately and checks that no calldata or log word contains the amount, decrypts it as the shop
(with the encrypted order note) and as the auditor (Poseidon decryption of the auditor PCT), shows the customer's key
gets noise from the auditor ciphertext, pays again on credit, rejects tampered / replayed / stolen proofs with
`eth_call`, withdraws as the shop, repays, and writes the Foundry fixtures (checking each scalar against the key
registered on chain).

## Judge path on Fuji

`node scripts/qa/judge.mjs` opens the hosted production site (https://noren-avax.vercel.app) in a fresh headless Chrome
with no keys from this machine, picks **Test wallet**, pays Harbor & Loom (the plan starts with the starter pack), opens
a shop, names itself accountant, pays its own shop, waits for the hub's batch, reads the revenue and payout check,
asks the assistant and opens the statements. It writes every announced transaction to `deployments/fuji.json` under
`judge` (README, "Judge path") and saves screenshots to `orchestration/shots/avax-noren/9round/`.

Nov 12 run: 10 transactions, the batch settled about two minutes after the payment, the assistant answered from its
`revenue` tool, 0 console errors. The attempt before it stopped when headless Chrome's page crashed while proving the
first transfer (after the starter pack, registration and top-up had landed); the rerun with a new test wallet passed
every step. The Browser-pane runs of the same flow (two test wallets, pay with tUSDC and on credit) passed too.

## Live demo

`node scripts/qa/demo.mjs` drives the QA build (`pnpm build:qa`) in headless Chrome with the QA signer and writes each
step's transactions to `deployments/fuji.json` under `demo`. See the README for the hashes.

## Screenshots

`node scripts/qa/shots.mjs` captures every route at 1440 and 375 px into
`/Volumes/Extreme SSD/Projects/grokbot/orchestration/shots/avax-noren/` and checks horizontal overflow and console
errors (`report.json`). Copies used in this repo are in `docs/img/`.

Ship round (Nov 12, after the redeploy): `NOREN_URL=https://noren-avax.vercel.app node scripts/qa/states.mjs` → 22 of
22 shots with 0 console errors and 0 px overflow at 1440 and 375; `shots.mjs` (the signed-in roles) 14 of 14 the same.
Per-screen scores: `docs/SCREEN-AUDIT.md`.
