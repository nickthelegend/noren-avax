# Submission: Noren on Avalanche

Event: Team1 India, "Build Anything on Avalanche" (deadline Nov 14 2026, 22:59 UTC).

**Name:** Noren

**One-liner:** Merchants let customers pay privately, with stablecoins or credit against their coins.

## Description

Paying a shop on a public chain publishes the shop's revenue and the customer's spend: anyone can total a store's
sales from the explorer. Noren is a checkout that keeps the amount private on Avalanche.

A customer pays in test USDC from a private balance, or locks BTC or AVAX, borrows against it at Chainlink prices and
pays in the same click. The payment is an Ava Labs eERC transfer in converter mode over test USDC: the amount is an
ElGamal ciphertext proven with a Groth16 proof made in the customer's browser and checked by eERC's production
verifiers. The shop's dashboard decrypts its revenue and each order note locally with the shop's key and lets it
withdraw to public USDC; the shop's accountant decrypts the same payments with the eERC auditor key. Snowtrace shows
who paid whom, and ciphertext where the amount would be.

The credit line (`NorenCredit`) lends from a pool against tWBTC (60% limit) and AVAX (50%), liquidates below health 1
with a close factor and bonus, accrues 6% APR, and refuses any Chainlink price older than 25 hours. Shops register in
`NorenMerchants`, which only opens a shop for an owner with a registered eERC key.

Everything runs live on Fuji: five demo steps sent from the web app (pay privately, pay on credit, merchant decrypts
and withdraws, auditor decrypts, customer repays), with each transaction listed in the README.

## Tech stack (Avalanche parts in bold)

- **Avalanche Fuji C-Chain** (chain 43113): all contracts, verified on Snowtrace.
- **Ava Labs EncryptedERC (eERC)**, converter mode, vendored unmodified at upstream `8dc98cd`, with its Registrar and
  production Groth16 verifiers; circuits from the same commit; **`@avalabs/eerc-sdk` 1.0.2** for proofs and
  decryption, in the browser and in Node.
- **Chainlink Data Feeds on Fuji**: BTC / USD and AVAX / USD.
- **Native AVAX** accepted as collateral.
- Solidity 0.8.27 + Foundry (unit, fuzz, fork and proof-replay tests); OpenZeppelin 5.1.
- TypeScript SDK on viem; React 19 + Vite web app; Playwright (headless Chrome) for QA and the live demo.

Not used: ICM / ICTT (optional in the brief; not built), mainnet, a custom L1.

## Links

- Repo: (to be pushed by Nick)
- Demo video (≤ 3 min): (to be recorded)
- Slides: `docs/SLIDES.md`
- Contracts on Snowtrace:
  - EncryptedERC: https://testnet.snowtrace.io/address/0x35f9E1A8f9e570b5C1f12bdE4202683878867153#code
  - Registrar: https://testnet.snowtrace.io/address/0xf3876666123fC4A15b4503b17Dc8188481f1bDc4#code
  - NorenCredit: https://testnet.snowtrace.io/address/0x8E11c777f31368c3630992Cd918D42a44EEf0713#code
  - NorenMerchants: https://testnet.snowtrace.io/address/0xE151590170cc22b8e34c93ABD43f9BAD26ddB039#code
  - tUSDC: https://testnet.snowtrace.io/address/0x788a627ceD9B795517A9c481A4377Ea0E26303A1#code
  - tWBTC: https://testnet.snowtrace.io/address/0x04e7f9a2b3c793884Fb9a5C5F424a4739AA6e754#code
- Live demo transactions: README, "Live demo, through the web app", and `deployments/fuji.json`.

## Prior work

Noren existed before the event (NEAR edition and earlier EVM versions). The product idea, positioning and design
language carry over; the Avalanche contracts, the eERC integration, the SDK, the tests, the web app and the Fuji
deployment were written for this build. Details in the README's "Prior work" section.

## AI tools used

- **Claude Code** (Claude): contracts, tests, SDK, web app, scripts, docs, QA.
- **ChatGPT** (image generation): the 3D object set (`docs/ART-3D.md`).
- Codex: not used for this build.
