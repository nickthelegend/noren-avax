import { useEffect, useRef, useState } from "react";
import { Icon } from "./ui";
import { Mark } from "./logos";
import { D, addrUrl, txUrl } from "./lib/chain";
import "./landing.css";

/* Every number on this page comes from TESTING.md and deployments/fuji.json (Avalanche Fuji, Nov 2026).
   Art: ChatGPT (stills) and Google Gemini Veo (film), from Noren at ETHGlobal; see README. */

type Status = "live" | "testnet" | "relayer" | "off";
const STATUS: Record<Status, string> = { live: "Live on Fuji", testnet: "Live on testnet", relayer: "Signed relayer", off: "Not on Avalanche" };
const Chip = ({ s }: { s: Status }) => <span className={`nx-chip ${s === "off" ? "wip" : s === "relayer" ? "quotes" : "live"} mono`}><i />{STATUS[s]}</span>;

/** The verified Avalanche fact this edition is built around, with its sources. Never stronger than they are. */
export const NYSE = {
  line: "The NYSE plans to settle tokenized stocks on Avalanche",
  detail: "for its planned 24/7 tokenized securities venue, announced Nov 9 2026 and subject to regulatory approval",
  sources: [
    ["The Block", "https://www.theblock.co/news/business/2026-11-09-nyse-settle-tokenized-stocks-avalanche-planned-24-7-market-436208"],
    ["CoinDesk", "https://www.coindesk.com/business/2026/11/09/nyse-picks-avalanche-to-settle-tokenized-stocks-amid-wall-street-s-blockchain-race"],
  ] as [string, string][],
};

const API = "https://noren-avax-api.201-18-198-162.sslip.io";
const CODE: Record<string, { file: string; lines: [string, string][] }> = {
  link: { file: "server.ts", lines: [
    ["c", "// Merchant side: create a checkout link with your secret key"],
    ["", `const res = await fetch("${API}/api/invoices", {`],
    ["", "  method: \"POST\","],
    ["", "  headers: { authorization: `Bearer ${process.env.NOREN_SECRET_KEY}` },"],
    ["", "  body: JSON.stringify({ amountCents: 14800, description: \"Amélie Gingham\" }),"],
    ["", "});"],
    ["", "const invoice = await res.json();"],
    ["s", "// → send the customer to invoice.url"],
  ] },
  status: { file: "order.ts", lines: [
    ["c", "// Is it paid? Ask Noren, no webhook server needed"],
    ["", `const inv = await fetch(\`${API}/api/invoices/\${id}\`).then((r) => r.json());`],
    ["", "if (inv.status === \"paid\") fulfil(inv);"],
    ["s", "// inv has the amount, the method and the tx. Never a customer address."],
  ] },
  pay: { file: "checkout.ts", lines: [
    ["c", "// Customer side, in the browser: an eERC payment to Noren's hub"],
    ["k", "import { NorenPrivate, hubNote } from \"@noren-avax/sdk\";"],
    ["", ""],
    ["", "const me = new NorenPrivate(pub, wallet, deployment, circuits);"],
    ["", "await me.shield(50_000_000n);   // a round lot into your encrypted balance"],
    ["", "await me.pay(hub, 14800n, note); // Groth16 proof made on this device"],
    ["s", "// The note (shop, order) is encrypted to the hub; the amount is a ciphertext."],
  ] },
};

const SURFACES = [
  { k: "merchant", name: "Noren Merchant", href: "#/dashboard", cta: "Open Noren Merchant", img: "/art/surface-merchant.jpg", w: 1200, h: 750,
    line: "The merchant dashboard. Payments by method (stocks first), payment links, private payouts decrypted in your browser, API keys, events and an assistant over your books.",
    cap: "Home: today against yesterday, private balance, payment-method mix." },
  { k: "app", name: "Noren app", href: "#/app", cta: "Open the Noren app", img: "/art/surface-app.jpg", w: 500, h: 1040,
    line: "The customer's side. Pay with stocks, get credit against them without selling, a private balance, Earn and Swap.",
    cap: "At 375 px: balance, stocks, credit available." },
  { k: "sdk", name: "Noren SDK", href: "#developers", cta: "Read the API", img: "/art/surface-checkout.jpg", w: 1200, h: 750,
    line: "A hosted checkout and a REST API. Create a link with your secret key, send the customer to it, read it back when it's paid.",
    cap: "The hosted checkout, with the four ways to pay." },
];

