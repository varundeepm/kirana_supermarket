import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { buildSystemPrompt } from "./systemPrompt.js";
import { loadPreferencesSummary, preferenceTools } from "./tools/preferences.js";
import { inventoryTools } from "./tools/inventory.js";
import { billingTools } from "./tools/billing.js";
import { khataTools } from "./tools/khata.js";
import { analyticsTools } from "./tools/analytics.js";
import { documentTools } from "./tools/documents.js";

export interface TurnResult {
  text: string;
  files: { file: string; kind: string }[];
}

const allTools = [
  ...inventoryTools,
  ...billingTools,
  ...khataTools,
  ...analyticsTools,
  ...documentTools,
  ...preferenceTools,
];

// Clean JSON schema to conform strictly to Gemini's FunctionDeclaration parameters
function cleanGeminiSchema(schema: any): any {
  if (!schema || typeof schema !== "object") return schema;
  const result: any = {};
  if (schema.type) {
    result.type = String(schema.type).toUpperCase();
  }
  if (schema.description) result.description = schema.description;
  if (Array.isArray(schema.required) && schema.required.length > 0) {
    result.required = schema.required;
  }
  if (Array.isArray(schema.enum)) {
    result.enum = schema.enum;
  }
  if (schema.items) {
    result.items = cleanGeminiSchema(schema.items);
  }
  if (schema.properties) {
    result.properties = {};
    for (const [k, v] of Object.entries(schema.properties)) {
      result.properties[k] = cleanGeminiSchema(v);
    }
  }
  return result;
}

// Convert our 20 Kirana store tools into Gemini function declarations
const geminiFunctionDeclarations = allTools.map((t: any) => {
  let parameters: any = { type: "OBJECT", properties: {} };
  if (t.inputSchema && Object.keys(t.inputSchema).length > 0) {
    const rawSchema = zodToJsonSchema(z.object(t.inputSchema));
    parameters = cleanGeminiSchema(rawSchema);
    if (!parameters.properties) parameters.properties = {};
  }
  return {
    name: t.name,
    description: t.description,
    parameters,
  };
});

// Map for quick lookup during tool execution
const toolMap = new Map<string, any>();
for (const t of allTools) {
  toolMap.set(t.name, t);
}

// In-memory conversation history per chat (retained across turns, reset via /new)
const chatHistories = new Map<string, any[]>();

export function resetGeminiSession(chatId: string): void {
  chatHistories.delete(chatId);
}

export async function runGeminiTurn(chatId: string, userMessage: string): Promise<TurnResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set in .env");

  const preferencesSummary = await loadPreferencesSummary();
  const systemPrompt =
    buildSystemPrompt(preferencesSummary) +
    `\n\nTelegram context:\n- The current Telegram Chat ID is: "${chatId}". When calling any tool that requires chatId (like add_bill_item, view_draft_bill, set_bill_payment, finalize_bill), always pass this chatId value.`;

  let history = chatHistories.get(chatId);
  if (!history) {
    history = [];
    chatHistories.set(chatId, history);
  }

  // Sanitize history: if the last entry is a model turn that contains unanswered
  // functionCalls (i.e., no following user functionResponse), drop it so Gemini
  // doesn't reject the next request with INVALID_ARGUMENT.
  while (history.length > 0) {
    const last = history[history.length - 1];
    const isModelWithFnCall =
      last.role === "model" &&
      Array.isArray(last.parts) &&
      last.parts.some((p: any) => p.functionCall);
    if (isModelWithFnCall) {
      history.pop();
    } else {
      break;
    }
  }

  // Append user's new message
  history.push({
    role: "user",
    parts: [{ text: userMessage }],
  });


  const files: { file: string; kind: string }[] = [];
  const candidateModels = [
    process.env.GEMINI_MODEL,
    "gemini-flash-lite-latest",
    "gemini-3.1-flash-lite",
    "gemini-flash-latest",
  ].filter(Boolean) as string[];

  let finalText = "";
  const maxTurns = 12;

  try {
    for (let turn = 0; turn < maxTurns; turn++) {
      const requestBody = {
        contents: history,
        systemInstruction: {
          parts: [{ text: systemPrompt }],
        },
        tools: [
          {
            functionDeclarations: geminiFunctionDeclarations,
          },
        ],
        generationConfig: {
          temperature: 0.2,
        },
      };

      let res: Response | null = null;
      let lastErrText = "";

      // Try candidate models in order if 429 (quota) or 503 (high demand) occurs
      for (const m of candidateModels) {
        const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${apiKey}`;
        res = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(requestBody),
        });

        if (res.ok) break;

        lastErrText = await res.text();
        if (res.status === 429 || res.status === 503) {
          // brief pause before trying next candidate
          await new Promise((r) => setTimeout(r, 1000));
          continue;
        }
        break;
      }

      if (!res || !res.ok) {
        throw new Error(`Gemini API error (${res?.status ?? 500}): ${lastErrText}`);
      }

      const data: any = await res.json();
      const candidate = data.candidates?.[0];
      if (!candidate || !candidate.content) {
        throw new Error("No response content from Gemini API");
      }

      const modelContent = candidate.content;
      history.push(modelContent);

      // Look for function calls
      const functionCalls = modelContent.parts?.filter((p: any) => p.functionCall);

      if (!functionCalls || functionCalls.length === 0) {
        // Model returned final text answer
        const textParts = modelContent.parts?.filter((p: any) => p.text);
        finalText = textParts?.map((p: any) => p.text).join("\n") || "";
        break;
      }

      const functionResponseParts: any[] = [];

      // Execute all function calls
      for (const part of functionCalls) {
        const call = part.functionCall;
        const toolDef = toolMap.get(call.name);

        let toolOutputText = "";
        if (!toolDef) {
          toolOutputText = JSON.stringify({ error: `Unknown tool: ${call.name}` });
        } else {
          const args = { ...(call.args || {}) };
          if (!args.chatId) args.chatId = chatId;
          if (call.name === "finalize_bill" && !args.idempotencyKey) {
            args.idempotencyKey = `${chatId}-${Date.now()}`;
          }

          try {
            const result = await toolDef.handler(args);
            const rawText = result?.content?.[0]?.text ?? JSON.stringify(result);
            toolOutputText = rawText;

            try {
              const parsed = JSON.parse(rawText);
              if (parsed?.file && parsed?.kind) {
                files.push(parsed);
              }
            } catch {
              // not JSON, ignore
            }
          } catch (err: any) {
            toolOutputText = JSON.stringify({ error: err.message ?? String(err) });
          }
        }

        functionResponseParts.push({
          functionResponse: {
            name: call.name,
            response: {
              output: toolOutputText,
            },
          },
        });
      }

      // Gemini strictly requires all functionResponses for a turn to be in ONE user message
      history.push({
        role: "user",
        parts: functionResponseParts,
      });
    }
  } catch (err) {
    // If the turn crashed, ensure the last turn is not a dangling model functionCall
    while (history.length > 0 && history[history.length - 1].role === "model") {
      history.pop();
    }
    throw err;
  }

  // Keep last 30 entries in history to prevent unbounded memory growth
  if (history.length > 30) {
    history.splice(0, history.length - 30);
  }

  return { text: finalText.trim(), files };
}
