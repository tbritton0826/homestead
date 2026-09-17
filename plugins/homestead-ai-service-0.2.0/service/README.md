# Homestead AI service

This is the replaceable, stateless model-orchestration half of the Homestead AI
Assistant plugin. It exposes only `GET /health`, authenticated `POST /v1/turn`,
and authenticated `POST /v1/models`. It does not mount Homestead data, the Unraid Docker socket, a
database, media, appdata, or plugin folders.

## Providers

- `ollama`: uses `AI_OLLAMA_URL` and a tool-capable model installed in Ollama.
- `openai-compatible`: uses `AI_OPENAI_BASE_URL` (normally ending in `/v1`) and
  optional `AI_OPENAI_API_KEY`.
- `mock`: connection/testing provider; enable it explicitly in
  `AI_ALLOWED_PROVIDERS` and never use it as a real assistant.

The container has final authority over `AI_ALLOWED_PROVIDERS` and
`AI_ALLOWED_MODELS`. `AI_TOOL_MODELS` is the smaller explicit list permitted to
receive Homestead tool schemas. Models outside that list remain available only
for general chat. The plugin may request an allowed override but cannot point
the service at an arbitrary provider URL or use a model outside those lists.

## Build and run on Unraid

```bash
docker network create homestead-private
docker build -t homestead-ai-service:0.2.0 .
```

Join the Homestead container, this service, and the chosen local provider (for
example Ollama) to `homestead-private`. The AI service does not require a host
port; Homestead reaches it at `http://homestead-ai-service:8099`. During initial
diagnostics only, publishing `8099:8099` is optional.

Use a randomly generated 32-byte-or-longer secret. Configure the exact same
value as:

- `HOMESTEAD_AI_SHARED_SECRET` in the Homestead container, or in the plugin's
  private Settings screen; and
- `AI_SHARED_SECRET` in this service container.

For an OpenAI-compatible provider, set:

```text
AI_PROVIDER=openai-compatible
AI_ALLOWED_PROVIDERS=openai-compatible
AI_MODEL=<allowed-model>
AI_ALLOWED_MODELS=<allowed-model-or-comma-list>
AI_TOOL_MODELS=<tool-capable-subset>
AI_OPENAI_BASE_URL=http://provider:port/v1
AI_OPENAI_API_KEY=<only-if-provider-requires-it>
```

The service is intentionally stateless. Replacing it or changing model
providers does not remove Homestead conversations or application records.
