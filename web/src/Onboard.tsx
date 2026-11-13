/**
 * Noren Merchant first run: sign in with Ethereum (EIP-4361) → business name → payouts → first payment link → SDK.
 * Payouts are private: the store's wallet registers an eERC key (a Groth16 proof made here), opens its shop on
 * NorenMerchants, and Noren's hub pays it in encrypted batches. Noren's API binds the store to that on-chain shop and
 * gives it a secret key, shown once.
 */
import { useEffect, useState } from "react";
import { norenMerchantsAbi } from "@noren-avax/sdk";
import type { Abi, Hex } from "viem";
import { cents, getStarterPack, merchant, signIn, type Session, type Store } from "./lib/api";
import { D, MERCHANT_ORIGIN, pub } from "./lib/chain";
import { announceTx, connectWallet, currentWho, isUnlocked, openTestWallet, privateSession, unlock, useWho, write } from "./lib/signer";
import { runPlan, type PlanStep, type Step } from "./lib/pay";
import { Copy, Icon, Logo, msgOf } from "./ui";
import { QR } from "./kit";
import { TxLink } from "./tx";
import "./onboard.css";

const STEPS = ["Sign in", "Business", "Payouts", "First payment link", "Developers"];
const slugOf = (name: string) => `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24) || "shop"}-${Math.random().toString(36).slice(2, 6)}`;

