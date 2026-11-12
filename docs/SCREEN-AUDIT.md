# Screen audit (ship round, Nov 12 2026)

Every route and every state we can reach, at 1440 and 375, judged before and after this round's fixes. The look is
approved and unchanged: no new art, colours, fonts or layout. Fixes are copy, overflow, empty/error states and one
missing function.

Shots: `orchestration/shots/avax-noren/ship/before/`, `ship/after/` and `ship/hosted/` (the production site after the
redeploy). Scripts: `scripts/qa/shots.mjs` (signed-in roles, QA build) and `scripts/qa/states.mjs` (signed out, fresh
test wallet, edge states, production build or `NOREN_URL`). Every shot: 0 console errors, 0 px horizontal overflow,
before and after.

| Screen / state | Width | Before | What was wrong | Fix | After |
|---|---|---:|---|---|---:|
| Landing, first screen | 1440 / 375 | 8.0 | The sub-line was crypto jargon ("settles… through its own hub… unlinkable… Snowtrace can't"). A non-crypto judge couldn't tell who it's for in 5 s | New sub-line: for shops that take crypto; customers pay in stablecoins or on credit against bitcoin; only you and your accountant see who paid and how much; settled on Avalanche with eERC | 9.0 |
| Landing, live contracts | 1440 / 375 | 8.0 | The proof grid skipped NorenSettlement, NorenGasStation and the hub account, which do the work the page talks about | Grid shows 9 entries (3 × 3) with Snowtrace links. The hub links to its account page, not `#code` | 9.0 |
| Landing, cards (two views, two ways) | 1440 / 375 | 8.5 | Explanatory filler in the shop-view and books cards | Shorter copy | 9.0 |
| Checkout, signed out | 1440 / 375 | 8.5 | The connect note explained key derivation instead of the next step | "Connect wallet → Test wallet works with nothing installed." | 9.0 |
| Checkout, fresh test wallet (no AVAX) | 1440 / 375 | 9.0 | — | — | 9.0 |
| Checkout, QA customer (locked balance) | 1440 / 375 | 9.0 | — | — | 9.0 |
| Checkout, unknown shop `/shop/no-such-shop` | 1440 / 375 | 6.5 | Empty orange avatar, a "Pay" label over a blank amount bar, and copy about where shops are read from | "?" avatar, no amount block without a shop, "No shop on Fuji uses this link. Try Harbor & Loom." | 9.0 |
| Credit, signed out | 1440 / 375 | 8.5 | Labels read "(empty = 0.01 from the faucet)" | Labels say what to enter; the default shows as the placeholder (0.01 tWBTC, 0.005 AVAX, "Everything owed") | 9.0 |
| Credit, fresh test wallet (no AVAX) | 1440 / 375 | 6.5 | No way to get gas on this page: Lock collateral would fail. The gauge read "0.00 owed of 0.00 at the liquidation line" | The starter pack note (the one checkout and merchant already use) appears above the form; the gauge says "Nothing locked yet." | 9.0 |
| Credit, QA customer (line open) | 1440 / 375 | 9.0 | — | — | 9.0 |
| Merchant, signed out | 1440 / 375 | 8.0 | The note explained decryption but gave no next step for a judge without a shop key | "Or pick Test wallet to open your own shop. Revenue decrypts in this tab only." | 9.0 |
| Merchant, fresh test wallet (open shop form) | 1440 / 375 | 9.0 | — | — | 9.0 |
| Merchant, shop owner (decrypted) | 1440 | 8.5 | Withdraw and payout-check copy explained the proof | Shorter: "Moves private tUSDC to this wallet's public balance. The amount becomes public." / "✓ the statement matches what your key decrypts and its digest on chain." | 9.0 |
| Merchant, shop owner (decrypted) | 375 | 7.0 | The payments table ran wider than the card: Amount and the tx link sat off-screen behind a sideways scroll | On phones the From column and the "encrypted" chip are hidden; Order wraps; Amount and tx fit | 9.0 |
| Auditor, signed out | 1440 / 375 | 9.0 | — | — | 9.0 |
| Auditor, a wallet that isn't the auditor | 1440 / 375 | 8.5 | "Any other key gets noise, which is the point." plus a long accountant sentence | Shorter copy | 9.0 |
| Auditor, auditor key (ledger, batches) | 1440 | 9.0 | — | — | 9.0 |
| Auditor, auditor key (ledger) | 375 | 6.5 | The ledger showed When / Kind / From / To; the decrypted Amount (the point of the screen) was off-screen | On phones When and Tx are hidden (names still link to Snowtrace), names wrap, tighter cell padding: Kind, From, To and Amount fit | 9.0 |
| Auditor, accountant (statements) | 375 | 7.0 | Paid out and the ✓ check were off-screen | On phones When and Orders are hidden and the shop name wraps | 9.0 |
| Auditor, accountant (statements) | 1440 | 9.0 | Footnote was long | Shorter | 9.0 |
| Wallet menu (Test wallet / Browser wallet) | 1440 / 375 | 9.0 | — | — | 9.0 |
| 404 `/nope` | 1440 / 375 | 6.0 | A bare "Nothing here" and an underlined link | One line of copy plus "Back to Noren" and "Try the checkout" buttons in the existing button styles | 9.0 |

## Not reachable from a script, judged from the judge-run shots

The mid-transaction plan (starter pack → register → top-up → pay), the signed receipt, "Settled" after the batch and
the assistant were shot by `scripts/qa/judge.mjs` on Nov 12 (`orchestration/shots/avax-noren/9round/`, README "Judge
path"). They were judged 9 then and their code did not change this round, so they were not re-run (each run spends
starter-pack AVAX and waits up to 3 minutes for a batch).

## Below 9 that remains

None of the screens above. Two notes that are layout, not copy, so they were left alone under the no-restyle rule:

- Merchant at 1440: when a shop has only a few payments, the left column ends well above the right column's cards.
- The hero has a primary button (Try the checkout) and a quiet secondary one (Merchant dashboard); the brief asks for
  one primary action, which it has, but the secondary stays.
