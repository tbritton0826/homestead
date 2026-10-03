"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { fetchJson, ollamaMessages, providerMessages } = require("../src/providers/common.js");

const history = [
  { role: "user", content: "List installed plugins." },
  {
    role: "assistant",
    content: "",
    toolCalls: [{ id: "call_1", name: "homestead.plugins.list", arguments: {} }],
  },
  {
    role: "tool",
    name: "homestead.plugins.list",
    toolCallId: "call_1",
    content: "{\"ok\":true}",
  },
];

test("Ollama tool continuations use native tool_name and object arguments", () => {
  const messages = ollamaMessages(history, "System prompt");
  assert.deepEqual(messages[2].tool_calls, [{
    type: "function",
    function: { name: "homestead.plugins.list", arguments: {} },
  }]);
  assert.equal(messages[3].tool_name, "homestead.plugins.list");
  assert.equal("name" in messages[3], false);
  assert.equal("tool_call_id" in messages[3], false);
});

test("OpenAI-compatible tool continuations retain IDs", () => {
  const messages = providerMessages(history, "System prompt");
  assert.equal(messages[2].tool_calls[0].id, "call_1");
  assert.equal(messages[3].name, "homestead.plugins.list");
  assert.equal(messages[3].tool_call_id, "call_1");
});

test("Ollama string errors are preserved for diagnostics", async (t) => {
  const originalFetch = global.fetch;
  global.fetch = async () => new Response(JSON.stringify({
    error: "qwen3:14b does not support tools",
  }), { status: 400, headers: { "Content-Type": "application/json" } });
  t.after(() => { global.fetch = originalFetch; });

  await assert.rejects(
    fetchJson("http://ollama:11434/api/chat", {}, 5000),
    /qwen3:14b does not support tools/
  );
});
