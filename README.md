# Noren on Avalanche

**Merchants let customers pay privately, with stablecoins or credit against their coins.**

Noren is a checkout for shops. A customer pays in test USDC from a private balance, or borrows against their BTC or
AVAX and pays in the same flow. The payment is an [eERC](https://github.com/ava-labs/EncryptedERC) transfer on
Avalanche, so its amount is a ciphertext on chain: the shop decrypts its revenue with its own key, its accountant
decrypts it with the auditor key, and Snowtrace shows neither.

![Checkout after a private payment on Fuji](docs/img/checkout-1440.png)

- **Noren Merchant**: open a shop, list items, read private revenue decrypted in your browser, withdraw it.
- **Noren app**: the checkout (pay with tUSDC or with credit) and the credit line.
- **Noren SDK** (`sdk/`): the eERC private-payment rail and the credit reads, used by the web app and the scripts.

## Live on Avalanche Fuji

All contracts are verified on Snowtrace (Routescan). Addresses: [`deployments/fuji.json`](deployments/fuji.json).

| Contract | Address | What it does |
|---|---|---|
| EncryptedERC (Ava Labs, converter mode, 2 decimals) | [`0x35f9E1A8…867153`](https://testnet.snowtrace.io/address/0x35f9E1A8f9e570b5C1f12bdE4202683878867153#code) | Encrypted balances and private transfers over tUSDC |
| Registrar (Ava Labs) | [`0xf3876666…f1bDc4`](https://testnet.snowtrace.io/address/0xf3876666123fC4A15b4503b17Dc8188481f1bDc4#code) | eERC public keys, registered with a Groth16 proof |
| NorenCredit | [`0x8E11c777…Ef0713`](https://testnet.snowtrace.io/address/0x8E11c777f31368c3630992Cd918D42a44EEf0713#code) | Credit line against tWBTC / AVAX at Chainlink prices |
| NorenMerchants | [`0xE1515901…ddB039`](https://testnet.snowtrace.io/address/0xE151590170cc22b8e34c93ABD43f9BAD26ddB039#code) | Shops and catalogues; a shop opens only for a registered eERC key |
| tUSDC (test, 6 decimals) | [`0x788a627c…6303A1`](https://testnet.snowtrace.io/address/0x788a627ceD9B795517A9c481A4377Ea0E26303A1#code) | Faucet: 250 per address per day |
| tWBTC (test, 8 decimals) | [`0x04e7f9a2…A6e754`](https://testnet.snowtrace.io/address/0x04e7f9a2b3c793884Fb9a5C5F424a4739AA6e754#code) | Faucet: 0.01 per address per day |
| Chainlink BTC / USD (Fuji) | [`0x31CF013A…19c602a`](https://testnet.snowtrace.io/address/0x31CF013A08c6Ac228C94551d535d5BAfE19c602a) | Price for tWBTC collateral |
| Chainlink AVAX / USD (Fuji) | [`0x5498BB86…0D06aD`](https://testnet.snowtrace.io/address/0x5498BB86BC934c8D34FDA08E81D444153d0D06aD) | Price for AVAX collateral |

The eERC verifiers (registration, transfer, withdraw, mint, burn) are Ava Labs' production verifiers; their addresses
are in the deploy transactions recorded in `deployments/fuji.json` (`deployTxs`).

### Live demo, through the web app

Run on Fuji by `scripts/qa/demo.mjs`, which drives the QA build of the web app in headless Chrome with the QA signer
(a build flag plus Fuji test keys injected at runtime; production builds contain neither). Every proof was made in the
browser. Screenshots of each step are in `docs/img/`.

<!-- demo -->
| Step | Signer | Transactions (Snowtrace) |
|---|---|---|
| 1. Customer pays Linen tote privately | customer | register eERC key: [`0xd994d7ae…`](https://testnet.snowtrace.io/tx/0xd994d7aea38d88a107b2f996fe61d7c9dc59bb5ae365caf9d6c545932c4ac01a)<br>tUSDC faucet: [`0x4c05dbfe…`](https://testnet.snowtrace.io/tx/0x4c05dbfeb0475588ea82a61b58ee7ff9c94aa18bb455424e65e690cdb36c8746)<br>approve tUSDC for eERC: [`0x54cd67a6…`](https://testnet.snowtrace.io/tx/0x54cd67a658a1bfd8be5a0dc539f3e39f4b1ad2afe78a53e7addfa326f3f2031a)<br>top up private balance: [`0xf62222df…`](https://testnet.snowtrace.io/tx/0xf62222df071bd6852b6c7f7ecfcd23f9d7e96b0cde23207bb8dfe18e8010e030)<br>private payment to Harbor & Loom: [`0xcc37d1ff…`](https://testnet.snowtrace.io/tx/0xcc37d1ffe8149cde5b94f871177cad88a8a67f6d54fdd36a241ee6f47260cd61) |
| 2. Customer borrows against tWBTC and pays Waxed canvas apron on credit | customer | tWBTC faucet: [`0xa864565a…`](https://testnet.snowtrace.io/tx/0xa864565adb18388904678dbd583772620f7fa8b172df0ddd40fe0fadf87fd8f3)<br>approve tWBTC: [`0x63be89cb…`](https://testnet.snowtrace.io/tx/0x63be89cb92a70c759c0e742e08a84ac11611cda0d260a034db51ece53542aeda)<br>lock 0.01 tWBTC as collateral: [`0x7d799048…`](https://testnet.snowtrace.io/tx/0x7d799048a1b37cf09c3488cddcf68673d26d584ce1aa55a87188675077334425)<br>borrow 36.00 tUSDC: [`0xe18ba26e…`](https://testnet.snowtrace.io/tx/0xe18ba26eee72680020a1a5a025e5557a4eb69570276ba132d1105b99f06d7581)<br>credit into private balance: [`0xca9be264…`](https://testnet.snowtrace.io/tx/0xca9be2649a11a59b12420fbcf809e461d5db72587130ddd9f006c837d365edc5)<br>private payment to Harbor & Loom: [`0x90bdd489…`](https://testnet.snowtrace.io/tx/0x90bdd48949604ba652df7b7e72479f3dd8dd422c132389f55ba379019ef73960) |
| 3. Merchant decrypts private revenue and withdraws 24.00 tUSDC | merchant | withdraw private revenue: [`0xd5c8852f…`](https://testnet.snowtrace.io/tx/0xd5c8852f92d5ffa2aaeb46f9673dbb8b14626e357910cf53c26f9536e792924b) |
| 4. Auditor decrypts every payment and withdrawal | auditor | no transaction (local decryption) |
| 5. Customer repays the credit line in full | customer | approve tUSDC: [`0x51d50365…`](https://testnet.snowtrace.io/tx/0x51d503658026ff10b7f000fafa48fb75f6bce26b78b3910b9131b29be6b9722f)<br>repay in full: [`0xea2a053d…`](https://testnet.snowtrace.io/tx/0xea2a053dfb815c2f8fca27305180e53453728220fc3f1bbc0ec494f0a27d1c47) |
<!-- /demo -->

One-time setup (scripts/fuji/setup.ts):

<!-- setup -->
| Setup | Transaction |
|---|---|
| auditor registers its eERC public key (Groth16 registration proof) | [`0x2c5d6a09…`](https://testnet.snowtrace.io/tx/0x2c5d6a09c59099f1b0422b63e2547580556b8e476291e3bd1f5e2164009f9209) |
| merchant registers its eERC public key (Groth16 registration proof) | [`0x0feb5875…`](https://testnet.snowtrace.io/tx/0x0feb5875b4fe362b65e07d35e9d57d14e5ac2677781040d4812ea535f9eee99a) |
| eERC owner sets the auditor key | [`0xf13de5bd…`](https://testnet.snowtrace.io/tx/0xf13de5bdb1d84d5808938a99cb7281084c1687a8dc0e33e291f0654a17c66fc2) |
| Harbor & Loom opens on Noren Merchant | [`0x25695210…`](https://testnet.snowtrace.io/tx/0x256952109abf6529a2253e6f75fb2dc432170c20b810ae6cea61cb98428f083c) |
| lists Linen tote at 24 tUSDC | [`0xe3d501aa…`](https://testnet.snowtrace.io/tx/0xe3d501aab3f6a8fabfc928fb1a579073c409aae60fbfac27d9e4b41f2e55cdef) |
| lists Waxed canvas apron at 36 tUSDC | [`0xcf8c7c39…`](https://testnet.snowtrace.io/tx/0xcf8c7c391bef14c69e41b7459c0f6ea27c93dee033dbd0f383bf6fd3552b6ebb) |
| lists Stoneware mug at 18 tUSDC | [`0x73ce4a61…`](https://testnet.snowtrace.io/tx/0x73ce4a61cb200171488d36d6fb68e0a13c9681bd17cf281a58822c9d0d1c21bf) |
| lists Wool throw at 64 tUSDC | [`0x6136dbf0…`](https://testnet.snowtrace.io/tx/0x6136dbf02e98fa05fe2746449c34d7cc3cb98b2617863eec2861944770dd375d) |
<!-- /setup -->

## How it works

**Private revenue with eERC.** Noren deploys Ava Labs' EncryptedERC in **converter mode** over tUSDC. Converter mode
is what makes "pay, private revenue, merchant withdraws" work end to end with a dollar token: customers deposit tUSDC
and get an encrypted balance; payments are `transfer` calls whose amount is an ElGamal ciphertext (BabyJubJub) proven
with a Groth16 proof made in the browser; the shop withdraws back to public tUSDC with a withdraw proof. (Standalone
mode would mint a new private token with no dollar behind it.)

| On chain, for anyone | For the shop | For the auditor |
|---|---|---|
| Who paid whom, and when | The amount, decrypted from the proof's receiver ciphertext with the shop's key | The amount, decrypted from the auditor ciphertext every transfer carries |
| Top-ups (deposits) and withdrawals, in the clear | The order note, encrypted to the shop with eERC metadata | Every payment and withdrawal on the contract |
| Balances as ciphertexts only | Its balance, checked against the on-chain ciphertext | |

The checkout tops up in round amounts (50 tUSDC) so a deposit doesn't reveal the price of what follows.

**Credit against coins.** `NorenCredit` lends tUSDC from a pool against tWBTC (60% limit, 75% liquidation threshold,
5% bonus) and native AVAX (50% / 65% / 8%), priced by Chainlink's Fuji feeds. Debt accrues at 6% APR through a borrow
index. A position is liquidatable when health (liquidation value / debt) drops below 1; a liquidator repays at most
half and receives collateral worth the repayment plus the bonus. Every price read refuses a feed older than 25 hours
(the Fuji BTC / USD heartbeat is 24 h), a non-positive answer or a future timestamp.

"Pay with credit" in the checkout is one click and four steps: lock 0.01 tWBTC if the line is short, `borrow`,
deposit the borrowed tUSDC into eERC, and pay privately. The borrowing itself is public (it's a loan against public
collateral); the payment amount is not.

**Shops.** `NorenMerchants` holds each shop's name, checkout link and catalogue. `openShop` requires the owner to be
registered with the eERC Registrar, so every shop can be paid privately.

## Avalanche parts, and what's not here

- **eERC: used for the core flow.** Ava Labs' contracts vendored unmodified at upstream
  [`8dc98cd`](https://github.com/ava-labs/EncryptedERC/tree/8dc98cd4d63ad3aa6d86b70b8f4bbcd70f1e8be1) (checked file by
  file), circuits fetched from the same commit, proofs and decryption with the official `@avalabs/eerc-sdk` 1.0.2.
- **Chainlink Data Feeds on Fuji** for collateral prices.
- **ICM / ICTT: not built.** Accepting USDC from another ICM-enabled L1 was optional and is not in this build; nothing
  here claims it.
- **Not mainnet.** Fuji only, test tokens only.

## Limits, honestly

- One eERC deployment means one auditor key for every shop on it. A merchant group that wants its own accountant as
  the only auditor deploys its own converter contract; the app reads whichever one `deployments/fuji.json` names.
- Deposits are public and eERC deposit ciphertexts use fixed randomness (an upstream design note), so a balance gains
  confidentiality once it has received or sent a private transfer. The payer and payee addresses of a transfer are
  public; only the amount and the note are hidden.
- The pool is seeded by the deployer; there is no lender interface in this build.

## Run it

```bash
pnpm install
git submodule update --init
pnpm circuits                 # eERC circuit wasm + zkey from the pinned upstream commit
pnpm build:contracts && pnpm test:contracts
pnpm test:anvil               # needs anvil on PATH
pnpm dev                      # http://127.0.0.1:5361, connect Core or MetaMask on Fuji
```

Fuji scripts (keys in a gitignored `.env`, see `.env.example`): `scripts/fuji/keys.ts`, `fund.ts`, `deploy.ts`,
`setup.ts`. QA: `pnpm build:qa`, then `node scripts/qa/shots.mjs` and `node scripts/qa/demo.mjs`.

```
contracts/   Foundry: NorenCredit, NorenMerchants, NorenTestToken, vendored eERC; tests and fixtures
sdk/         @noren-avax/sdk: eERC rail (NorenPrivate), credit and shop reads, ABIs
web/         Vite + React app: landing, checkout, merchant, auditor, credit
scripts/     Fuji deploy/setup, Anvil end-to-end test, Playwright QA and demo
deployments/ fuji.json: addresses, setup and demo transactions
docs/        SLIDES.md, ART-3D.md, screenshots
```

Tests: [TESTING.md](TESTING.md) (37 Foundry tests, 4 Fuji-fork tests, 10 Anvil end-to-end tests).

## Prior work (disclosure)

Noren existed before this hackathon. What came from earlier Noren work:
- **Product, positioning and design language** from the NEAR edition (repo `noren-near`, branch `near`, Nov 6 to 12
  2026): the credit app (borrow and pay a shop), the credit card and health-bar layout, the checkout split page, the
  cream-and-dark look, the Urbanist and Space Mono pair and the persimmon accent. The NEAR edition's indigo lacquer is
  not reused; this build has its own palette and a new 3D object set.
- **Earlier EVM versions** of Noren (branches `wif`, Arc, Robinhood Chain) had a Solidity credit line
  (`NorenCreditLine`) on a different design. It informed the shape of `NorenCredit`, but no Solidity was copied.

Written for this build (Nov 12 2026): `NorenCredit`, `NorenMerchants`, the eERC integration and SDK, every test, the
web app, the Fuji deployment and demo. The eERC contracts and circuits are Ava Labs' (unmodified).

## Credits and license

MIT, Copyright (c) 2026 Nivesh Gajengi. `contracts/src/vendor/eerc` is Ava Labs' EncryptedERC under its own license
(`contracts/src/vendor/eerc/LICENSE.md`). 3D art generated with ChatGPT. Built with Claude Code.
