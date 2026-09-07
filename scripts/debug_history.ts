import "dotenv/config";
import { runGeminiTurn } from "../src/agent/geminiRunner.js";

async function debug() {
  const cid = "debug-" + Date.now();
  const prompts = [
    "50 packets of Maggi came in, cost ₹12, MRP ₹14",
    "New item: Britannia Good Day 100g, brand Britannia, SKU BIS-GD-100G, HSN 1905, GST 18%, unit packet, cost ₹18, sell price ₹25, reorder level 10, initial stock 40",
    "Add 2 atta to my bill",
    "I mean Aashirvaad Atta 5kg. Make a bill: 2kg sugar, 1 Aashirvaad atta 5kg, 4 Maggi, 1 Amul butter, payment mode UPI",
    "Drop the butter, make it 6 Maggi",
    "That's it, finalize the bill with UPI"
  ];

  for (const p of prompts) {
    console.log("\n=============================");
    console.log("SENDING:", p);
    try {
      const res = await runGeminiTurn(cid, p);
      console.log("REPLY:", res.text);
    } catch (e: any) {
      console.error("ERROR:", e.message);
      break;
    }
  }
}

debug();
