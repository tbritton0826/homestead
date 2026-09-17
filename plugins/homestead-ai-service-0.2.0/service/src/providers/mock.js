"use strict";

async function completeTurn(input, settings) {
  const last = [...input.messages].reverse().find((message) => message.role === "user");
  return { type: "message", message: { content: `Mock provider is connected. I received: ${String(last?.content || "no message").slice(0, 300)}` }, model: settings.model };
}

module.exports = { completeTurn };