type Power = { k: string; t: string; s: Status[]; d: string; m?: string; art?: string; alt?: string; tone?: "dark" };
const POWERS: Power[] = [
  { k: "stocks", t: "Pay with stocks", s: ["live"],
    d: "Spend the test stock you hold (tNVDA, tTSLA, tAAPL, tMSFT, tSPY). Noren's stock desk buys it at the live price into your encrypted balance, and the shop is paid privately in tUSDC.",
    m: "price: Yahoo Finance quote, signed, under an hour old" },
  { k: "in3", t: "Pay in 3, against your stocks", s: ["live"],
    d: "Keep your shares. Lock them, and pay in three installments two weeks apart, or later in 30 days. 1% fee, no interest; the shop is paid in full, privately.",
    m: "limit = stock value × 60%, up to 75%" },
  { k: "private", t: "Pay privately", s: ["live"], art: "/art/iso-privacy.jpg", alt: "A coin stack passes behind a noren curtain; only a receipt comes out the other side",
    d: "Every way to pay ends in an Ava Labs eERC transfer to Noren's hub: the amount is a ciphertext and the proof is made in your browser. The hub pays shops in batches, so the shop never learns who paid." },
  { k: "earn", t: "Credit that grows", s: ["live"], art: "/art/render-earn.jpg", alt: "Stock and ether tokens float into a softly glowing glass vault", tone: "dark",
    d: "Your limit starts at 60% of your locked stock's value. Every installment repaid on time adds 5 points, up to 75%, recorded on chain by NorenStockCredit. The tUSDC comes from the Earn pool, which earns the fees." },
  { k: "borrow", t: "Borrow at a Chainlink price", s: ["live"],
    d: "Lock tWBTC or AVAX and borrow tUSDC at Chainlink's BTC / USD and AVAX / USD prices on Fuji, with a health factor and liquidation.",
    m: "a stale Chainlink round stops new credit" },
  { k: "human", t: "Books only you can read", s: ["live"], art: "/art/render-credit.jpg", alt: "A card made of light floats in front of a glowing orb", tone: "dark",
    d: "Shops decrypt their payouts and itemised statements with their own key, name an accountant who gets a copy, and ask Claude about their sales: the tools run in the browser over the decrypted books." },
];

const BUILT: { name: string; logos: string[]; use: string; s: Status; note?: string }[] = [
  { name: "Ava Labs EncryptedERC (eERC)", logos: ["AVAX"], use: "Why the shop never sees who paid, and nobody sees how much: encrypted balances and transfers on Avalanche, Groth16 proofs made in the browser, an auditor key for compliance.", s: "live" },
  { name: "Noren settlement hub", logos: ["AVAX"], use: "Customers pay the hub, the hub pays shops in batches every 3 minutes with zero-value covers, and records each batch on NorenSettlement with a digest of every statement.", s: "live" },
  { name: "Noren stock price relayer", logos: ["NVDA"], use: "Chainlink has no equity feeds on Fuji, so a relayer signs Yahoo Finance quotes into NorenStockOracle; the contract checks the signature, the chain, the order and the age of every report.", s: "relayer", note: "Test stocks, real quotes, labelled with their source" },
  { name: "Chainlink Data Feeds", logos: ["CHAINLINK"], use: "BTC / USD and AVAX / USD on Fuji price crypto collateral in NorenCredit; EUR / USD prices the euro estimate in the demo shop.", s: "live" },
  { name: "Claude", logos: [], use: "The merchant assistant: Claude asks for tools, the tools run in the shop's browser over its decrypted books.", s: "live" },
  { name: "Cross-chain (CCTP, CCIP, CRE), World ID, 0G, 1inch Aqua", logos: [], use: "Parts of Noren at ETHGlobal that don't run on Avalanche Fuji. Not in this edition.", s: "off" },
];

