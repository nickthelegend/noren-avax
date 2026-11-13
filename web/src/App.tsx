import { useEffect, useState } from "react";
import { Landing } from "./Landing";
import { Dashboard } from "./Dashboard";
import { Checkout } from "./Checkout";
import { NorenApp } from "./app/NorenApp";
import { Auditor } from "./Auditor";
import { Icon, Logo, useRoute } from "./ui";

/** noren-avax-merchant.vercel.app is the same build; its front door is Noren Merchant. */
const MERCHANT_HOST = /merchant/.test(location.hostname);

export function App() {
  const route = useRoute();
  if (route.page === "dashboard") return <Dashboard tab={route.tab} sub={route.sub} />;
  // Keyed by the whole hash so an app handoff (#/pay/<id>?m=stocks) always starts on the chosen method.
  if (route.page === "pay") return <Checkout key={location.hash} id={route.id} />;
  if (route.page === "app") return <NorenApp />;
  if (route.page === "auditor") return <Auditor />;
  if (MERCHANT_HOST) return <Dashboard tab="home" />;
  return <Site />;
}

function Site() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => { const on = () => setScrolled(scrollY > 24); on(); addEventListener("scroll", on, { passive: true }); return () => removeEventListener("scroll", on); }, []);
  return (
    <div className="site">
      <header className={`site-nav ${scrolled ? "solid" : ""}`}>
        <a className="site-brand" href="#/"><Logo /><span>Noren</span></a>
        <nav className="mono">
          <a href="#/" className="hide-s">Home</a>
          <a href="#developers" className="hide-s">Developers</a>
          <a href="#/app" className="hide-s">Noren app</a>
          <a href="#/dashboard">Noren Merchant</a>
        </nav>
        <a className="lx-btn light sm" href="#/dashboard">Start <Icon.arrow /></a>
      </header>
      <Landing />
      <footer className="site-foot">
        <div className="site-brand"><Logo /><span>Noren</span></div>
        <p>Private payments on Avalanche, built on Ava Labs’ EncryptedERC (eERC). MIT licensed.</p>
        <p className="faint">Test mode: Avalanche Fuji testnet, test tokens only. No real funds.</p>
      </footer>
    </div>
  );
}
