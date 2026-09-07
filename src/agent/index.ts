import { query, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { prisma } from "../db/client.js";
import { buildSystemPrompt } from "./systemPrompt.js";
import { loadPreferencesSummary, preferenceTools } from "./tools/preferences.js";
import { inventoryTools } from "./tools/inventory.js";
import { billingTools } from "./tools/billing.js";
import { khataTools } from "./tools/khata.js";
import { analyticsTools } from "./tools/analytics.js";
import { documentTools } from "./tools/documents.js";
import { runGeminiTurn, resetGeminiSession } from "./geminiRunner.js";

const kiranaTools = createSdkMcpServer({
  name: "kirana",
  version: "0.1.0",
  tools: [
    ...inventoryTools,
    ...billingTools,
    ...khataTools,
    ...analyticsTools,
    ...documentTools,
    ...preferenceTools,
  ],
});

export interface TurnResult {
  text: string;
  // {file, kind} envelopes emitted by document tools this turn, so the
  // Telegram layer can forward the actual PDF/PPTX as a document
  files: { file: string; kind: string }[];
}

export function resetSession(chatId: string): void {
  resetGeminiSession(chatId);
}

/**
 * Look up an existing session ID for this chat from the DB (Claude harness).
 */
async function getStoredSessionId(chatId: string): Promise<string | null> {
  const row = await prisma.chatSession.findUnique({ where: { chatId } });
  return row?.sessionId ?? null;
}

/**
 * Persist (or overwrite) the SDK-assigned session ID for a chat.
 */
async function saveSessionId(chatId: string, sessionId: string): Promise<void> {
  await prisma.chatSession.upsert({
    where: { chatId },
    update: { sessionId, updatedAt: new Date() },
    create: { chatId, sessionId },
  });
}

/**
 * Run a turn through Claude Agent SDK
 */
async function runClaudeTurn(chatId: string, userMessage: string): Promise<TurnResult> {
  const storedSessionId = await getStoredSessionId(chatId);
  const preferencesSummary = await loadPreferencesSummary();

  const result = query({
    prompt: userMessage,
    options: {
      ...(storedSessionId ? { resume: storedSessionId } : {}),
      systemPrompt: buildSystemPrompt(preferencesSummary),
      mcpServers: { kirana: kiranaTools },
      allowedTools: ["mcp__kirana__*"],
      tools: [],
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      maxTurns: 12,
    },
  });

  let text = "";
  const files: { file: string; kind: string }[] = [];
  let sdkSessionId: string | null = null;

  for await (const message of result) {
    if (!sdkSessionId && "session_id" in message && message.session_id) {
      sdkSessionId = message.session_id;
      await saveSessionId(chatId, sdkSessionId);
    }

    if (message.type === "assistant") {
      for (const block of message.message.content) {
        if (block.type === "text") text += block.text;
      }
    }

    if (message.type === "user" && Array.isArray(message.message.content)) {
      for (const block of message.message.content as any[]) {
        if (block.type === "tool_result" && typeof block.content?.[0]?.text === "string") {
          try {
            const parsed = JSON.parse(block.content[0].text);
            if (parsed?.file && parsed?.kind) files.push(parsed);
          } catch {
            // not JSON, ignore
          }
        }
      }
    }
  }

  return { text: text.trim(), files };
}

/**
 * Main turn handler: routes to Google Gemini (free API key) if configured,
 * or Claude Agent SDK as fallback.
 */
export async function runTurn(chatId: string, userMessage: string): Promise<TurnResult> {
  if (process.env.GEMINI_API_KEY) {
    return runGeminiTurn(chatId, userMessage);
  }
  return runClaudeTurn(chatId, userMessage);
}
