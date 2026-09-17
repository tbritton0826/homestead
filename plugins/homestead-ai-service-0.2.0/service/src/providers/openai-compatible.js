"use strict";

const { fetchJson, normalizeToolCalls, providerMessages, providerTools } = require("./common.js");

async function completeTurn(input, settings) {
  const baseUrl = String(settings.baseUrl || "").replace(/\/+$/, "");
  if (!baseUrl) throw new Error("AI_OPENAI_BASE_URL is not configured.");
  const headers = { "Content-Type": "application/json", Accept: "application/json" };
  if (settings.apiKey) headers.Authorization = `Bearer ${settings.apiKey}`;
  const data = await fetchJson(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: settings.model,
      messages: providerMessages(input.messages, input.systemPrompt),
      ...(input.tools.length ? { tools: providerTools(input.tools), tool_choice: "auto" } : {}),
      temperature: settings.temperature,
    }),
  }, settings.timeoutMs);
  const message = data.choices?.[0]?.message || {};
  const toolCalls = normalizeToolCalls(message.tool_calls || []);
  if (toolCalls.length) return { type: "tool_calls", message: { content: message.content || "" }, toolCalls };
  return { type: "message", message: { content: String(message.content || "") } };
}

module.exports = { completeTurn };
