# Submission: Noren on Avalanche

Event: Team1 India, "Build Anything on Avalanche" (deadline Nov 14 2026, 22:59 UTC).

**Name:** Noren

**One-liner:** Merchants let customers pay privately, with stablecoins or credit against their coins.

## Description

Paying a shop on a public chain publishes the shop's revenue and the customer's spend: anyone can total a store's
sales from the explorer and see who shops where. Noren is a checkout on Avalanche that hides both the amount and who
paid whom.

A customer pays in test USDC from a private balance, or locks BTC or AVAX, borrows against it at Chainlink prices and
pays in the same click. The payment is an Ava Labs eERC transfer in converter mode over test USDC: the amount is an
ElGamal ciphertext proven with a Groth16 proof made in the customer's browser and checked by eERC's production
verifiers. The payment goes to Noren's settlement hub, not to the shop, with the shop and order in a note encrypted
to the hub. Every 3 minutes the hub pays each shop it owes in one private transfer whose encrypted note is the
itemised statement, adds zero-value cover transfers so at least three shops are paid per batch, and records the batch
in `NorenSettlement` (payments settled once, statement digests, a copy for each shop's accountant, a copy for the eERC
auditor). Snowtrace sees "customer paid Noren" and "Noren paid these shops", all amounts encrypted. The shop's
dashboard decrypts its payouts and statements locally and checks them against the chain; the eERC auditor checks every
batch (each payment once, paid in = paid out); a shop's accountant reads its statements with its own key. The hub is a
trusted operator for liveness and sees every payment; the README says exactly what it hides and what it adds.

A judge needs nothing installed: **Connect wallet → Test wallet** makes a Fuji key in the browser, and the first
payment starts with `NorenGasStation`, which funds the new wallet with gas, 100 tUSDC and 0.01 tWBTC in one relayed
transaction (limits on chain). The merchant view has a Claude assistant ("How much did I make this week?") whose tools
run in the browser over the locally decrypted books.

The credit line (`NorenCredit`) lends from a pool against tWBTC (60% limit) and AVAX (50%), liquidates below health 1
with a close factor and bonus, accrues 6% APR, and refuses any Chainlink price older than 25 hours. Shops register in
`NorenMerchants`, which only opens a shop for an owner with a registered eERC key.

Everything runs live on Fuji: the judge path run on the hosted site by a fresh browser (starter pack, pay through
the hub, open a shop, batch settlement, merchant and accountant views, the assistant), the hub's batches, and the
first five-step demo, with each transaction listed in the README.

## Tech stack (Avalanche parts in bold)

- **Avalanche Fuji C-Chain** (chain 43113): all contracts, verified on Snowtrace.
- **Ava Labs EncryptedERC (eERC)**, converter mode, vendored unmodified at upstream `8dc98cd`, with its Registrar and
  production Groth16 verifiers; circuits from the same commit; **`@avalabs/eerc-sdk` 1.0.2** for proofs and
  decryption, in the browser and in Node.
- **Chainlink Data Feeds on Fuji**: BTC / USD and AVAX / USD.
- **Native AVAX** accepted as collateral.
- Solidity 0.8.27 + Foundry (unit, fuzz, fork and proof-replay tests); OpenZeppelin 5.1.
- TypeScript SDK on viem; React 19 + Vite web app; Node hub service (Docker on a VPS, behind Traefik); Playwright
  (headless Chrome) for QA and the live runs.
- Claude (`claude-haiku-5-5`, Anthropic TypeScript SDK) for the merchant assistant, through Noren's API.

Not used: ICM / ICTT (optional in the brief; not built), mainnet, a custom L1.

## Links

- Live app: https://noren-avax.vercel.app (Fuji testnet; no wallet needed: Connect wallet → Test wallet; tabs Credit · Pay anyone · Debt-free · Merchant · Accountant · Auditor)
- Noren API (hub, gas relay, assistant): https://noren-avax-api.201-18-198-162.sslip.io/api/health
- Repo: (to be pushed by Nick)
- Demo video (2:32, v9, recorded Nov 13 live on the hosted site and Fuji, take 7, batch #12): `grokbot/videos/noren-avax/noren-avax-film.mp4` (1080p) and `noren-avax-film-share.mp4` (720p, 9.6 MB); every render is kept in `videos/noren-avax/versions/` (v1 = the earlier cut on the old UI). Upload link: (to be added by Nick)
- Slides: `docs/SLIDES.md`
- Screen audit (every route and state at 1440 and 375): `docs/SCREEN-AUDIT.md`
- Contracts on Snowtrace:
  - EncryptedERC: https://testnet.snowtrace.io/address/0x35f9E1A8f9e570b5C1f12bdE4202683878867153#code
  - Registrar: https://testnet.snowtrace.io/address/0xf3876666123fC4A15b4503b17Dc8188481f1bDc4#code
  - NorenCredit: https://testnet.snowtrace.io/address/0x8E11c777f31368c3630992Cd918D42a44EEf0713#code
  - NorenMerchants: https://testnet.snowtrace.io/address/0xE151590170cc22b8e34c93ABD43f9BAD26ddB039#code
  - NorenSettlement: https://testnet.snowtrace.io/address/0x096Bb172202953FF4D5f4d570CEFD815bc4C6558#code
  - NorenGasStation: https://testnet.snowtrace.io/address/0x5e8A47127F06b6ec93f2b49FB79768D561887513#code
  - Noren hub (eERC account): https://testnet.snowtrace.io/address/0x58e374A4c704f1806BAbD04726FB60e86e76A6A7
  - tUSDC: https://testnet.snowtrace.io/address/0x788a627ceD9B795517A9c481A4377Ea0E26303A1#code
  - tWBTC: https://testnet.snowtrace.io/address/0x04e7f9a2b3c793884Fb9a5C5F424a4739AA6e754#code
- Live demo transactions: README, "Live demo, through the web app", and `deployments/fuji.json`.

## Prior work

Noren existed before the event (NEAR edition and earlier EVM versions). The product idea and positioning carry over,
and since Nov 13 the web app uses the UI of Noren on NEAR as is (its stylesheets, components, 3D art and fonts; only
the chain layer and labels differ). The Avalanche contracts, the eERC integration, the SDK, the hub, the tests, the
app's screens and chain layer and the Fuji deployment were written for this build. Details in the README's "Prior
work" section.

## AI tools used

- **Claude Code** (Claude): contracts, tests, SDK, hub, web app, scripts, docs, QA.
- **Claude API** (`claude-haiku-5-5`): the in-app merchant assistant.
- **ChatGPT** (image generation): the 3D object set (`docs/ART-3D.md`).
- Codex: not used for this build.