const tx = (k: string) => (D.txs?.[k]?.hash ?? "") as string;
const LIVE_STRIP: { t: string; d: string; href: string; marks: string[] }[] = [
  ...(D.live ?? []).map((x) => ({ t: x.t, d: x.d, href: txUrl(x.hash), marks: x.marks })),
  { t: "Aubelle opens on Noren", d: "eERC key, then NorenMerchants", href: txUrl(tx("open_aubelle")), marks: ["AVAX"] },
  { t: "Hub batches", d: "NorenSettlement, every batch", href: addrUrl(D.norenSettlement!), marks: ["AVAX"] },
].filter((x) => !/\/tx\/$/.test(x.href));

const ONBOARD: [string, string][] = [
  ["Sign in and open your store", "Sign in with your wallet (Sign-In with Ethereum), name your store, register your eERC key and open it on Avalanche. Noren gives you API keys."],
  ["Create a payment link", "Price it in tUSDC. Customers can pay it with stocks, in 3 against their stocks, privately or in tUSDC. One API call does the same."],
  ["Get paid privately", "Noren's hub pays you in an encrypted batch with other shops. Your payouts and statements decrypt in your browser; there's no customer field."],
];

const NUMBERS: { v: string; u?: string; l: string }[] = [
  { v: "5", l: "test stocks priced from real quotes, signed and checked on chain" },
  { v: "0", l: "customer addresses a shop ever receives from Noren" },
  { v: "3", u: "min", l: "between settlement batches, each paying at least three shops" },
  { v: "60–75", u: "%", l: "of your stock's value as credit, rising with on-time repayments" },
  { v: "107", l: "Foundry tests passing, plus Anvil suites with real eERC proofs" },
  { v: "1", l: "chain: Avalanche Fuji" },
];

function useReveal() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = ref.current; if (!root) return;
    const els = root.querySelectorAll<HTMLElement>("[data-reveal]");
    if (!("IntersectionObserver" in window)) { els.forEach((e) => e.classList.add("in")); return; }
    const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } }), { rootMargin: "0px 0px -8% 0px" });
    els.forEach((e) => io.observe(e));
    return () => io.disconnect();
  }, []);
  return ref;
}

/** Plays a muted ambient film only while it is on screen, and never under reduced motion. */
function Film({ src, poster, label }: { src: string; poster: string; label: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const v = ref.current; if (!v) return;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) v.play().catch(() => {}); else v.pause(); }, { threshold: .25 });
    io.observe(v);
    return () => io.disconnect();
  }, []);
  return <video ref={ref} src={src} poster={poster} muted loop playsInline preload="metadata" aria-label={label} />;
}

/** A field of tiny noren marks that brightens toward a horizon, with a slow shimmer. Deterministic, cheap, pauses offscreen. */
function GlyphField() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current!; const ctx = c.getContext("2d")!;
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let w = 0, h = 0, raf = 0, visible = true, last = 0;
    const dpr = Math.min(devicePixelRatio || 1, 2), cell = 15;
    const hash = (x: number, y: number) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); };
    const resize = () => { const r = c.getBoundingClientRect(); w = r.width; h = r.height; c.width = w * dpr; c.height = h * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); draw(performance.now()); };
    const draw = (t: number) => {
      ctx.clearRect(0, 0, w, h);
      const cols = Math.ceil(w / cell), rows = Math.ceil(h / cell), time = reduce ? 0 : t / 1000;
      for (let j = 0; j < rows; j++) {
        const fy = j / rows;
        for (let i = 0; i < cols; i++) {
          const n = hash(i, j), cx = i / cols - .5;
          // vertical light: strongest near the horizon (bottom), shaped like a wide dome, rippled by a slow wave
          const dome = Math.max(0, 1 - (cx * cx) * 2.2 - Math.pow(1 - fy, 1.6) * 1.15);
          const wave = .55 + .45 * Math.sin(time * .8 + i * .21 + j * .13 + n * 6.28);
          // keep the copy legible: clear an ellipse behind the headline and paragraph
          const dx = cx / .3, dy = (fy - .5) / .26, hole = Math.min(1, Math.max(0, (dx * dx + dy * dy - .55) / .9));
          const a = dome * (n > .42 ? 1 : .25) * wave * hole;
          if (a < .04) continue;
          const x = i * cell + 4, y = j * cell + 4;
          ctx.fillStyle = `rgba(${150 + 90 * fy | 0}, ${185 + 60 * fy | 0}, 255, ${Math.min(1, a * 1.1)})`;
          ctx.fillRect(x, y, 1.6, 6); ctx.fillRect(x + 3, y, 1.6, 7); ctx.fillRect(x + 6, y, 1.6, 6);
        }
      }
    };
    const loop = (t: number) => { raf = requestAnimationFrame(loop); if (!visible || t - last < 50) return; last = t; draw(t); };
    resize(); addEventListener("resize", resize);
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; }); io.observe(c);
    if (!reduce) raf = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(raf); removeEventListener("resize", resize); io.disconnect(); };
  }, []);
  return <canvas ref={ref} className="lx-field" aria-hidden />;
}

