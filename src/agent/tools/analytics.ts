import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { prisma } from "../../db/client.js";

export const getSalesSummary = tool(
  "get_sales_summary",
  "Summarize finalized sales in a date range — total, tax collected, cash/UPI/card " +
    "split, top items. Use for 'today's sales?' or 'close the day' style queries.",
  { fromDate: z.string().describe("ISO date, inclusive"), toDate: z.string().describe("ISO date, inclusive") },
  async ({ fromDate, toDate }) => {
    const bills = await prisma.bill.findMany({
      where: { status: "FINALIZED", finalizedAt: { gte: new Date(fromDate), lte: new Date(toDate) } },
      include: { items: { include: { product: true } } },
    });

    const total = bills.reduce((s, b) => s + b.total, 0);
    const tax = bills.reduce((s, b) => s + b.cgst + b.sgst, 0);
    const byMode: Record<string, number> = {};
    for (const b of bills) {
      const mode = b.paymentMode ?? "UNKNOWN";
      byMode[mode] = (byMode[mode] ?? 0) + b.total;
    }
    const itemQty: Record<string, number> = {};
    for (const b of bills) for (const it of b.items) itemQty[it.product.name] = (itemQty[it.product.name] ?? 0) + it.qty;
    const topItems = Object.entries(itemQty).sort((a, b) => b[1] - a[1]).slice(0, 5);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ billCount: bills.length, total, tax, byMode, topItems }),
        },
      ],
    };
  }
);

export const analyticsTools = [getSalesSummary];
