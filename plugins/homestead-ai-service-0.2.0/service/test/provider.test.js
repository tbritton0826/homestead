"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { completeTurn, resolveSettings } = require("../src/provider.js");

test("provider and model overrides remain allowlisted", () => {
  const previous = {
    AI_PROVIDER: process.env.AI_PROVIDER,
    AI_ALLOWED_PROVIDERS: process.env.AI_ALLOWED_PROVIDERS,
    AI_MODEL: process.env.AI_MODEL,
    AI_ALLOWED_MODELS: process.env.AI_ALLOWED_MODELS,
  };
  process.env.AI_PROVIDER = "mock";
  process.env.AI_ALLOWED_PROVIDERS = "mock";
  process.env.AI_MODEL = "test-model";
  process.env.AI_ALLOWED_MODELS = "test-model";
  assert.equal(resolveSettings({}).provider, "mock");
  assert.throws(() => resolveSettings({ provider: "ollama" }), /not allowed/);
  assert.throws(() => resolveSettings({ model: "different" }), /not in AI_ALLOWED_MODELS/);
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

test("chat-only models cannot receive Homestead tools", async () => {
  const previous = {
    AI_PROVIDER: process.env.AI_PROVIDER,
    AI_ALLOWED_PROVIDERS: process.env.AI_ALLOWED_PROVIDERS,
    AI_MODEL: process.env.AI_MODEL,
    AI_ALLOWED_MODELS: process.env.AI_ALLOWED_MODELS,
    AI_TOOL_MODELS: process.env.AI_TOOL_MODELS,
  };
  process.env.AI_PROVIDER = "mock";
  process.env.AI_ALLOWED_PROVIDERS = "mock";
  process.env.AI_MODEL = "tool-model";
  process.env.AI_ALLOWED_MODELS = "tool-model,chat-model";
  process.env.AI_TOOL_MODELS = "tool-model";
  await assert.rejects(
    () => completeTurn({ messages: [], tools: [{ name: "profile.search" }] }, { provider: "mock", model: "chat-model" }),
    (error) => error.code === "MODEL_TOOLS_NOT_ALLOWED"
  );
  const result = await completeTurn({ messages: [{ role: "user", content: "hello" }], tools: [] }, { provider: "mock", model: "chat-model" });
  assert.equal(result.model, "chat-model");
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});
