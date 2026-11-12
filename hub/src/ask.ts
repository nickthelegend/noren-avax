// The merchant assistant's server half: a thin proxy to Claude that holds the API key and the tool definitions.
//
// The shop's books are decrypted in the browser with the shop's own eERC key, and the tools run there too. Claude
// only ever sees the tool results it asks for (totals, a few order lines), never the key or the whole ledger. The
// browser sends the conversation (with its tool results); this returns Claude's next turn. Each request is checked
// for shape and size, and there is a daily cap on the number of calls.
import Anthropic from '@anthropic-ai/sdk';
import { HttpError } from './gas.ts';

const SYSTEM = `You are Noren's assistant for one shop owner on Noren, a private checkout on Avalanche (Fuji testnet).
Customers pay the shop through Noren's settlement hub; amounts are encrypted on chain and only the shop's key reads
them. The owner's browser decrypted their books and runs your tools locally; their results are the only data you have.

Rules:
- Answer only from tool results. If no tool answers the question, say what you can't see.
- Money is test USDC (tUSDC); write amounts like $24.00. Times are UTC.
- Be brief: one to three short sentences, or a short list. No preamble.
- "This week" means the last 7 days, "today" the last 24 hours, unless the owner says otherwise.`;

const TOOLS: Anthropic.Tool[] = [
  {
    name: 'revenue',
    description: 'Total revenue, order count and average order for a time window, from the decrypted statements. Days are counted back from now.',
    input_schema: {
      type: 'object',
      properties: {
        days: { type: 'number', description: 'How many days back from now (e.g. 7 for this week). Omit for all time.' },
        item: { type: 'string', description: 'Only orders for this item name (case-insensitive substring).' },
      },
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: 'top_items',
    description: 'Items ranked by revenue in a time window.',
    input_schema: {
      type: 'object',
      properties: { days: { type: 'number', description: 'Days back from now; omit for all time.' }, limit: { type: 'number' } },
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: 'recent_orders',
    description: 'The most recent orders: time, item, order id, amount, and the batch that paid them out.',
    input_schema: {
      type: 'object',
      properties: { limit: { type: 'number', description: 'At most 20.' } },
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: 'payouts',
    description: 'Settlement batches that paid this shop: batch id, time, amount, and whether the statement checked out against the decrypted payout and the on-chain digest.',
    input_schema: { type: 'object', properties: { limit: { type: 'number' } }, additionalProperties: false },
    strict: true,
  },
  {
    name: 'balance',
    description: 'The shop’s current private balance (decrypted) and how much it has withdrawn to public tUSDC.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
    strict: true,
  },
];

type Msg = Anthropic.MessageParam;

export class Assistant {
  private client: Anthropic | null;
  private model: string;
  private dailyCap: number;
  private day = '';
  private count = 0;

  constructor(apiKey: string | null, model: string, dailyCap: number) {
    this.client = apiKey ? new Anthropic({ apiKey }) : null;
    this.model = model;
    this.dailyCap = dailyCap;
  }

  get ready() {
    return !!this.client;
  }

  async reply(body: { messages?: unknown }, _ip: string) {
    if (!this.client) throw new HttpError(503, 'Setup required: ANTHROPIC_API_KEY is not set on the Noren API.');
    const messages = validate(body.messages);
    const today = new Date().toISOString().slice(0, 10);
    if (today !== this.day) {
      this.day = today;
      this.count = 0;
    }
    if (++this.count > this.dailyCap) throw new HttpError(429, 'The assistant has answered its share of questions for today. Try again after 00:00 UTC.');
    try {
      const r = await this.client.messages.create({
        model: this.model,
        max_tokens: 1024,
        system: SYSTEM,
        tools: TOOLS,
        output_config: { effort: 'low' },
        messages,
      });
      if (r.stop_reason === 'refusal') return { stop_reason: 'refusal', content: [{ type: 'text', text: 'I can’t help with that one.' }] };
      return { stop_reason: r.stop_reason, content: r.content.filter((b) => b.type === 'text' || b.type === 'tool_use') };
    } catch (e) {
      if (e instanceof Anthropic.RateLimitError) throw new HttpError(429, 'The assistant is busy; try again in a minute.');
      if (e instanceof Anthropic.AuthenticationError) throw new HttpError(503, 'Setup required: the Noren API’s Anthropic key was refused.');
      if (e instanceof Anthropic.APIError) throw new HttpError(502, `Claude returned an error (${e.status ?? 'network'}).`);
      throw e;
    }
  }
}

const TOOL_NAMES = new Set(TOOLS.map((t) => t.name));

function validate(v: unknown): Msg[] {
  if (!Array.isArray(v) || v.length === 0 || v.length > 24) throw new HttpError(400, 'messages must be a list of 1 to 24 turns');
  if (JSON.stringify(v).length > 48_000) throw new HttpError(413, 'conversation too long; start a new one');
  const out: Msg[] = [];
  for (const m of v as { role?: unknown; content?: unknown }[]) {
    if (m.role !== 'user' && m.role !== 'assistant') throw new HttpError(400, 'each turn needs role user or assistant');
    if (typeof m.content === 'string') {
      out.push({ role: m.role, content: m.content.slice(0, 2_000) });
      continue;
    }
    if (!Array.isArray(m.content)) throw new HttpError(400, 'content must be text or blocks');
    const blocks = m.content.map((b: Record<string, unknown>) => {
      if (b.type === 'text' && typeof b.text === 'string') return { type: 'text' as const, text: b.text.slice(0, 4_000) };
      if (m.role === 'assistant' && b.type === 'tool_use' && typeof b.id === 'string' && TOOL_NAMES.has(String(b.name)))
        return { type: 'tool_use' as const, id: b.id, name: String(b.name), input: (b.input ?? {}) as Record<string, unknown> };
      if (m.role === 'user' && b.type === 'tool_result' && typeof b.tool_use_id === 'string')
        return { type: 'tool_result' as const, tool_use_id: b.tool_use_id, content: String(b.content ?? '').slice(0, 6_000), is_error: b.is_error === true };
      throw new HttpError(400, 'unsupported content block');
    });
    out.push({ role: m.role, content: blocks } as Msg);
  }
  if (out[0]!.role !== 'user') throw new HttpError(400, 'the conversation must start with the owner');
  return out;
}
