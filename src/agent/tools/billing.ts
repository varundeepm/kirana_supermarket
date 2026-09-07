import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { prisma } from "../../db/client.js";
import { computeLineTax, computeBillTax } from "../../services/gst.js";

// A "draft" is just the most recent non-finalized Bill row for this chat.
// Multi-turn bill building = the model calling add/remove repeatedly against
// the same draft before finalize — no in-memory session state needed, the
// DB row *is* the state, so it survives a bot restart mid-bill.
async function getOrCreateDraft(chatId: string) {
  const existing = await prisma.bill.findFirst({
    where: { chatId, status: "DRAFT" },
    orderBy: { createdAt: "desc" },
  });
  if (existing) return existing;
  return prisma.bill.create({ data: { chatId, status: "DRAFT" } });
}

export const addBillItem = tool(
  "add_bill_item",
  "Add a line item to the bill currently being built in this chat (creates the " +
    "draft bill if this is the first item). Snapshots today's price and GST rate " +
    "onto the line so later price changes don't retroactively alter an open bill. " +
    "Refuses if the quantity exceeds what's currently in stock.",
  {
    chatId: z.string(),
    productId: z.string().describe("id from find_product"),
    qty: z.number().positive(),
  },
  async ({ chatId, productId, qty }) => {
    const product = await prisma.product.findUnique({ where: { id: productId } });
    if (!product) throw new Error(`No product with id ${productId}`);
    if (qty > product.stockQty) {
      throw new Error(
        `Only ${product.stockQty} ${product.unit} of ${product.name} in stock — ` +
          `can't add ${qty}. Ask the owner to reduce the quantity or drop the item.`
      );
    }

    const draft = await getOrCreateDraft(chatId);
    const tax = computeLineTax(qty, product.sellPrice, product.gstRate);

    const item = await prisma.billItem.create({
      data: {
        billId: draft.id,
        productId,
        qty,
        unitPrice: product.sellPrice,
        gstRate: product.gstRate,
        ...tax,
      },
    });
    return { content: [{ type: "text", text: JSON.stringify({ draftBillId: draft.id, item }) }] };
  }
);

export const removeBillItem = tool(
  "remove_bill_item",
  "Remove a line item from the current draft bill (e.g. 'drop the butter').",
  { billItemId: z.string() },
  async ({ billItemId }) => {
    await prisma.billItem.delete({ where: { id: billItemId } });
    return { content: [{ type: "text", text: "removed" }] };
  }
);

export const updateBillItemQty = tool(
  "update_bill_item_qty",
  "Change the quantity of an existing line item (e.g. 'make it 6 Maggi'). Recomputes tax for that line.",
  { billItemId: z.string(), qty: z.number().positive() },
  async ({ billItemId, qty }) => {
    const item = await prisma.billItem.findUnique({ where: { id: billItemId }, include: { product: true } });
    if (!item) throw new Error(`No bill item ${billItemId}`);
    if (qty > item.product.stockQty) {
      throw new Error(`Only ${item.product.stockQty} ${item.product.unit} of ${item.product.name} in stock.`);
    }
    const tax = computeLineTax(qty, item.unitPrice, item.gstRate);
    const updated = await prisma.billItem.update({ where: { id: billItemId }, data: { qty, ...tax } });
    return { content: [{ type: "text", text: JSON.stringify(updated) }] };
  }
);

export const viewDraftBill = tool(
  "view_draft_bill",
  "Show the current draft bill for this chat — items, running subtotal, GST breakup, total.",
  { chatId: z.string() },
  async ({ chatId }) => {
    const draft = await prisma.bill.findFirst({
      where: { chatId, status: "DRAFT" },
      include: { items: { include: { product: true } } },
      orderBy: { createdAt: "desc" },
    });
    if (!draft) return { content: [{ type: "text", text: "No draft bill in progress." }] };
    const tax = computeBillTax(draft.items);
    return { content: [{ type: "text", text: JSON.stringify({ ...draft, ...tax }) }] };
  }
);

