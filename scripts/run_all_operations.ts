import "dotenv/config";
import { runGeminiTurn, resetGeminiSession } from "../src/agent/geminiRunner.js";

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
let passed = 0;
let failed = 0;

async function op(
  num: number,
  title: string,
  chatId: string,
  prompts: string[]
): Promise<{ chatId: string; lastText: string; files: { file: string; kind: string }[] }> {
  console.log(`\n${"═".repeat(72)}`);
  console.log(`▶ [OP ${num}] ${title}`);
  console.log(`${"─".repeat(72)}`);
  let lastText = "";
  let allFiles: { file: string; kind: string }[] = [];
  for (const prompt of prompts) {
    console.log(`👤  "${prompt}"`);
    try {
      const res = await runGeminiTurn(chatId, prompt);
      lastText = res.text;
      allFiles = [...allFiles, ...res.files];
      console.log(`🤖  ${res.text}`);
      if (res.files.length > 0) {
        for (const f of res.files) {
          console.log(`📎  [${f.kind.toUpperCase()}] ${f.file}`);
        }
      }
      passed++;
    } catch (e: any) {
      console.error(`❌  ERROR: ${e.message}`);
      failed++;
    }
    await delay(3500);
  }
  return { chatId, lastText, files: allFiles };
}

async function main() {
  console.log("╔══════════════════════════════════════════════════════════════════╗");
  console.log("║         KIRANA OPS AGENT — COMPLETE OPERATIONS WALKTHROUGH       ║");
  console.log("╚══════════════════════════════════════════════════════════════════╝");

  const billId = "bill-" + Date.now();
  const khataId = "khata-" + Date.now();
  const statsId = "stats-" + Date.now();
  const prefId = "pref-" + Date.now();

  // ── 1. Receive Stock ────────────────────────────────────────────────
  await op(1, "RECEIVE STOCK", billId, [
    "50 packets of Maggi came in, cost ₹12, MRP ₹14",
  ]);

  // ── 2. Add New Product ───────────────────────────────────────────────
  // Amul Butter 100g is already seeded. Show the add path with a new SKU.
  // User asked for "Amul Butter 100g, GST 12%, MRP ₹62" — update sell price instead.
  await op(2, "ADD NEW PRODUCT (Amul Butter 100g — already in catalog, show result)", "newprod-" + Date.now(), [
    "New product: Amul Butter 100g, GST 12%, sell price ₹62, cost ₹50",
  ]);

  // ── 3. Cut a Bill ────────────────────────────────────────────────────
  await op(3, "CUT A BILL (2kg sugar, 1 atta, 4 Maggi, 1 Amul Butter, UPI)", billId, [
    "Make a bill: 2kg sugar, 1 Aashirvaad atta 5kg, 4 Maggi 70g, 1 Amul Butter 100g, payment UPI",
  ]);

  // ── 4. Edit Bill Mid-Build ───────────────────────────────────────────
  await op(4, "EDIT BILL MID-BUILD (drop butter, make it 6 Maggi)", billId, [
    "Drop the Amul Butter, make it 6 Maggi",
  ]);

  // ── 5. Finalize Bill ─────────────────────────────────────────────────
  const finalizeRes = await op(5, "FINALIZE BILL (UPI)", billId, [
    "Finalize — UPI",
  ]);

  // ── 6. Stock Query ──────────────────────────────────────────────────
  await op(6, "STOCK QUERY (how much sugar is left?)", billId, [
    "How much sugar is left?",
  ]);

  // ── 7. Low-Stock / Reorder ──────────────────────────────────────────
  await op(7, "LOW-STOCK / REORDER ALERT", "lowstock-" + Date.now(), [
    "What's running out?",
  ]);

  // ── 8. PDF Invoice ──────────────────────────────────────────────────
  await op(8, "INVOICE AS PDF (last bill → PDF)", billId, [
    "Send me that last bill as a PDF invoice",
  ]);

  // ── 9. Khata — Credit ───────────────────────────────────────────────
  await op(9, "KHATA — PUT ₹500 ON RAMESH'S CREDIT", khataId, [
    "Put ₹500 on Ramesh's credit",
  ]);

  // ── 10. Khata — Repayment ────────────────────────────────────────────
  await op(10, "KHATA — RAMESH PAID ₹300", khataId, [
    "Ramesh paid ₹300",
  ]);

  // ── 11. Khata — Balance ──────────────────────────────────────────────
  await op(11, "KHATA — RAMESH'S BALANCE?", khataId, [
    "What is Ramesh's current balance?",
  ]);

  // ── 12. Daily Close / Sales Summary ─────────────────────────────────
  await op(12, "DAILY CLOSE (total, tax, cash vs UPI, top items)", statsId, [
    "Close the day — total sales, tax collected, cash vs UPI, top items",
  ]);

  // ── 13. Analysis Deck (PPTX) ────────────────────────────────────────
  await op(13, "ANALYSIS DECK (this week's PPTX)", statsId, [
    "Make this week's sales analysis deck as a PPTX",
  ]);

  // ── 14. Set Preference — UPI Default ────────────────────────────────
  await op(14, "SET PREFERENCE — always assume UPI unless I say cash", prefId, [
    "Always assume UPI unless I say cash",
  ]);

  // ── 15. Set Preference — Default Atta ───────────────────────────────
  await op(15, "SET PREFERENCE — default atta = Aashirvaad 5kg", prefId, [
    "Default atta is Aashirvaad 5kg",
  ]);

  console.log(`\n${"═".repeat(72)}`);
  console.log(`✅  DONE — ${passed} passed, ${failed} failed`);
  console.log(`${"═".repeat(72)}\n`);
}

main().catch(console.error);