const Tag = ({ children, dark }: { children: string; dark?: boolean }) => <span className={`lx-tag mono ${dark ? "dark" : ""}`}>■ {children}</span>;

export function Landing() {
  const [tab, setTab] = useState<keyof typeof CODE>("link");
  const ref = useReveal();
  return (
    <div className="lp" ref={ref}>
      {/* ---------------------------------------------------------------- hero (unchanged) */}
      <section className="lx-hero">
        <GlyphField />
        <div className="lx-hero-in">
          <span className="lx-pill mono"><i />Live on Avalanche Fuji · eERC</span>
          <h1>Take Stocks as Payment.{" "}<em>Never See</em><br /><em>Who</em> Paid You</h1>
          <p>Noren lets merchants accept stablecoins, stocks or credit — privately. Customers pay with their stocks, or get credit against them without selling, and the shop is paid in tUSDC through Ava Labs’ encrypted ERC on Avalanche.</p>
          <div className="lx-ctas">
            <a className="lx-btn light" href="#/dashboard">Open dashboard</a>
            <a className="lx-btn dark" href="#/app">Open the app</a>
          </div>
          <p className="lx-nyse mono">Why Avalanche: {NYSE.line}. <a href={NYSE.sources[0][1]} target="_blank" rel="noreferrer">The Block</a> · <a href={NYSE.sources[1][1]} target="_blank" rel="noreferrer">CoinDesk</a></p>
        </div>
        <div className="lx-horizon" aria-hidden />
      </section>

      {/* ---------------------------------------------------------------- live on public testnets */}
      <section className="nx-live" aria-label="Live on Avalanche Fuji">
        <div className="nx-live-in">
          <span className="nx-live-h mono"><i aria-hidden />Live on Avalanche Fuji</span>
          <ul>
            {LIVE_STRIP.map((x) => (
              <li key={x.href}><a href={x.href} target="_blank" rel="noreferrer"><span className="nx-live-m" aria-hidden>{x.marks.map((m) => <Mark key={m} id={m} size={18} />)}</span><span><b>{x.t}</b><small>{x.d}</small></span><Icon.ext /></a></li>
            ))}
          </ul>
          <p className="mono">Every link opens Snowtrace on Avalanche Fuji. Stocks are test tokens priced from real quotes; see the README's "Honest limits".</p>
        </div>
      </section>

      {/* ---------------------------------------------------------------- (a) what Noren is */}
      <section className="nx-one">
        <div className="nx-one-in">
          <div data-reveal><Tag dark>What Noren is</Tag></div>
          <h2 data-reveal>Spend your stocks, or borrow against them, and the shop <em>never</em> learns who paid. <span>{NYSE.line}, {NYSE.detail}. Noren is where those shares meet a checkout.</span></h2>
          <figure className="nx-film" data-reveal>
            <Film src="/art/vault.mp4" poster="/art/vault-poster.jpg" label="Glossy coins drift behind a noren curtain; only a point of light reaches the vault" />
            <figcaption className="mono">The coins go behind the curtain. Only the payment comes out. <span>Film generated with Google Gemini (Veo); Gemini's mark is kept, bottom right.</span></figcaption>
          </figure>
        </div>
      </section>

      {/* ---------------------------------------------------------------- (b) three surfaces */}
      <section className="nx-sec nx-surf" id="surfaces">
        <div className="nx-head" data-reveal>
          <Tag>One product, three surfaces</Tag>
          <h2>One Noren. <span>A dashboard for the shop, an app for the customer, an SDK for the developer.</span></h2>
        </div>
        <div className="nx-surf-grid">
          {SURFACES.map((s, i) => (
            <article key={s.k} className={`nx-surf-card ${s.k}`} data-reveal style={{ transitionDelay: `${i * 80}ms` }}>
              <div className="nx-surf-copy">
                <span className="nx-num mono">0{i + 1}</span>
                <h3>{s.name}</h3>
                <p>{s.line}</p>
                <a className="nx-link mono" href={s.href}>{s.cta} <Icon.arrow /></a>
              </div>
              <figure className={`nx-shot ${s.k === "app" ? "phone" : "browser"}`}>
                {s.k !== "app" && <span className="nx-dots" aria-hidden><i /><i /><i /></span>}
                <img src={s.img} alt={`${s.name}: ${s.cap}`} width={s.w} height={s.h} loading="lazy" />
                <figcaption className="mono">{s.cap} Real capture on Avalanche Fuji.</figcaption>
              </figure>
            </article>
          ))}
        </div>
      </section>

      {/* ---------------------------------------------------------------- (c) consumer powers */}
      <section className="nx-sec nx-powers" id="app">
        <div className="nx-head split" data-reveal>
          <div>
            <Tag>In the Noren app</Tag>
            <h2>Everything your stocks can do. <span>And none of it shows the shop who you are.</span></h2>
          </div>
          <p>Paying with stocks, in 3 or privately all reach the shop as an encrypted eERC payment from Noren’s hub. What stays public is how your private balance was filled: a stock sale, a credit draw or a top-up, in round lots of 50. Paying with tUSDC, swaps and borrowing are public, and the app says so.</p>
        </div>
        <div className="nx-bento">
          {POWERS.map((p, i) => (
            <article key={p.k} className={`nx-pw ${p.k} ${p.tone ?? ""}`} data-reveal style={{ transitionDelay: `${(i % 4) * 60}ms` }}>
              <div className="nx-pw-top">{p.s.map((s) => <Chip key={s} s={s} />)}</div>
              <h3>{p.t}</h3>
              <p>{p.d}</p>
              {p.m && <span className="nx-pw-m mono">{p.m}</span>}
              {p.k === "in3" && <ol className="nx-in3 mono" aria-label="Three equal parts">{["First", "Part 2", "Last"].map((x) => <li key={x}><span>{x}</span><b>4.67</b></li>)}</ol>}
              {p.art && <img className="nx-pw-art" src={p.art} alt={p.alt} width={900} height={900} loading="lazy" />}
            </article>
          ))}
        </div>
        <p className="nx-legend mono"><Chip s="live" /> runs end to end against the real contracts on Avalanche Fuji. <Chip s="relayer" /> real quotes signed by Noren’s relayer and checked on chain. <Chip s="off" /> from Noren at ETHGlobal, not in this edition.</p>
      </section>

      {/* ---------------------------------------------------------------- (d) built with */}
      <section className="nx-built" id="built-with">
        <div className="nx-built-in">
          <div className="nx-head" data-reveal>
            <Tag dark>Built with</Tag>
            <h2>One chain, one job each. <span>eERC hides amounts and payers, the hub batches settlement, the relayer prices stocks, Chainlink prices crypto, Claude reads the books. Each labelled with what runs today.</span></h2>
          </div>
          <ul className="nx-built-list">
            {BUILT.map((b, i) => (
              <li key={b.name} data-reveal style={{ transitionDelay: `${i * 50}ms` }}>
                <b className="nx-built-name"><span className="nx-built-logos">{b.logos.map((l) => <Mark key={l} id={l} size={24} />)}</span>{b.name}</b>
                <p>{b.use}{b.note && <small className="mono">{b.note}</small>}</p>
                <Chip s={b.s} />
              </li>
            ))}
          </ul>
          <div className="nx-built-chains" aria-label="Chain and assets">
            <span><Mark id="AVAX" size={24} /><b>Avalanche Fuji</b><small><span className="nx-chunk"><Mark id="USDC" size={16} /> tUSDC in eERC ·</span><span className="nx-stock-row" aria-hidden>{["NVDA", "TSLA", "AAPL", "MSFT", "SPY"].map((t) => <Mark key={t} id={t} size={16} />)}</span> test stocks</small></span>
          </div>
          <p className="nx-built-foot mono">One chain: Avalanche Fuji (43113). {NYSE.line} ({NYSE.detail}; <a href={NYSE.sources[0][1]} target="_blank" rel="noreferrer">The Block</a>, <a href={NYSE.sources[1][1]} target="_blank" rel="noreferrer">CoinDesk</a>). Logos belong to their owners and are shown only to name each project; no endorsement is implied.</p>
        </div>
      </section>

      {/* ---------------------------------------------------------------- (e) merchant onboarding */}
      <section className="nx-sec nx-onb" id="merchants">
        <figure className="nx-onb-art" data-reveal><img src="/art/iso-merchant.jpg" alt="A laptop shows a merchant dashboard next to a card terminal printing a receipt" width={900} height={900} loading="lazy" /></figure>
        <div>
          <div className="nx-head" data-reveal>
            <Tag>For merchants</Tag>
            <h2>Start taking private payments <em>in three steps.</em></h2>
          </div>
          <ol className="nx-steps">
            {ONBOARD.map(([t, d], i) => (
              <li key={t} data-reveal style={{ transitionDelay: `${i * 80}ms` }}><span className="mono">0{i + 1}</span><div><b>{t}</b><p>{d}</p></div></li>
            ))}
          </ol>
          <a className="lx-btn dark" href="#/dashboard/onboard">Set up your store</a>
        </div>
      </section>

      {/* ---------------------------------------------------------------- (f) SDK */}
      <section className="nx-dev" id="developers">
        <div className="nx-dev-in">
          <div className="nx-dev-copy" data-reveal>
            <Tag dark>Noren SDK</Tag>
            <h2>Get paid in <em>about ten lines.</em></h2>
            <p>A REST API with secret keys and a hosted checkout that feel familiar, and a TypeScript SDK over Ava Labs’ eERC for the private rail. Everything runs on Avalanche.</p>
            <ul className="nx-endpoints mono">
              <li><b>POST</b> /api/invoices</li>
              <li><b>GET</b> /api/invoices/:id</li>
              <li><b>GET</b> /api/stores/:id/invoices</li>
              <li><b>GET</b> /api/stores/:id/events</li>
              <li><b>GET</b> /api/prices</li>
            </ul>
          </div>
          <div className="nx-code" data-reveal>
            <div className="nx-code-tabs" role="tablist" aria-label="SDK examples">
              {(Object.keys(CODE) as (keyof typeof CODE)[]).map((k) => (
                <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className="mono">{k === "link" ? "Create a link" : k === "status" ? "Is it paid?" : "Customer pays"}</button>
              ))}
            </div>
            <div className="nx-code-file mono"><span>{CODE[tab].file}</span><span>TypeScript</span></div>
            <pre className="mono" key={tab} role="tabpanel">{CODE[tab].lines.map(([t, l], i) => <span key={i} className={`ln ${t}`}><i>{i + 1}</i>{l || " "}</span>)}</pre>
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------------- (g) measured */}
      <section className="nx-sec nx-nums" id="numbers">
        <div className="nx-head" data-reveal>
          <Tag>Measured, not promised</Tag>
          <h2>The numbers from our last run. <span>Every one is in TESTING.md with the command that made it.</span></h2>
        </div>
        <div className="nx-num-grid" data-reveal>
          {NUMBERS.map((n) => <div key={n.l}><b>{n.v}{n.u && <em>{n.u}</em>}</b><span>{n.l}</span></div>)}
        </div>
        <p className="nx-note mono">Avalanche Fuji, Nov 13 2026. Every transaction is in deployments/fuji.json and the README, linked to Snowtrace.</p>
      </section>

      {/* ---------------------------------------------------------------- (h) cta */}
      <section className="nx-cta" data-reveal>
        <img src="/art/icon.jpg" alt="" width={640} height={640} loading="lazy" aria-hidden />
        <h2>Open your shop's <em>curtain.</em></h2>
        <p>Open a test wallet, take the starter pack and pay a shop with your stocks in about a minute. No wallet, no AVAX needed.</p>
        <div className="lx-ctas"><a className="lx-btn light" href="#/dashboard">Open Noren Merchant</a><a className="lx-btn dark" href="#/app">Open the Noren app</a></div>
      </section>
    </div>
  );
}
