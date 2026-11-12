# Noren on Avalanche: slide outline (9 slides)

1. **Title.** Noren. "Merchants let customers pay privately, with stablecoins or credit against their coins." Live on
   Avalanche Fuji. Stall object on the dark hero.
2. **The problem.** Pay a shop on a public chain and you publish its revenue: every competitor can total a store's
   sales from the explorer, and every customer's spend is on the record. So shops don't take crypto, and people holding
   BTC sell it to shop.
3. **What Noren does.** One checkout, two ways to pay: tUSDC from a private balance, or credit against BTC / AVAX. The
   shop reads its revenue; its accountant reads it with the auditor key; Snowtrace reads ciphertext. Screenshot: the
   checkout.
4. **Why Avalanche (eERC).** Ava Labs' EncryptedERC in converter mode over test USDC: balances and transfer amounts are
   ElGamal ciphertexts on BabyJubJub; every transfer is a Groth16 proof made in the browser and checked by the
   production verifiers; every transfer also carries a ciphertext for the auditor key. Diagram: customer → proof →
   eERC → shop key / auditor key.
5. **Credit against coins.** NorenCredit: lock tWBTC or AVAX, borrow tUSDC at Chainlink BTC / USD and AVAX / USD on
   Fuji (60% / 50% limits, liquidation below health 1 with a 5% / 8% bonus, 6% APR), refuse any price older than 25 h.
   Borrow → shield → private pay is one click in the checkout. Screenshot: the credit card and health bar.
6. **The same payment, two views.** Left: the Snowtrace event (from, to, ciphertext). Right: the merchant dashboard
   showing the decrypted amount and order note. Then the auditor ledger.
7. **Live demo on Fuji.** The five steps and their transactions (README table): pay privately, pay on credit, merchant
   decrypts and withdraws, auditor decrypts, customer repays.
8. **Built, not scaffolded.** 37 Foundry tests (credit, liquidation, stale oracle, reentrancy, fuzz; eERC proofs from
   the official SDK replayed against the prod verifiers with on-chain ElGamal decryption checks), 4 Fuji-fork tests on
   the real Chainlink feeds, 10 Anvil end-to-end tests with real proofs. All contracts verified on Snowtrace.
9. **What's next.** Per-shop auditor keys (one eERC deployment per merchant group), credit repaid from the private
   balance, ICTT to accept USDC from other Avalanche L1s (not built yet), mainnet once eERC audits allow. Tagline as
   the end card.
