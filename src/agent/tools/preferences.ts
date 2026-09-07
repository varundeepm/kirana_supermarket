import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { prisma } from "../../db/client.js";

// Standing preferences ("always assume UPI unless I say cash", "default atta
// = Aashirvaad 5kg", shop name/GSTIN for invoices) live in Postgres, keyed by
// a stable string. Read these at the top of every conversation (see
// systemPrompt.ts) so they apply even in a brand-new /new chat — this is
// what makes them "memory outside the context window" rather than just
// something the model happens to recall from earlier in the thread.

export const setPreference = tool(
  "set_preference",
  "Save a standing owner preference that should apply in every future chat, e.g. " +
    "default_payment_mode=UPI, default_atta_sku=<sku>, shop_name=..., shop_gstin=....",
  { key: z.string(), value: z.string() },
  async ({ key, value }) => {
    const pref = await prisma.preference.upsert({
      where: { key },
      update: { value },
      create: { key, value },
    });
    return { content: [{ type: "text", text: JSON.stringify(pref) }] };
  }
);

export const getPreferences = tool(
  "get_preferences",
  "Read all standing owner preferences currently saved.",
  {},
  async () => {
    const prefs = await prisma.preference.findMany();
    const asMap = Object.fromEntries(prefs.map((p) => [p.key, p.value]));
    return { content: [{ type: "text", text: JSON.stringify(asMap) }] };
  }
);

export const preferenceTools = [setPreference, getPreferences];

// Used at session start (not exposed to the model as a tool) to seed the
// system prompt with current preferences so the agent doesn't have to call
// get_preferences on every single turn.
export async function loadPreferencesSummary(): Promise<string> {
  const prefs = await prisma.preference.findMany();
  if (prefs.length === 0) return "(no standing preferences saved yet)";
  return prefs.map((p) => `- ${p.key}: ${p.value}`).join("\n");
}
