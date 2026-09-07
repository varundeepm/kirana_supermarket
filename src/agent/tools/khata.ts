import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { prisma } from "../../db/client.js";

async function computeBalance(customerId: string): Promise<number> {
  const entries = await prisma.khataTransaction.findMany({ where: { customerId } });
  return entries.reduce((bal, e) => bal + (e.type === "CREDIT" ? e.amount : -e.amount), 0);
}

export const findCustomer = tool(
  "find_customer",
  "Look up a customer by name fragment. If no match is found, automatically create " +
    "a new customer with that name and return their new record. Never ask the owner " +
    "for confirmation — just open a fresh ledger page like a real kirana would.",
  { query: z.string() },
  async ({ query }) => {
    const matches = await prisma.customer.findMany({
      where: { name: { contains: query, mode: "insensitive" } },
      take: 5,
    });
    if (matches.length > 0) {
      return { content: [{ type: "text", text: JSON.stringify(matches) }] };
    }
    // Auto-create — no confirmation needed
    const created = await prisma.customer.create({ data: { name: query } });
    return { content: [{ type: "text", text: JSON.stringify([{ ...created, _created: true }]) }] };
  }
);

export const createCustomer = tool(
  "create_customer",
  "Create a new khata customer. Only call this after find_customer came back empty " +
    "and the owner confirmed they want a new entry.",
  { name: z.string(), phone: z.string().optional() },
  async ({ name, phone }) => {
    const customer = await prisma.customer.create({ data: { name, phone } });
    return { content: [{ type: "text", text: JSON.stringify(customer) }] };
  }
);

export const postKhataCredit = tool(
  "post_khata_credit",
  "Put an amount on a customer's credit directly (not tied to a bill) — " +
    "e.g. 'put ₹500 on Ramesh's credit'.",
  { customerId: z.string(), amount: z.number().positive(), note: z.string().optional() },
  async ({ customerId, amount, note }) => {
    const customer = await prisma.customer.findUnique({ where: { id: customerId } });
    if (!customer) throw new Error(`No customer with id ${customerId} — refusing to post to a khata that doesn't exist.`);

    await prisma.khataTransaction.create({ data: { customerId, type: "CREDIT", amount, note } });
    const balance = await computeBalance(customerId);
    return { content: [{ type: "text", text: JSON.stringify({ customer: customer.name, balance }) }] };
  }
);

export const postKhataPayment = tool(
  "post_khata_payment",
  "Record a customer settling (part of) their khata — e.g. 'Ramesh paid ₹300'. " +
    "Refuses for an unknown customer; flags (but does not block) an overpayment " +
    "beyond the current balance so the owner can confirm it's intentional.",
  { customerId: z.string(), amount: z.number().positive(), note: z.string().optional() },
  async ({ customerId, amount, note }) => {
    const customer = await prisma.customer.findUnique({ where: { id: customerId } });
    if (!customer) throw new Error(`No customer with id ${customerId} — refusing to settle a khata that doesn't exist.`);

    const balanceBefore = await computeBalance(customerId);
    await prisma.khataTransaction.create({ data: { customerId, type: "PAYMENT", amount, note } });
    const balanceAfter = await computeBalance(customerId);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            customer: customer.name,
            balanceBefore,
            balanceAfter,
            overpaid: amount > balanceBefore,
          }),
        },
      ],
    };
  }
);

export const getKhataBalance = tool(
  "get_khata_balance",
  "Get a customer's current outstanding khata balance.",
  { customerId: z.string() },
  async ({ customerId }) => {
    const customer = await prisma.customer.findUnique({ where: { id: customerId } });
    if (!customer) throw new Error(`No customer with id ${customerId}`);
    const balance = await computeBalance(customerId);
    return { content: [{ type: "text", text: JSON.stringify({ customer: customer.name, balance }) }] };
  }
);

export const getKhataHistory = tool(
  "get_khata_history",
  "List all khata transactions for a customer (credits and payments), newest first, " +
    "with a running balance. Use for 'show all of Ramesh's transactions' queries.",
  { customerId: z.string(), limit: z.number().int().positive().default(20) },
  async ({ customerId, limit }) => {
    const customer = await prisma.customer.findUnique({ where: { id: customerId } });
    if (!customer) throw new Error(`No customer with id ${customerId}`);

    const entries = await prisma.khataTransaction.findMany({
      where: { customerId },
      orderBy: { createdAt: "desc" },
      take: limit,
    });

    // Compute running balance from oldest → newest, then reverse for display
    const allEntries = await prisma.khataTransaction.findMany({
      where: { customerId },
      orderBy: { createdAt: "asc" },
    });
    let running = 0;
    const balanceMap: Record<string, number> = {};
    for (const e of allEntries) {
      running += e.type === "CREDIT" ? e.amount : -e.amount;
      balanceMap[e.id] = running;
    }

    const rows = entries.map((e) => ({
      id: e.id,
      type: e.type,
      amount: e.amount,
      note: e.note,
      balanceAfter: balanceMap[e.id] ?? 0,
      date: e.createdAt,
    }));

    const currentBalance = await computeBalance(customerId);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ customer: customer.name, currentBalance, transactions: rows }),
        },
      ],
    };
  }
);

export const khataTools = [findCustomer, createCustomer, postKhataCredit, postKhataPayment, getKhataBalance, getKhataHistory];
