# Noren on Avalanche: slide outline

1. **Noren.** Stablecoins, stocks or credit — privately. Pay a shop with your stocks, or get credit against them, and
   the shop never learns who paid. (Noren's curtain mark; Avalanche Fuji.)
2. **The problem.** Pay a shop in crypto and it sees your whole wallet. And if your money is in stocks, you have to sell
   them before you can spend them.
3. **Why Avalanche, why now.** The NYSE plans to settle tokenized stocks on Avalanche, for its planned 24/7 tokenized
   securities venue (Nov 9 2026, subject to regulatory approval; The Block, CoinDesk). Shares on Avalanche need a
   checkout. Ava Labs' eERC makes that checkout private.
4. **Pay with stocks.** At the checkout, tNVDA is sold to NorenStockDesk at a signed market price into your encrypted
   balance and paid on privately. One tap from a fresh wallet: ≈35 s on Fuji. (Screenshot: hosted checkout, four ways.)
5. **Credit against stocks.** Lock shares, keep them. Limit = value × 60%, +5 points per on-time installment, up to 75%.
   Pay in 3 or pay later; 1% fee, no interest; the shop is paid in full. The Earn pool funds it and earns the fees.
6. **Private by default.** Every way but tUSDC ends in an eERC transfer to Noren's hub: amount encrypted, Groth16 proof
   made in the browser. The hub pays shops in batches with zero-value covers and records each batch on
   NorenSettlement. The shop sees "Customer: Private".
7. **The merchant's view.** Noren Merchant: store on Avalanche, payment links, API keys; payouts and statements
   decrypted in the browser and checked against the chain; an accountant; a Claude assistant over the books. Aubelle
   added Noren with one server file.
8. **Prices without a feed.** Chainlink has no equity feeds on Fuji. NorenStockOracle takes Yahoo Finance quotes signed
   by Noren's relayer; signature, chain, order and age are checked on chain; anyone can submit the latest report.
9. **Built and tested.** 107 Foundry tests (oracle attacks, liquidation, LTV ladder, Earn pool), Anvil suites with real
   eERC proofs, hosted runs with tx links. Live: noren-avax.vercel.app · noren-avax-merchant.vercel.app ·
   noren-avax-shop.vercel.app.
10. **Honest limits and next.** Test stocks, one price signer, a trusted hub for liveness; next: a real equity feed,
    tokenized shares as they arrive on Avalanche, mainnet.
