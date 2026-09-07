import { Bot, InputFile } from "grammy";
import { prisma } from "../db/client.js";
import { runTurn, resetSession } from "../agent/index.js";

export function createBot(token: string) {
  const bot = new Bot(token);

  // /new — reset session for this chat so the next
  // message starts a fresh conversation (while preserving standing preferences,
  // which live in the Preference table and are re-loaded on every turn).
  bot.command("new", async (ctx) => {
    const chatId = String(ctx.chat.id);
    resetSession(chatId);
    const deleted = await prisma.chatSession.deleteMany({ where: { chatId } });
    // Also void any open draft bill so the owner isn't locked to a half-built bill
    await prisma.bill.updateMany({
      where: { chatId, status: "DRAFT" },
      data: { status: "VOID" },
    });
    const msg =
      deleted.count > 0
        ? "✅ Fresh start — new session, any draft bill cleared. Your saved preferences still apply."
        : "✅ No active session — you're already starting fresh.";
    await ctx.reply(msg);
  });

  // /help — quick command reference
  bot.command("help", async (ctx) => {
    await ctx.reply(
      `*Kirana Ops Agent* 🛒\n\n` +
        `Just chat naturally — no command menu needed.\n\n` +
        `*Stock & Products:*\n` +
        `• "Got 20 packets of Maggi at ₹12 each"\n` +
        `• "New item: Amul Gold 500ml, GST 12%, MRP ₹30"\n` +
        `• "How much sugar is left?"\n` +
        `• "What's running out?"\n\n` +
        `*Billing:*\n` +
        `• "Bill: 3 Maggi, 2 Parle-G, 1 Tata Salt"\n` +
        `• "Drop the salt, make Maggi 5"\n` +
        `• "Finalize — UPI payment"\n` +
        `• "Send invoice for the last bill"\n\n` +
        `*Khata (Credit):*\n` +
        `• "Put ₹500 on Ramesh's credit"\n` +
        `• "Ramesh paid ₹300"\n` +
        `• "What's Ramesh's balance?"\n` +
        `• "Show all of Ramesh's transactions"\n\n` +
        `*Reports & Analysis:*\n` +
        `• "Today's sales summary"\n` +
        `• "This week's analysis deck"\n\n` +
        `*Preferences:*\n` +
        `• "Always assume UPI unless I say cash"\n` +
        `• "My shop name is Sharma Kirana Store"\n\n` +
        `/new — fresh conversation (preferences kept)\n` +
        `/help — this message`,
      { parse_mode: "Markdown" }
    );
  });

  bot.on("message:text", async (ctx) => {
    const updateId = ctx.update.update_id;

    // Idempotency gate: Telegram redelivers updates it didn't get an ack for
    // in time. This is a check-then-insert on a unique key — the *first*
    // writer wins; anything else, including a genuine race between two
    // deliveries, is a duplicate and gets skipped before the agent (and
    // therefore before finalize_bill) ever sees it.
    try {
      await prisma.telegramUpdateLog.create({ data: { updateId } });
    } catch {
      return; // already processed this update_id — skip silently
    }

    const chatId = String(ctx.chat.id);

    // Keep the "typing…" indicator alive throughout the agent turn.
    // grammY's ctx.replyWithChatAction only fires once; we poll every 4 s.
    await ctx.replyWithChatAction("typing");
    const typingInterval = setInterval(() => {
      ctx.replyWithChatAction("typing").catch(() => {});
    }, 4000);

    try {
      const { text, files } = await runTurn(chatId, ctx.message.text);
      clearInterval(typingInterval);

      if (text) await ctx.reply(text);
      for (const f of files) {
        await ctx.replyWithDocument(new InputFile(f.file));
      }
    } catch (err: any) {
      clearInterval(typingInterval);
      console.error("agent turn failed:", err);

      // Surface a friendly message; reveal the raw error only in dev.
      const isDev = process.env.NODE_ENV !== "production";
      const userMsg = isDev
        ? `⚠️ Something went wrong:\n${err.message ?? err}`
        : "⚠️ Something went wrong on my end — please try again.";
      await ctx.reply(userMsg);
    }
  });

  return bot;
}
