# Kirana Ops Agent

A **Telegram-native AI agent** that runs a small Indian kirana (grocery) store entirely through natural-language chat — no admin panel, no command menu. The chat *is* the product.

> **Live bot:** `@sharma_kirana_5bot` &nbsp;·&nbsp; Open [Telegram Web](https://web.telegram.org) and search for it.

---

## What it can do

| Capability | Example phrase |
|---|---|
| 📦 Receive stock | "50 packets of Maggi came in, cost ₹12, MRP ₹14" |
| ➕ Add new SKU | "New item: Amul Butter 100g, GST 12%, MRP ₹62" |
| 🧾 Multi-item bill with GST | "Make a bill: 2kg sugar, 1 Aashirvaad atta 5kg, 4 Maggi, 1 Amul butter, UPI" |
| ✏️ Edit bill mid-build | "Drop the butter, make it 6 Maggi" |
| ✅ Finalize (atomic stock decrement) | "Finalize — UPI" |
| 🚫 Oversell guard | Selling more than stock → agent refuses, explains shortfall |
| 📊 Stock query | "How much sugar is left?" |
| ⚠️ Low-stock alerts | "What's running out?" |
| 📖 Khata / credit ledger | "Put ₹500 on Ramesh's credit" · "Ramesh paid ₹300" |
| 📅 Daily close | "Close the day — total, tax, cash vs UPI, top items" |
| 📄 PDF Tax Invoice | "Send me that bill as a PDF" |
| 📊 PPTX analysis deck | "Make this week's sales deck" |
| 🧠 Persistent preferences | "Always assume UPI" · "Default atta = Aashirvaad 5kg" |
| ❓ Ambiguity clarification | "Add atta" → model asks *which one* |

---

## Architecture

```
Telegram message
      │
      ▼
  grammY bot (src/telegram/)
      │  idempotency check — TelegramUpdateLog(updateId UNIQUE)
      │  runTurn(chatId, text)
      ▼
  Claude Agent SDK  (@anthropic-ai/claude-agent-sdk)
      │   query({ systemPrompt, prompt, resume: sdkSessionId, mcpServers })
      │   multi-turn: observe → reason → tool call → feed result → continue
      ▼
  In-process MCP server  (6 modules, 18 tools)
      │
      ├── inventory    findProduct · addProduct · receiveStock · getLowStock
      ├── billing      addBillItem · removeBillItem · updateBillItemQty ·
      │                viewDraftBill · setBillPayment · finalizeBill (DB tx)
      ├── khata        findCustomer · createCustomer · postKhataCredit ·
      │                postKhataPayment · getKhataBalance · getKhataHistory
      ├── analytics    getSalesSummary  (date-range, tax, payment split, top items)
      ├── documents    generateInvoicePdf · generateAnalysisDeck
      └── preferences  setPreference · getPreferences
              │
              ▼
         SQLite + Prisma ORM
         Products · StockIns · Bills · BillItems
         Customers · KhataTransactions · Preferences
         ChatSessions · TelegramUpdateLog
```

---

## Harness choice — Claude Agent SDK

The project uses **`@anthropic-ai/claude-agent-sdk`** (`query()` + `createSdkMcpServer()`).

**Why:**
- **In-process MCP server** — zero network hop between Claude and the tools. Tools run in the same Node.js process; no HTTP server to maintain.
- **`query()` streams a complete agent turn** — the SDK handles the observe → reason → act → feed-result → continue loop internally. A single `await query(...)` covers "make a bill, then finalize, then generate an invoice" as one agentic sequence.
- **`resume:` parameter** — the SDK assigns a session ID that we persist in SQLite. On the next Telegram message we pass `resume: storedSessionId` and the conversation continues mid-bill across bot restarts.
- **`permissionMode: "bypassPermissions"`** is safe here because the only tools exposed are our own `kirana::` MCP tools — no filesystem or shell surface.
- **Gemini fallback** — a secondary `geminiRunner.ts` drives the same 18 tools via the Gemini function-calling API, used when the Anthropic key isn't available.

---

## Control loop

```
Telegram update arrives
    │
    └─ idempotency check (TelegramUpdateLog) ─── duplicate? → skip
         │
         └─ load chat session (SQLite) → get sdkSessionId + standing preferences
              │
              └─ build systemPrompt (hard rules + preferences injected at top)
                   │
                   └─ Claude Agent SDK query()
                        │ loops internally until no more tool calls
                        │ each tool call → MCP dispatch → Prisma → result fed back
                        │
                        └─ stream.finalText → Telegram sendMessage
                             │
                             └─ stream.files? → Telegram sendDocument (PDF / PPTX)
```

---

## Tool / skill design

Each tool is a pure function: it receives validated Zod arguments, does one thing against Prisma, returns JSON. The model sees the JSON and narrates the outcome. No business logic lives in the prompt.

| Hard part | Tool design solution |
|---|---|
| **Multi-turn bill** | `Bill` row in DB with `status: DRAFT`. Items added/removed across messages. Stock untouched until `finalizeBill`. |
| **Oversell race** | `finalizeBill` runs `$transaction([...updateMany WHERE stockQty >= qty])` — if any line fails the whole bill rolls back. |
| **Telegram redelivery** | `TelegramUpdateLog(updateId UNIQUE)` — first writer wins; duplicate updates never reach the agent. |
| **Session resume** | SDK's `session_id` from the stream is stored in `ChatSession.sdkSessionId`; passed as `resume:` on next turn. |
| **Persistent memory** | Preferences stored in `Preference` table. Injected at top of every `systemPrompt` — survives `/new` and restarts. |
| **GST correctness** | `services/gst.ts` computes CGST/SGST from the base amount (not two independent halves), stores round-off, prints on invoice. |
| **Sell-below-cost** | `addProduct` throws if `sellPrice < costPrice`; surfaced to owner by model. |
| **Ambiguity** | No hardcoded branches. If both "loose atta" and "Aashirvaad atta" exist, model calls `findProduct("atta")`, gets two results, and asks the owner to pick — entirely model-driven. |
| **Khata auto-create** | `findCustomer` auto-creates on first mention (like opening a new ledger page). No friction for first-time customers. |
| **Document generation** | PDF via PDFKit (A5 Tax Invoice with per-line GST table). PPTX via PptxGenJS (5-slide dark deck, real charts from sales data). Both returned as `{file, kind}` from MCP → Telegram layer sends as document. |

---

## How to run locally

### Prerequisites
- Node.js ≥ 18
- Telegram bot token from [@BotFather](https://t.me/BotFather)
- Anthropic API key from [console.anthropic.com](https://console.anthropic.com) *(Claude Pro / Max or API access)*

### Setup
```bash
git clone https://github.com/varundeepm/kirana_supermarket
cd kirana_supermarket
npm install
cp .env.example .env
# fill in ANTHROPIC_API_KEY and TELEGRAM_BOT_TOKEN in .env
npm run setup    # prisma generate + migrate + seed (9 SKUs)
npm run dev      # tsx watch — hot reloads
```

Send any message to your bot and start talking.

### Telegram commands
| Command | What it does |
|---|---|
| `/help` | Example phrases |
| `/new` | Reset session + void open draft (preferences survive) |

---

## Seeded catalog (9 SKUs)

| Name | HSN | GST | Unit |
|---|---|---|---|
| Aashirvaad Atta 5kg | 1101 | 0% | packet |
| Tata Salt 1kg | 2501 | 0% | packet |
| Amul Butter 100g | 0405 | 12% | packet |
| Fortune Sunflower Oil 1L | 1512 | 5% | l |
| Maggi 70g | 1902 | 18% | packet |
| Parle-G 100g | 1905 | 18% | packet |
| Surf Excel 500g | 3402 | 18% | packet |
| Sugar (loose) | 1701 | 5% | kg |
| Toor Dal (loose) | 0713 | 0% | kg |

---

## PPTX Analysis Deck (5 slides)

| Slide | Content |
|---|---|
| 1 — Headline Numbers | Total sales, net revenue, GST collected, bill count + payment table |
| 2 — Payment Split | Pie chart: Cash vs UPI vs Card by ₹ value |
| 3 — Top Items (Qty) | Horizontal bar chart: top 8 SKUs by quantity sold |
| 4 — GST Breakdown | CGST/SGST totals + top items by revenue bar chart |
| 5 — Stock Health | Table: products at/below reorder level with OUT/LOW status |

---

## What I'd improve with more time

- **Switch to PostgreSQL** — SQLite works for single-instance but Postgres is needed for multiple concurrent Telegram users. Schema swap is one `datasource` change in `schema.prisma`.
- **Voice input** — Telegram sends voice notes; Whisper transcription → same agent.
- **Multi-shop** — replace `chatId` with `shopId`; one agent instance could serve many store owners.
- **Streaming replies** — stream bill lines as they're built rather than one big message at the end.
- **Claude computer-use for web UI** — the same MCP tools could back a browser-based dashboard with zero extra code.

---

## Tech stack

| Layer | Tech |
|---|---|
| AI agent | `@anthropic-ai/claude-agent-sdk` (Claude Code SDK) + Gemini fallback |
| Tools | In-process MCP server via `createSdkMcpServer` (18 tools, 6 modules) |
| Telegram | grammY |
| DB / ORM | SQLite + Prisma (swap to Postgres for prod) |
| PDF | PDFKit — A5 Tax Invoice with ₹ symbols |
| PPTX | PptxGenJS — 5-slide dark-themed deck with real charts |
| Validation | Zod |
| Runtime | Node.js 22 / TypeScript / ESM |

---

## Production deployment (Railway / Render / Fly)

1. Swap `schema.prisma` datasource from `sqlite` → `postgresql`
2. Set `DATABASE_URL` to your Postgres URL
3. `npx prisma migrate deploy && npx prisma db seed`
4. Deploy with `npm start`
