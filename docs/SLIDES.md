# Noren on Avalanche: slide outline (10 slides)

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
6. **Who paid whom stays private: the settlement hub.** Customers pay Noren's hub (order note encrypted to the hub);
   every 3 minutes the hub pays each shop it owes in one private transfer carrying its statement, plus zero-value
   cover payouts so at least 3 shops are paid; `NorenSettlement` records the batch (payments settled once, statement
   digests, accountant and auditor copies). Diagram: customers → hub → shops, Snowtrace sees only "paid Noren" and
   "Noren paid 3 shops". One line on trust: the hub sees everything and holds money for one batch; shops, accountants
   and the auditor can each check it.
7. **The same payment, three views.** Left: the Snowtrace event (from, to, ciphertext). Right: the merchant dashboard
   showing the decrypted amount and order note. Then the auditor ledger.
8. **Live on Fuji, zero setup.** A judge opens the site, picks Test wallet, and one tap of NorenGasStation funds it
   (gas, tUSDC, tWBTC). Pay → batch → merchant ✓ → accountant statements → "How much did I make this week?" answered
   by Claude from tools that run in the browser. Transactions: README "Judge path".
9. **Built, not scaffolded.** 77 Foundry tests (settlement record, gas station, credit, privacy replay), 22 Anvil
   end-to-end tests with real proofs (hub batch with cover and refund, crash recovery, no double settle), each run
   five times green. Earlier: 37 Foundry tests (credit, liquidation, stale oracle, reentrancy, fuzz; eERC proofs from
   the official SDK replayed against the prod verifiers with on-chain ElGamal decryption checks), 4 Fuji-fork tests on
   the real Chainlink feeds, 10 Anvil end-to-end tests with real proofs. All contracts verified on Snowtrace.
10. **What's next.** A larger anonymity set (more shops and longer windows), several independent hubs, per-group eERC
   deployments for cryptographic per-shop auditors, credit repaid from the private balance, ICTT to accept USDC from other Avalanche L1s (not built yet), mainnet once eERC audits allow. Tagline as
   the end card.