export function Onboard({ session, onSession, onStore, onDone }: { session: Session | null; onSession: (s: Session) => void; onStore: (s: Store) => void; onDone: () => void }) {
  const who = useWho();
  const [step, setStep] = useState(session ? 1 : 0);
  const [name, setName] = useState("");
  const [store, setStore] = useState<Store | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [openTx, setOpenTx] = useState<Hex | null>(null);
  const [amount, setAmount] = useState("12.50");
  const [desc, setDesc] = useState("");
  const [link, setLink] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [steps, setSteps] = useState<Step[] | null>(null);
  useEffect(() => { if (session && step === 0) setStep(1); }, [session]); // eslint-disable-line react-hooks/exhaustive-deps
  const run = async (k: string, f: () => Promise<void>) => { setBusy(k); setErr(null); try { await f(); } catch (e) { setErr(msgOf(e)); } finally { setBusy(null); } };

  const signInWith = (via: "test" | "browser") => run(via, async () => {
    if (via === "test") openTestWallet("merchant"); else await connectWallet();
    const w = currentWho();
    if (!w) throw Error("No wallet connected.");
    onSession(await signIn(w.address)); setStep(1);
  });

  const createStore = () => run("store", async () => {
    if (!who || !session) throw Error("Sign in first.");
    let shopId: number | null = null;
    const plan: PlanStep[] = [
      { key: "pack", title: "Get test gas", detail: "NorenGasStation sends a new wallet gas and test funds in one transaction", needed: async () => (await pub.getBalance({ address: who.address })) === 0n, run: () => getStarterPack(who.address) },
      { key: "unlock", title: "Make your payout key", detail: "One signature; your eERC key is derived from it and stays in this tab", needed: async () => !isUnlocked(), run: async () => { await unlock(); return null; } },
      { key: "register", title: "Register for private payouts", detail: "A zero-knowledge proof made here registers your eERC key with Ava Labs’ Registrar", needed: async () => !(await privateSession().isRegistered()), run: async () => { const h = await privateSession().register(); if (h) announceTx(h, "register eERC key"); return h; } },
      {
        key: "open", title: `Open ${name.trim()} on Avalanche`, detail: "NorenMerchants.openShop: your shop id is what Noren’s hub pays", needed: async () => true,
        run: async () => {
          const h = await write(D.norenMerchants, norenMerchantsAbi as Abi, "openShop", [name.trim(), slugOf(name)], `open ${name.trim()} on Noren Merchant`);
          const ids = (await pub.readContract({ address: D.norenMerchants, abi: norenMerchantsAbi, functionName: "shopsOf", args: [who.address] })) as readonly bigint[];
          shopId = Number(ids[ids.length - 1]);
          setOpenTx(h);
          return h;
        },
      },
      {
        key: "store", title: "Create your Noren Merchant store", detail: "Noren’s API checks the shop is yours and makes your secret key", needed: async () => true,
        run: async () => {
          const r = await merchant.createStore(session.token, shopId!, name.trim());
          setStore(r.store); setSecret(r.secretKey); onStore(r.store);
          return null;
        },
      },
    ];
    if (await runPlan(plan, setSteps)) setStep(3);
  });

  const snippet = store ? `// server.ts: create a checkout link with your secret key
const res = await fetch("https://noren-avax-api.201-18-198-162.sslip.io/api/invoices", {
  method: "POST",
  headers: {
    authorization: \`Bearer \${process.env.NOREN_SECRET_KEY}\`, // ${secret ? secret.slice(0, 14) + "…" : "sk_test_…"}
    "content-type": "application/json",
  },
  body: JSON.stringify({
    amountCents: 1250, // 12.50 tUSDC
    description: "Order #1001",
    successUrl: "https://your-shop.example/thanks",
    cancelUrl: "https://your-shop.example/cart",
  }),
});
const invoice = await res.json();
// send the customer to invoice.url (${MERCHANT_ORIGIN}/#/pay/\${invoice.id})` : "";

  return (
    <div className="ob">
      <aside className="ob-side">
        <div className="ob-brand"><Logo size={28} /><b>Noren Merchant</b></div>
        <p>Set up your store in a minute. Customers can pay with stocks, in 3 parts against their stocks, privately or with tUSDC; you get paid in tUSDC on Avalanche.</p>
        <ol className="ob-steps">{STEPS.map((t, i) => <li key={t} data-state={i < step ? "done" : i === step ? "now" : "todo"}><i>{i < step ? <Icon.check /> : i + 1}</i><span>{t}</span></li>)}</ol>
        <p className="ob-fine">Test mode: Avalanche Fuji testnet. Test tokens only, no real funds.</p>
      </aside>

      <section className="ob-main" aria-live="polite">
        {step === 0 && (
          <div className="ob-card">
            <span className="ob-k">Sign in</span>
            <h1>Sign in to Noren Merchant</h1>
            <p>Use a wallet. You sign one message (Sign-In with Ethereum, EIP-4361), Noren’s API checks it, and nothing is sent on-chain.</p>
            <div className="ob-choices">
              <button className="ob-choice" disabled={!!busy} onClick={() => signInWith("test")}>
                <Icon.lock /><span><b>{busy === "test" ? "Signing in…" : "Use a test wallet"}</b><small>A key kept in this browser, for Avalanche Fuji</small></span><Icon.arrow />
              </button>
              <button className="ob-choice" disabled={!!busy} onClick={() => signInWith("browser")}>
                <Icon.shield /><span><b>{busy === "browser" ? "Waiting for your wallet…" : "Browser wallet"}</b><small>Core, MetaMask or Rabby: sign one message, nothing is sent on-chain</small></span><Icon.arrow />
              </button>
            </div>
            {err && <p className="err" role="alert">{err}</p>}
          </div>
        )}

        {step === 1 && (
          <form className="ob-card" onSubmit={(e) => { e.preventDefault(); if (name.trim()) setStep(2); }}>
            <span className="ob-k">Step 1 of 3</span>
            <h1>What's your business called?</h1>
            <p>Customers see this name on your checkout and receipts.</p>
            <label className="ob-field"><span>Business name</span><input autoFocus maxLength={48} value={name} onChange={(e) => setName(e.target.value)} placeholder="Chai Point, Bandra" /></label>
            <p className="ob-who mono">Signed in as {session?.address}</p>
            <button className="ob-cta" disabled={!name.trim()}>Continue <Icon.arrow /></button>
          </form>
        )}

        {step === 2 && (
          <div className="ob-card">
            <span className="ob-k">Step 2 of 3</span>
            <h1>Where should payouts go?</h1>
            <p>Every payment settles as tUSDC on Avalanche. Noren’s hub pays you in batches with other shops, as encrypted eERC transfers: only you can read the amounts.</p>
            <div className="ob-choices" role="radiogroup" aria-label="Payout">
              <button role="radio" aria-checked className="ob-choice"><Icon.eyeOff /><span><b>Private tUSDC payouts to this wallet</b><small className="mono">{session?.address}</small></span></button>
            </div>
            {steps && (
              <ol className="co-steps">
                {steps.map((s, i) => (
                  <li key={s.key} data-state={s.state === "done" || s.state === "skip" ? "done" : s.state === "run" ? "now" : "todo"}>
                    <i>{s.state === "done" || s.state === "skip" ? <Icon.check /> : s.state === "run" ? <span className="spin xs" /> : s.state === "fail" ? <Icon.x /> : i + 1}</i>
                    <div><b>{s.title}</b><span>{s.error ? <span className="err">{s.error}</span> : s.hash ? <TxLink hash={s.hash} n={8} /> : s.detail}</span></div>
                  </li>
                ))}
              </ol>
            )}
            {err && <p className="err" role="alert">{err}</p>}
            <div className="ob-row">
              <button className="ob-ghost" disabled={!!busy} onClick={() => setStep(1)}>Back</button>
              <button className="ob-cta" disabled={!!busy || !who} onClick={createStore}>{busy === "store" ? <><span className="spin" /> {steps?.find((s) => s.state === "run")?.title ?? "Registering on Avalanche"}…</> : <>Create store <Icon.arrow /></>}</button>
            </div>
            <p className="ob-fine">Creating the store registers your eERC key and opens your shop with <code>NorenMerchants.openShop</code> on Avalanche Fuji.</p>
          </div>
        )}

        {step === 3 && store && (
          <div className="ob-card">
            <span className="ob-k">Step 3 of 3</span>
            <h1>Create your first payment link</h1>
            <p><b>{store.name}</b> is live on Avalanche Fuji as shop #{store.shopId}{openTx ? <> (opened in tx <TxLink hash={openTx} n={8} />)</> : null}. Make a link and share it, or print its QR at the counter.</p>
            {!link ? (
              <>
                <div className="ob-row2">
                  <label className="ob-field"><span>Amount (tUSDC)</span><input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} /></label>
                  <label className="ob-field"><span>Description</span><input value={desc} maxLength={60} onChange={(e) => setDesc(e.target.value)} placeholder="Masala chai, large" /></label>
                </div>
                {err && <p className="err" role="alert">{err}</p>}
                <button className="ob-cta" disabled={!!busy || !(Number(amount) > 0)} onClick={() => run("link", async () => {
                  const r = await merchant.createInvoice(session!.token, store.id, Math.round(Number(amount) * 100), desc.trim() || "Payment");
                  setLink(r.url ?? `${MERCHANT_ORIGIN}/#/pay/${r.id}`);
                })}>{busy === "link" ? <><span className="spin" /> Creating…</> : <>Create link <Icon.arrow /></>}</button>
              </>
            ) : (
              <div className="ob-link">
                <div className="ob-qr"><QR text={link} size={168} /></div>
                <div>
                  <b>{cents(Math.round(Number(amount) * 100))} tUSDC{desc ? ` · ${desc}` : ""}</b>
                  <code className="ob-url">{link}</code>
                  <div className="ob-row"><Copy text={link} label="Copy link" /><a className="ob-ghost" href={link.slice(link.indexOf("#"))} target="_blank" rel="noreferrer">Open checkout <Icon.ext /></a></div>
                </div>
              </div>
            )}
            {link && <button className="ob-cta" onClick={() => setStep(4)}>Continue <Icon.arrow /></button>}
          </div>
        )}

        {step === 4 && store && (
          <div className="ob-card">
            <span className="ob-k">Developers</span>
            <h1>Your API keys</h1>
            <p>The secret key is shown <b>once</b>. Noren keeps only its hash; make a new one in Developers.</p>
            <dl className="ob-keys">
              <dt>Store ID</dt><dd><code>{store.id}</code><Copy text={store.id} /></dd>
              <dt>Secret key</dt><dd>{secret ? <><code>{secret}</code><Copy text={secret} /></> : <span className="faint">Already shown. Make a new one in Developers.</span>}</dd>
              <dt>Shop on Avalanche</dt><dd><code>#{store.shopId} · {store.owner}</code><Copy text={store.owner} /></dd>
            </dl>
            <div className="ob-snip"><header><span>server.ts</span><Copy text={snippet} label="Copy snippet" /></header><pre>{snippet}</pre></div>
            <button className="ob-cta" onClick={() => { setSecret(null); onDone(); }}>Go to your dashboard <Icon.arrow /></button>
          </div>
        )}
      </section>
    </div>
  );
}
