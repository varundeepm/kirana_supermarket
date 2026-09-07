import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { prisma } from "../../db/client.js";
import { findProducts } from "../../services/catalog.js";
import { assertValidSlab } from "../../services/gst.js";

const UNITS = ["kg", "g", "l", "ml", "packet", "dozen", "piece"] as const;

export const findProduct = tool(
  "find_product",
  "Search the product catalog by name/brand/SKU fragment (e.g. 'atta', 'maggi'). " +
    "Always call this before quoting a price, SKU, GST rate or stock level — never " +
    "answer those from memory. Returns 0, 1, or several matches; if several, ask the " +
    "owner which one they mean instead of guessing.",
  { query: z.string().describe("free-text search, e.g. 'atta' or 'amul butter'") },
  async ({ query }) => {
    const matches = await findProducts(query);
    return { content: [{ type: "text", text: JSON.stringify(matches) }] };
  }
);

export const addProduct = tool(
  "add_product",
  "Add a brand-new SKU to the catalog. Fails if a product with the same SKU already " +
    "exists — use receive_stock to top up an existing product instead.",
  {
    name: z.string(),
    brand: z.string().optional(),
    sku: z.string().describe("short unique code; derive one from the name if the owner didn't give one"),
    hsnCode: z.string(),
    gstRate: z.number().describe("0, 5, 12, 18 or 28"),
    unit: z.enum(UNITS),
    isLoose: z.boolean().default(false),
    costPrice: z.number().nonnegative(),
    sellPrice: z.number().nonnegative(),
    reorderLevel: z.number().nonnegative().default(0),
    initialStockQty: z.number().nonnegative().default(0),
  },
  async (args) => {
    assertValidSlab(args.gstRate);
    if (args.sellPrice < args.costPrice) {
      throw new Error(
        `Refusing: sell price (₹${args.sellPrice}) is below cost price (₹${args.costPrice}). ` +
          `Confirm with the owner if this is intentional before retrying.`
      );
    }
    const existing = await prisma.product.findUnique({ where: { sku: args.sku } });
    if (existing) throw new Error(`SKU ${args.sku} already exists (${existing.name}).`);

    const product = await prisma.product.create({
      data: {
        name: args.name,
        brand: args.brand,
        sku: args.sku,
        hsnCode: args.hsnCode,
        gstRate: args.gstRate,
        unit: args.unit,
        isLoose: args.isLoose,
        costPrice: args.costPrice,
        sellPrice: args.sellPrice,
        reorderLevel: args.reorderLevel,
        stockQty: args.initialStockQty,
      },
    });
    return { content: [{ type: "text", text: JSON.stringify(product) }] };
  }
);

export const receiveStock = tool(
  "receive_stock",
  "Record stock coming into the shop for an existing product (a delivery/purchase). " +
    "Increments stock and logs a StockIn entry. Also updates the product's current " +
    "cost/sell price if a new one is given (prices drift over time).",
  {
    productId: z.string().describe("id from find_product — never invent one"),
    qty: z.number().positive(),
    costPrice: z.number().nonnegative().optional(),
    mrp: z.number().nonnegative().optional(),
  },
  async ({ productId, qty, costPrice, mrp }) => {
    const result = await prisma.$transaction(async (tx) => {
      const product = await tx.product.findUnique({ where: { id: productId } });
      if (!product) throw new Error(`No product with id ${productId}`);

      await tx.stockIn.create({
        data: {
          productId,
          qty,
          costPrice: costPrice ?? product.costPrice,
          mrp: mrp ?? product.sellPrice,
        },
      });

      return tx.product.update({
        where: { id: productId },
        data: {
          stockQty: { increment: qty },
          ...(costPrice !== undefined ? { costPrice } : {}),
          ...(mrp !== undefined ? { sellPrice: mrp } : {}),
        },
      });
    });
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

export const getLowStock = tool(
  "get_low_stock",
  "List products at or below their reorder level — for 'what's running out?' style queries.",
  {},
  async () => {
    // Prisma can't compare two columns directly in a simple where clause,
    // so filter in JS — fine at kirana catalog scale (dozens-hundreds of SKUs).
    const all = await prisma.product.findMany();
    const low = all.filter((p) => p.stockQty <= p.reorderLevel);
    return { content: [{ type: "text", text: JSON.stringify(low) }] };
  }
);

export const inventoryTools = [findProduct, addProduct, receiveStock, getLowStock];
