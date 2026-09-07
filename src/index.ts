import "dotenv/config";
import { createBot } from "./telegram/bot.js";

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not set — see .env.example");
if (!process.env.GEMINI_API_KEY && !process.env.ANTHROPIC_API_KEY) {
  throw new Error("Neither GEMINI_API_KEY nor ANTHROPIC_API_KEY is set — see .env.example");
}

const bot = createBot(token);

bot.start({
  onStart: () => console.log("kirana-ops-agent is running (long polling)"),
});

process.once("SIGINT", () => bot.stop());
process.once("SIGTERM", () => bot.stop());
