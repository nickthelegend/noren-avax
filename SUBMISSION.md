# Submission: Noren on Avalanche

Event: Team1 India, "Build Anything on Avalanche" (deadline Nov 14 2026, 22:59 UTC).

**Name:** Noren

**One-liner:** Stablecoins, stocks or credit — privately. Pay a shop with your stocks, or get credit against them,
and the shop never learns who paid.

## Description

Pay a shop in crypto and it sees your whole wallet: your balance, your salary, every payment you've made. And if your
money is in stocks, you have to sell them first. Noren fixes both.

**Why Avalanche:** the NYSE plans to settle tokenized stocks on Avalanche, for its planned 24/7 tokenized securities
venue (announced Nov 9 2026, subject to regulatory approval; The Block, CoinDesk). Noren is where those shares meet a
checkout. This build runs on Avalanche Fuji with five test stocks priced from real quotes.

At any Noren checkout a customer can:
- **Pay with stocks**: test stock (tNVDA, tTSLA, tAAPL, tMSFT, tSPY) is sold to `NorenStockDesk` at a signed market price
  into the customer's encrypted eERC balance, and paid on privately.
- **Pay in 3 / pay later against stocks**: the stock is locked in `NorenStockCredit`; the limit is its value × an LTV
  that starts at 60% and rises 5 points with every installment repaid on time (max 75%); a plan draws a round lot from
  the Earn pool (1% fee, no interest) into the encrypted balance and the shop is paid in full, privately.
- **Pay privately** from an encrypted tUSDC balance, or **pay with tUSDC** (public).

The first three end in an Ava Labs eERC transfer to **Noren's settlement hub**: the amount is a ciphertext proven by a
Groth16 proof made in the customer's browser, and the shop and order travel in a note encrypted to the hub. Every
3 minutes the hub pays each shop it owes in one encrypted transfer whose note is the itemised statement, adds
zero-value covers so at least three shops are paid, and records the batch on `NorenSettlement`. The shop sees
"Customer: Private"; Snowtrace sees "customer paid Noren" and "Noren paid these shops", amounts encrypted.

Chainlink has no equity feeds on Fuji, so `NorenStockOracle` takes signed reports from Noren's price relayer (Yahoo
Finance quotes): signature, chain, contract, order and an one-hour age limit are checked on chain, and anyone can
submit the latest signed report.

Three surfaces, the same as Noren at ETHGlobal: **Noren Merchant** (SIWE sign-in, store opened on Avalanche with an
eERC key, payment links, API keys, events, payouts and statements decrypted in the browser and checked against the
chain, an accountant, a Claude assistant over the decrypted books), the **hosted checkout** (four ways to pay, stocks
first), and the **Noren app** (Home, Pay, Earn, Credit, Borrow, Swap). **Aubelle**, a demo boutique, takes Noren with one
server file. A judge needs nothing installed: "Use a test wallet" makes a Fuji key in the browser, NorenGasStation
funds it (gas, tUSDC, tWBTC) and NorenStockStarter gives it test stocks.

## Tech stack (Avalanche parts in bold)

- **Avalanche Fuji C-Chain** (43113): every contract, verified on Snowtrace.
- **Ava Labs EncryptedERC (eERC)**, converter mode, vendored unmodified at `8dc98cd`, Registrar and production Groth16
  verifiers; **`@avalabs/eerc-sdk` 1.0.2** for proofs and decryption in the browser and in Node.
- **Chainlink Data Feeds on Fuji** (BTC / USD, AVAX / USD for crypto credit; EUR / USD in the demo shop).
- Contracts (Solidity 0.8.27, Foundry): NorenStockOracle, NorenStockDesk, NorenStockCredit, NorenStockStarter,
  NorenSettlement, NorenMerchants, NorenCredit, NorenGasStation.
- Noren API on a VPS (Node, Docker): settlement hub, gas relay, merchant API (SIWE, stores, hashed secret keys,
  invoices with paid detection from decrypted hub notes), stock price relayer, Claude assistant proxy.
- React + Vite web app (the ETHGlobal Noren UI), Aubelle (Vite + a Vercel function); Playwright for QA.

Not used: ICM / ICTT, a custom L1, mainnet. Not on Avalanche (removed from the ETHGlobal edition, not claimed): Arc,
Robinhood Chain, Circle CCTP, Chainlink CCIP / CRE, 1inch Aqua, Uniswap, World ID, Reclaim, 0G.

## Links

- Landing + Noren app: https://noren-avax.vercel.app (app at `#/app`)
- Noren Merchant + hosted checkout: https://noren-avax-merchant.vercel.app
- Aubelle (demo shop): https://noren-avax-shop.vercel.app
- Noren API: https://noren-avax-api.201-18-198-162.sslip.io/api/health
- Repo: (to be pushed by Nick)
- Demo video (2:43.8, v20, independent judge 9.1/10; recorded live on the hosted sites and Fuji): 
  `grokbot/videos/noren-avax/noren-avax-film.mp4` (1080p) and `noren-avax-film-share.mp4` (9.2 MB); versions in
  `videos/noren-avax/versions/` (v12–v20 = this edition; v1–v11 = the earlier NEAR-UI cuts). Upload link: (to be
  added by Nick)
- Slides: `docs/SLIDES.md`
- Contracts and live transactions: README ("Stocks on Fuji", "Live on Avalanche Fuji") and `deployments/fuji.json`.

## Prior work

This is the Avalanche edition of **Noren, submitted at ETHGlobal** (https://ethglobal.com/showcase/noren-bh8wb; it ran on
Arc). The product, the UI (landing, Noren Merchant, hosted checkout, Noren app), the art and the Aubelle shop come from
that build and are used as is. Written for Avalanche: the stock contracts, NorenSettlement, NorenMerchants,
NorenCredit, NorenGasStation, the eERC integration and SDK, the hub, merchant API and price relayer, every data path in
the web app, the tests and the Fuji deployment. Details in the README's "Prior work" section.

## AI tools used

- **Claude Code** (Claude): contracts, tests, SDK, API, web app port, scripts, docs, QA, film.
- **Claude API** (`claude-haiku-5-5`): the merchant assistant.
- **ChatGPT** (images) and **Google Gemini Veo** (the landing's ambient film): art from Noren at ETHGlobal.
