"use strict";

const ollama = require("./providers/ollama.js");
const openaiCompatible = require("./providers/openai-compatible.js");
const mock = require("./providers/mock.js");
const { fetchJson } = require("./providers/common.js");

const PROVIDERS = { ollama, "openai-compatible": openaiCompatible, mock };

function listEnvironment(value) {
  return String(value || "").split(",").map((entry) => entry.trim()).filter(Boolean);
}

function allowedModelNames() {
  const configured = listEnvironment(process.env.AI_ALLOWED_MODELS);
  const defaultModel = String(process.env.AI_MODEL || "").trim();
  return configured.length ? configured : (defaultModel ? [defaultModel] : []);
}

function toolModelNames() {
  const configured = listEnvironment(process.env.AI_TOOL_MODELS);
  const defaultModel = String(process.env.AI_MODEL || "").trim();
  return configured.length ? configured : (defaultModel ? [defaultModel] : []);
}

function resolveSettings(requested = {}) {
  const defaultProvider = process.env.AI_PROVIDER || "ollama";
  const provider = String(requested.provider || defaultProvider).trim();
  const allowedProviders = listEnvironment(process.env.AI_ALLOWED_PROVIDERS || defaultProvider);
  if (!allowedProviders.includes(provider) || !PROVIDERS[provider]) {
    const error = new Error(`Model provider ${provider} is not allowed by this service.`);
    error.statusCode = 403;
    error.code = "PROVIDER_NOT_ALLOWED";
    throw error;
  }
  const model = String(requested.model || process.env.AI_MODEL || "").trim();
  if (!model) {
    const error = new Error("No AI model is configured.");
    error.statusCode = 503;
    error.code = "MODEL_NOT_CONFIGURED";
    throw error;
  }
  const allowedModels = allowedModelNames();
  if (!allowedModels.includes(model)) {
    const error = new Error(`Model ${model} is not in AI_ALLOWED_MODELS.`);
    error.statusCode = 403;
    error.code = "MODEL_NOT_ALLOWED";
    throw error;
  }
  return {
    provider,
    model,
    temperature: Math.max(0, Math.min(2, Number(requested.temperature ?? process.env.AI_TEMPERATURE ?? 0.2))),
    timeoutMs: Math.max(5000, Math.min(180000, Number(process.env.AI_PROVIDER_TIMEOUT_MS || 90000))),
    baseUrl: provider === "ollama" ? process.env.AI_OLLAMA_URL || "http://ollama:11434" : process.env.AI_OPENAI_BASE_URL || "",
    apiKey: provider === "openai-compatible" ? process.env.AI_OPENAI_API_KEY || "" : "",
  };
}

async function listModels() {
  const defaultProvider = process.env.AI_PROVIDER || "ollama";
  const defaultModel = String(process.env.AI_MODEL || "").trim();
  const providers = listEnvironment(process.env.AI_ALLOWED_PROVIDERS || defaultProvider)
    .filter((provider) => PROVIDERS[provider]);
  const allowedModels = allowedModelNames();
  const toolModels = new Set(toolModelNames());
  const rows = [];
  const warnings = [];

  for (const provider of providers) {
    let installed = null;
    if (provider === "ollama") {
      const baseUrl = String(process.env.AI_OLLAMA_URL || "http://ollama:11434").replace(/\/+$/, "");
      try {
        const payload = await fetchJson(`${baseUrl}/api/tags`, { headers: { Accept: "application/json" } }, Math.max(5000, Math.min(30000, Number(process.env.AI_PROVIDER_TIMEOUT_MS || 90000))));
        installed = new Map((payload.models || []).map((model) => [String(model.name || model.model || ""), model]));
      } catch (error) {
        warnings.push(`Ollama catalog unavailable: ${error.message}`);
      }
    }

    for (const model of allowedModels) {
      const metadata = installed?.get(model) || null;
      rows.push({
        id: `${provider}:${model}`,
        provider,
        model,
        label: model,
        default: provider === defaultProvider && model === defaultModel,
        installed: installed ? Boolean(metadata) : null,
        sizeBytes: Number(metadata?.size || 0) || null,
        modifiedAt: metadata?.modified_at || null,
        toolCapable: toolModels.has(model),
        mode: toolModels.has(model) ? "assistant-or-chat" : "chat-only",
      });
    }
  }

  return {
    defaultProvider,
    defaultModel,
    models: rows,
    warnings,
  };
}

async function completeTurn(input, requested) {
  const settings = resolveSettings(requested);
  if (Array.isArray(input.tools) && input.tools.length && !toolModelNames().includes(settings.model)) {
    const error = new Error(`Model ${settings.model} is approved for chat only and cannot receive Homestead tools.`);
    error.statusCode = 403;
    error.code = "MODEL_TOOLS_NOT_ALLOWED";
    throw error;
  }
  const result = await PROVIDERS[settings.provider].completeTurn(input, settings);
  return { ...result, provider: settings.provider, model: settings.model };
}

module.exports = { PROVIDERS, allowedModelNames, completeTurn, listEnvironment, listModels, resolveSettings, toolModelNames };
