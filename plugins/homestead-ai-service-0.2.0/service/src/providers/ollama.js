"use strict";

const { fetchJson, normalizeToolCalls, ollamaMessages, providerTools } = require("./common.js");

async function completeTurn(input, settings) {
  const baseUrl = String(settings.baseUrl || "http://ollama:11434").replace(/\/+$/, "");
  const data = await fetchJson(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      model: settings.model,
      messages: ollamaMessages(input.messages, input.systemPrompt),
      ...(input.tools.length ? { tools: providerTools(input.tools) } : {}),
      stream: false,
      options: { temperature: settings.temperature },
    }),
  }, settings.timeoutMs);
  const message = data.message || {};
  const toolCalls = normalizeToolCalls(message.tool_calls || []);
  if (toolCalls.length) return { type: "tool_calls", message: { content: message.content || "" }, toolCalls };
  return { type: "message", message: { content: String(message.content || "") } };
}

module.exports = { completeTurn };