export const setBillPayment = tool(
  "set_bill_payment",
  "Set how the current draft bill will be paid. Use CREDIT to put it on a customer's khata " +
    "(requires customerId — resolve/create the customer first).",
  {
    chatId: z.string(),
    paymentMode: z.enum(["CASH", "UPI", "CARD", "CREDIT"]),
    paymentRef: z.string().optional(),
    customerId: z.string().optional(),
  },
  async ({ chatId, paymentMode, paymentRef, customerId }) => {
    if (paymentMode === "CREDIT" && !customerId) {
      throw new Error("CREDIT requires a customerId — find or create the customer first.");
    }
    const draft = await getOrCreateDraft(chatId);
    const updated = await prisma.bill.update({
      where: { id: draft.id },
      data: { paymentMode, paymentRef, customerId },
    });
    return { content: [{ type: "text", text: JSON.stringify(updated) }] };
  }
);

class OversellError extends Error {}

export const finalizeBill = tool(
  "finalize_bill",
  "Lock in the current draft bill: atomically decrements stock (refusing if anything " +
    "would go negative), computes final GST totals, and — if paid on CREDIT — posts the " +
    "amount to the customer's khata. Idempotent: calling it twice with the same " +
    "idempotencyKey returns the same finalized bill instead of double-billing.",
  {
    chatId: z.string(),
    idempotencyKey: z.string().describe("stable per logical 'finalize' request, e.g. the Telegram update id"),
  },
  async ({ chatId, idempotencyKey }) => {
    const byKey = await prisma.bill.findUnique({ where: { idempotencyKey } });
    if (byKey) {
      return { content: [{ type: "text", text: JSON.stringify({ alreadyFinalized: true, bill: byKey }) }] };
    }

    const draft = await prisma.bill.findFirst({
      where: { chatId, status: "DRAFT" },
      include: { items: true },
      orderBy: { createdAt: "desc" },
    });
    if (!draft) throw new Error("No draft bill to finalize.");
    if (draft.items.length === 0) throw new Error("Draft bill has no items.");
    if (draft.paymentMode === "CREDIT" && !draft.customerId) {
      throw new Error("Bill is set to CREDIT but has no customer attached.");
    }

    try {
      const finalized = await prisma.$transaction(async (tx) => {
        // Atomic, per-item oversell guard: the WHERE clause only matches
        // (and decrements) if enough stock is *still* there right now —
        // safe even if another bill/stock-in raced in between add and
        // finalize.
        for (const item of draft.items) {
          const result = await tx.product.updateMany({
            where: { id: item.productId, stockQty: { gte: item.qty } },
            data: { stockQty: { decrement: item.qty } },
          });
          if (result.count === 0) {
            const p = await tx.product.findUnique({ where: { id: item.productId } });
            throw new OversellError(
              `Not enough stock for ${p?.name ?? item.productId}: ` +
                `only ${p?.stockQty ?? 0} left, bill needs ${item.qty}.`
            );
          }
        }

        const tax = computeBillTax(draft.items);

        const bill = await tx.bill.update({
          where: { id: draft.id },
          data: {
            status: "FINALIZED",
            finalizedAt: new Date(),
            idempotencyKey,
            subtotal: tax.subtotal,
            cgst: tax.cgst,
            sgst: tax.sgst,
            roundOff: tax.roundOff,
            total: tax.total,
          },
          include: { items: { include: { product: true } } },
        });

        if (bill.paymentMode === "CREDIT" && bill.customerId) {
          await tx.khataTransaction.create({
            data: {
              customerId: bill.customerId,
              type: "CREDIT",
              amount: tax.total,
              note: `Bill ${bill.id}`,
            },
          });
        }

        return bill;
      });

      return { content: [{ type: "text", text: JSON.stringify({ alreadyFinalized: false, bill: finalized }) }] };
    } catch (err) {
      if (err instanceof OversellError) {
        // Surface as a normal tool error — the model relays it and asks
        // the owner to adjust the bill. Nothing was decremented (the
        // transaction rolled back).
        throw new Error(err.message);
      }
      throw err;
    }
  }
);

export const billingTools = [
  addBillItem,
  removeBillItem,
  updateBillItemQty,
  viewDraftBill,
  setBillPayment,
  finalizeBill,
];
