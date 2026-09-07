import "dotenv/config";
import { runGeminiTurn } from "../src/agent/geminiRunner.js";

async function test() {
  try {
    const res = await runGeminiTurn("test-chat-1", "What's running out?");
    console.log("Agent response:", res.text);
    console.log("Files:", res.files);
  } catch (err) {
    console.error("Test error:", err);
  }
}

test();
