// How Aubelle added Noren: this file is the whole integration.
const NOREN = process.env.NOREN_API ?? 'https://noren-avax-api.201-18-198-162.sslip.io';
const KEY = process.env.NOREN_SECRET_KEY;   // the store's secret key, server-side only

async function noren(path: string, init?: RequestInit) {
  const r = await fetch(`${NOREN}/api${path}`, { ...init, headers: { 'content-type': 'application/json', authorization: `Bearer ${KEY}` } });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(body.error ?? `Noren answered HTTP ${r.status}`), { status: r.status });
  return body;
}

// 1. "Checkout with Noren": invoice the bag, redirect to hosted checkout.
type Order = { id: string; totalCents: number; summary: string };
export async function createCheckout(order: Order, shopUrl: string, lines: string) {
  const invoice = await noren('/invoices', { method: 'POST', body: JSON.stringify({
    amountCents: order.totalCents,          // eERC on Avalanche keeps cents
    description: order.summary,
    metadata: { order: order.id, lines },     // the bag, so the order page can show it
    successUrl: `${shopUrl}/#/order/${order.id}`,
    cancelUrl: `${shopUrl}/#/bag`,
  }) });
  return { invoiceId: String(invoice.id), url: String(invoice.url) };
}

// 2. The order page asks Noren, never the browser, whether the bag was paid.
export async function readInvoice(id: string) {
  return noren(`/invoices/${encodeURIComponent(id)}`);
}
