import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { generateInvoicePdf } from "../../services/pdf.js";
import { generateAnalysisDeck } from "../../services/pptx.js";

// Both tools return a small JSON envelope with a `file` field. The Telegram
// layer (see src/telegram/bot.ts) watches for tool_result messages carrying
// a `file` field and forwards that path to the chat via sendDocument — the
// agent doesn't touch Telegram's API directly, keeping the tool layer
// transport-agnostic (the same tools would work behind a web UI too).

export const generateInvoice = tool(
  "generate_invoice_pdf",
  "Render a finalized bill as a clean, GST-correct PDF invoice.",
  { billId: z.string() },
  async ({ billId }) => {
    const filePath = await generateInvoicePdf(billId);
    return { content: [{ type: "text", text: JSON.stringify({ file: filePath, kind: "invoice" }) }] };
  }
);

export const generateDeck = tool(
  "generate_analysis_deck",
  "Build a PPTX sales-analysis deck (headline numbers, payment split, top items, " +
    "stock health) for a date range, e.g. 'this week', 'today'.",
  {
    fromDate: z.string().describe("ISO date, inclusive"),
    toDate: z.string().describe("ISO date, inclusive"),
  },
  async ({ fromDate, toDate }) => {
    const filePath = await generateAnalysisDeck(new Date(fromDate), new Date(toDate));
    return { content: [{ type: "text", text: JSON.stringify({ file: filePath, kind: "deck" }) }] };
  }
);

export const documentTools = [generateInvoice, generateDeck];
