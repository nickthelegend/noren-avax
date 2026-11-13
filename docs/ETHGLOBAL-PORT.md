# Noren Avalanche edition = the ETHGlobal Noren on Fuji (Nov 13)

Nick: Noren on Avalanche must be the product submitted at ETHGlobal (showcase noren-bh8wb): same product, same UI,
same film. Stocks first ("pay with stocks or get credit against stocks"), private by default. One chain: Fuji.

Reference code (read-only): `grokbot/projects/_wt/noren-final3` (branch release3): `packages/web` (landing, Noren
Merchant = `Dashboard.tsx`, hosted checkout = `Checkout.tsx`, Noren app = `app/*`), `examples/shop` (Aubelle).

## What changes, what stays

| ETHGlobal (Arc) | Avalanche edition (Fuji) |
|---|---|
| Kohaku privacy pool on Arc | Ava Labs eERC (EncryptedERC, converter mode, browser Groth16 proofs) + Noren's settlement hub (batches, cover payouts) |
| Robinhood Chain Stock Tokens + Chainlink equity feeds | five test stock tokens (tNVDA tTSLA tAAPL tMSFT tSPY) priced by `NorenStockOracle`: Noren's price relayer signs Yahoo Finance quotes; signature, chain, order and age checked on chain (Chainlink has no equity feeds on Fuji) |
| Pay with stocks via 1inch Aqua maker | `NorenStockDesk.sell` at the oracle price minus 0.5%, then the tUSDC is paid privately (eERC to the hub) |
| Stock credit on Robinhood + CRE to Arc | `NorenStockCredit`: lock stocks, limit = value x LTV (60% +5 per on-time installment, max 75%), pay in 3 / pay later plans (1% flat fee), Earn pool funds them |
| Earn: Aqua liquidity | Earn: supply tUSDC to the pool that funds stock credit; fees raise the share value |
| Swap: Uniswap v4 / Aqua | Swap: buy or sell test stocks at the desk (oracle price +/- 0.5%) |
| Bridge (CCTP), CCIP, CRE, World ID, Reclaim, 0G | not on Avalanche: removed (never faked) |
| Crypto credit | `NorenCredit` (tWBTC / AVAX at Chainlink Fuji prices) stays as Borrow |
| Merchant server (SIWE, stores, keys, invoices) | the Noren API on the VPS (`hub/src/merchant.ts`), same endpoints under `/api` |

## Contracts added (contracts/src)

`NorenStockOracle`, `NorenStockDesk`, `NorenStockCredit`, `NorenStockStarter`; deploy `script/DeployStocks.s.sol`
via `scripts/fuji/deploy-stocks.ts` (merges addresses into `deployments/fuji.json`: stockOracle, stockDesk,
stockCredit, stockStarter, pricer, tNVDA..tSPY). SDK: `sdk/src/stocks.ts` (STOCKS, fetchQuote, signReport,
reportDigest, readStockPrices, readCredit, quoteSellIn).

Signed report: `NorenStockOracle.submit(tokens, prices8, marketTimes, signedAt, sig)`, sig = personal_sign by
NOREN_PRICER_KEY over `keccak256(abi.encode("Noren stock price v1", chainid, oracle, tokens, prices8, marketTimes,
signedAt))`; `maxAge` 3600 s on signedAt. `marketTime` = Yahoo `regularMarketTime` (shown, not enforced).

## Noren API additions (hub/src, VPS, prefix /api)

Auth (SIWE, EIP-4361, chain 43113):
- `GET /api/auth/nonce` -> `{ nonce }`
- `POST /api/auth/siwe` `{ message, signature }` -> `{ token, address }` (session bearer token)

Stores (a store = an on-chain `NorenMerchants` shop owned by the session address):
- `GET /api/stores` (session) -> `Store[]`
- `POST /api/stores` (session) `{ shopId, name }` -> `{ store, secretKey }` (checks `NorenMerchants.shop(shopId).owner`)
- `POST /api/stores/:id/keys` (session) -> `{ key: { id, prefix, createdAt }, secretKey }` (shown once; stored hashed)
- `PATCH /api/stores/:id` (session) `{ name }`
- `Store = { id, shopId, name, owner, createdAt, keys: { id, prefix, createdAt }[] }`

Invoices / payment links / checkout sessions:
- `POST /api/invoices` (Bearer `sk_test_...` of the store, or session + `storeId`) `{ amountCents, description,
  successUrl?, cancelUrl?, metadata? }` -> `Invoice` + `url` (`https://noren-avax-merchant.vercel.app/#/pay/<id>`)
- `GET /api/invoices/:id` (public) -> `Invoice`
- `GET /api/stores/:id/invoices` (session or that store's secret key) -> `Invoice[]` newest first
- `Invoice = { id (12 alnum, starts "in"), storeId, shopId, merchantName, amountCents, description, status:
  "open"|"paid"|"expired", createdAt, expiresAt, paidAt?, paymentTx?, method?, batch?, payoutTx?, successUrl?,
  cancelUrl?, metadata? }` (times unix seconds). Never a customer address.
- Paid detection: the hub's scan decrypts each payment note `noren:1:<shopId>:<order>:<claim>:<item>`; when `order`
  equals an open invoice id of that shop and the amount (cents) >= `amountCents`, the invoice becomes `paid` with
  `paymentTx`; `method` comes from the item prefix `<method>:<description>` where method is one of `private`,
  `stocks`, `credit`, `payin3`, `paylater`. When the hub settles the batch, `batch` and `payoutTx` are set.
- `GET /api/stores/:id/events` -> `{ id, type: "invoice.created"|"invoice.paid"|"payout.settled", created, data }[]`

Prices:
- `GET /api/prices` -> `{ source, quotes: { sym, price, marketTime }[], report (signed, JSON-safe), onchain: { signedAt, fresh } }`
- The relayer submits a fresh report every 10 minutes (and at start) with NOREN_RELAYER_KEY paying gas.

## Web (web/, one Vite app, hash routes as at ETHGlobal)

`#/` landing · `#/dashboard[/tab]` Noren Merchant · `#/pay/<invoiceId>` hosted checkout · `#/app[/tab]` Noren app
(Home · Pay · Earn · Credit · Borrow · Swap) · `#/auditor`. Same components, CSS and art as ETHGlobal; data layer on
Fuji (eERC private balance, hub, stocks, credit). Wallets: test wallet in the browser (gas-station starter pack +
stock starter pack) or an injected browser wallet; no Privy.

Hosted: `noren-avax.vercel.app` (landing + app), `noren-avax-merchant.vercel.app` (same build, `/` opens Noren
Merchant), `noren-avax-shop.vercel.app` (Aubelle, with a Vercel function that creates invoices with its secret key).

## Avalanche positioning (verified, sources only)

"The NYSE plans to settle tokenized stocks on Avalanche" (for its planned 24/7 tokenized securities venue, announced
Nov 9 2026, subject to regulatory approval): The Block
(https://www.theblock.co/news/business/2026-11-09-nyse-settle-tokenized-stocks-avalanche-planned-24-7-market-436208),
CoinDesk (https://www.coindesk.com/business/2026/11/09/nyse-picks-avalanche-to-settle-tokenized-stocks-amid-wall-street-s-blockchain-race).
Never stronger than that.
