"use strict";

const http = require("http");
const { createVerifier } = require("./auth.js");
const { basePrompt } = require("./prompt.js");
const { completeTurn, listModels } = require("./provider.js");

const VERSION = "0.2.0";
const PORT = Math.max(1, Math.min(65535, Number(process.env.PORT || 8099)));
const MAX_BODY_BYTES = Math.max(1024, Math.min(5 * 1024 * 1024, Number(process.env.AI_MAX_REQUEST_BYTES || 2 * 1024 * 1024)));
const verify = createVerifier();

function json(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(body), "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on("data", (chunk) => {
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        const error = new Error("Turn request exceeds AI_MAX_REQUEST_BYTES.");
        error.statusCode = 413;
        reject(error);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function validateTurn(payload) {
  if (!payload || typeof payload !== "object") throw new Error("Turn payload must be a JSON object.");
  if (!Array.isArray(payload.messages) || payload.messages.length > 250) throw new Error("Turn messages are missing or exceed the service limit.");
  if (!Array.isArray(payload.tools) || payload.tools.length > 150) throw new Error("Turn tools are missing or exceed the service limit.");
  for (const tool of payload.tools) {
    if (!/^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/.test(String(tool.name || ""))) throw new Error("Turn contains an invalid tool name.");
    if (!tool.inputSchema || tool.inputSchema.type !== "object") throw new Error(`Tool ${tool.name} has an invalid schema.`);
  }
  return payload;
}

async function handle(req, res) {
  const url = new URL(req.url, "http://service.local");
  if (req.method === "GET" && url.pathname === "/health") {
    return json(res, 200, { ok: true, service: "homestead-ai-service", version: VERSION, provider: process.env.AI_PROVIDER || "ollama", model: process.env.AI_MODEL || "", modelConfigured: Boolean(process.env.AI_MODEL), authenticationConfigured: String(process.env.AI_SHARED_SECRET || "").length >= 32 });
  }
  if (req.method !== "POST" || !["/v1/turn", "/v1/models"].includes(url.pathname)) return json(res, 404, { ok: false, code: "NOT_FOUND", message: "Route not found." });
  const rawBody = await readBody(req);
  verify(req.headers, rawBody, String(process.env.AI_SHARED_SECRET || ""));
  if (url.pathname === "/v1/models") {
    return json(res, 200, { ok: true, ...(await listModels()) });
  }
  let payload;
  try { payload = validateTurn(JSON.parse(rawBody)); }
  catch (error) { error.statusCode = error.statusCode || 400; error.code = error.code || "INVALID_TURN"; throw error; }
  const result = await completeTurn({ messages: payload.messages, tools: payload.tools, systemPrompt: basePrompt(payload.systemContext) }, payload.model || {});
  return json(res, 200, { ok: true, ...result });
}

const server = http.createServer((req, res) => {
  Promise.resolve(handle(req, res)).catch((error) => {
    const status = Number(error.statusCode) || 500;
    if (status >= 500) console.error("Homestead AI service request failed:", error);
    if (!res.headersSent) json(res, status, { ok: false, code: error.code || "SERVICE_ERROR", message: error.message || "AI service request failed." });
    else res.end();
  });
});

server.listen(PORT, "0.0.0.0", () => console.log(`Homestead AI service ${VERSION} listening on port ${PORT}.`));

module.exports = { handle, readBody, validateTurn };
