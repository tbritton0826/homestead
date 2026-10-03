"use strict";

function providerMessages(messages, systemPrompt) {
  const result = [{ role: "system", content: systemPrompt }];
  for (const message of messages || []) {
    const row = { role: message.role, content: String(message.content || "") };
    if (message.name) row.name = message.name;
    if (message.toolCallId) row.tool_call_id = message.toolCallId;
    if (Array.isArray(message.toolCalls)) {
      row.tool_calls = message.toolCalls.map((call) => ({
        id: call.id,
        type: "function",
        function: { name: call.name, arguments: JSON.stringify(call.arguments || {}) },
      }));
    }
    result.push(row);
  }
  return result;
}

// Ollama's native /api/chat continuation format is intentionally different
// from OpenAI's. In particular, tool results are associated with a call by
// `tool_name`; `name` and `tool_call_id` are OpenAI-compatible fields and cause
// Ollama to reject a follow-up tool round with HTTP 400.
function ollamaMessages(messages, systemPrompt) {
  const result = [{ role: "system", content: systemPrompt }];
  for (const message of messages || []) {
    const row = { role: message.role, content: String(message.content || "") };
    if (message.role === "tool" && message.name) row.tool_name = message.name;
    if (Array.isArray(message.toolCalls)) {
      row.tool_calls = message.toolCalls.map((call) => ({
        type: "function",
        function: {
          name: call.name,
          arguments: call.arguments && typeof call.arguments === "object" ? call.arguments : {},
        },
      }));
    }
    result.push(row);
  }
  return result;
}

function providerTools(tools) {
  return (tools || []).map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
    },
  }));
}

function normalizeToolCalls(calls = []) {
  return calls.map((call, index) => {
    const fn = call.function || call;
    let args = fn.arguments || {};
    if (typeof args === "string") {
      try { args = JSON.parse(args); } catch { args = {}; }
    }
    return {
      id: String(call.id || `call_${index + 1}`),
      name: String(fn.name || ""),
      arguments: args && typeof args === "object" && !Array.isArray(args) ? args : {},
    };
  }).filter((call) => call.name);
}

async function fetchJson(url, init, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const raw = await response.text();
    let data;
    try { data = raw ? JSON.parse(raw) : {}; } catch { data = { message: raw.slice(0, 2000) }; }
    if (!response.ok) {
      const providerMessage = typeof data?.error === "string"
        ? data.error
        : data?.error?.message || data?.message;
      const error = new Error(providerMessage || `Model provider returned HTTP ${response.status}.`);
      error.statusCode = 502;
      error.code = "MODEL_PROVIDER_ERROR";
      throw error;
    }
    return data;
  } catch (error) {
    if (error.name === "AbortError") { const timeout = new Error("Model provider request timed out."); timeout.statusCode = 504; throw timeout; }
    throw error;
  } finally { clearTimeout(timer); }
}

module.exports = { fetchJson, normalizeToolCalls, ollamaMessages, providerMessages, providerTools };
