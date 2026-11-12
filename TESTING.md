# Testing

Four layers. None of them mocks a chain client or an RPC: unit tests run on Foundry's in-memory EVM, the privacy
suites run real Groth16 proofs against Ava Labs' production verifiers, the fork suite reads the real Chainlink feeds on
Fuji, and the live demo sends real Fuji transactions from the web app.

| Suite | Where it runs | Tests | Command |
|---|---|---|---|
| `NorenCreditTest` | Foundry, in-memory EVM | 28 (2 fuzz × 256 runs) | `pnpm test:contracts` |
| `NorenPrivacyTest` | Foundry, Ava Labs prod verifiers, SDK-made proofs | 9 | `pnpm test:contracts` |
| `NorenCreditForkTest` | Foundry, fork of Avalanche Fuji (real Chainlink feeds) | 4 | `NOREN_FORK=1 forge test --root contracts --match-contract Fork` |
| `privacy.test.ts` | Local Anvil (not a fork), full deployment, `@avalabs/eerc-sdk` proofs | 10 | `pnpm test:anvil` |
| Live demo | Avalanche Fuji, through the web app with the QA signer | 5 steps | `node scripts/qa/demo.mjs` |

Last run (Nov 12 2026): 37 passed in `forge test` (the 4 fork tests skip unless `NOREN_FORK=1`; with it, 4 more pass),
10 of 10 in the Anvil suite. The Anvil suite was run five times; one run had 2 failures that did not reproduce in
the next three runs, so treat it as possibly flaky (timing against a fresh Anvil) until it has been watched longer.
Each run re-records the fixtures with fresh proof randomness, and `forge test` passes with both the committed and a
freshly recorded fixture file.

## What each suite proves

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

**Fork (`contracts/test/NorenCreditFork.t.sol`)**: the feeds are Chainlink's (`BTC / USD`, `AVAX / USD`), the limit is
computed from the live BTC price, AVAX collateral is valued at the live AVAX price, and the real feed is refused once
`updatedAt + 25h` has passed.

**Anvil end to end (`scripts/anvil/privacy.test.ts`)**: deploys with the same Foundry script, registers three keys,
opens a shop, pays privately and checks that no calldata or log word contains the amount, decrypts it as the shop
(with the encrypted order note) and as the auditor (Poseidon decryption of the auditor PCT), shows the customer's key
gets noise from the auditor ciphertext, pays again on credit, rejects tampered / replayed / stolen proofs with
`eth_call`, withdraws as the shop, repays, and writes the Foundry fixtures (checking each scalar against the key
registered on chain).

## Live demo

`node scripts/qa/demo.mjs` drives the QA build (`pnpm build:qa`) in headless Chrome with the QA signer and writes each
step's transactions to `deployments/fuji.json` under `demo`. See the README for the hashes.

## Screenshots

`node scripts/qa/shots.mjs` captures every route at 1440 and 375 px into
`/Volumes/Extreme SSD/Projects/grokbot/orchestration/shots/avax-noren/` and checks horizontal overflow and console
errors (`report.json`). Copies used in this repo are in `docs/img/`.
