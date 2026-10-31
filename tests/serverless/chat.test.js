import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { createServer } from "node:http";
import { POST } from "../../app/api/chat/route.js";
import { validateChatRequest } from "../../app/lib/chat-validation.js";

const originalEnabled = process.env.AI_CHAT_ENABLED;
const originalNodeEnv = process.env.NODE_ENV;
const originalOllamaUrl = process.env.OLLAMA_BASE_URL;
const originalOllamaModel = process.env.OLLAMA_MODEL;
const originalOllamaApiKey = process.env.OLLAMA_API_KEY;
const originalGroqKey = process.env.GROQ_API_KEY;
const originalRedisUrl = process.env.UPSTASH_REDIS_REST_URL;
const originalRedisToken = process.env.UPSTASH_REDIS_REST_TOKEN;
const originalFetch = globalThis.fetch;

function message(role, text) {
  return { id: "test-message", role, parts: [{ type: "text", text, state: "done" }] };
}

afterEach(() => {
  if (originalEnabled === undefined) delete process.env.AI_CHAT_ENABLED;
  else process.env.AI_CHAT_ENABLED = originalEnabled;
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnv;
  if (originalOllamaUrl === undefined) delete process.env.OLLAMA_BASE_URL;
  else process.env.OLLAMA_BASE_URL = originalOllamaUrl;
  if (originalOllamaModel === undefined) delete process.env.OLLAMA_MODEL;
  else process.env.OLLAMA_MODEL = originalOllamaModel;
  if (originalOllamaApiKey === undefined) delete process.env.OLLAMA_API_KEY;
  else process.env.OLLAMA_API_KEY = originalOllamaApiKey;
  if (originalGroqKey === undefined) delete process.env.GROQ_API_KEY;
  else process.env.GROQ_API_KEY = originalGroqKey;
  if (originalRedisUrl === undefined) delete process.env.UPSTASH_REDIS_REST_URL;
  else process.env.UPSTASH_REDIS_REST_URL = originalRedisUrl;
  if (originalRedisToken === undefined) delete process.env.UPSTASH_REDIS_REST_TOKEN;
  else process.env.UPSTASH_REDIS_REST_TOKEN = originalRedisToken;
  globalThis.fetch = originalFetch;
});

test("chat payload accepts consented text only and strips UI metadata", () => {
  const result = validateChatRequest({
    consent: true,
    messages: [
      { ...message("user", "I feel overwhelmed"), metadata: { private: "ignored" } },
      message("assistant", "Let's find one small step."),
      message("user", "Help me choose it."),
    ],
  });
  assert.equal(result.valid, true);
  assert.deepEqual(result.messages, [
    { role: "user", content: "I feel overwhelmed" },
    { role: "assistant", content: "Let's find one small step." },
    { role: "user", content: "Help me choose it." },
  ]);
});

test("chat payload rejects absent consent, planner data, non-text parts, and oversize histories", () => {
  assert.equal(validateChatRequest({ messages: [message("user", "Hello")] }).valid, false);
  assert.equal(validateChatRequest({ consent: true, messages: [message("user", "Hello")], plannerData: {} }).valid, false);
  assert.equal(validateChatRequest({
    consent: true,
    messages: [{ id: "x", role: "user", parts: [{ type: "file", url: "https://example.test" }] }],
  }).valid, false);
  assert.equal(validateChatRequest({ consent: true, messages: [message("user", "x".repeat(2_001))] }).valid, false);
  assert.equal(validateChatRequest({
    consent: true,
    messages: Array.from({ length: 21 }, (_, index) => message(index % 2 === 0 ? "user" : "assistant", "hello")),
  }).valid, false);
});

test("chat API fails closed when local Ollama support is disabled", async () => {
  process.env.NODE_ENV = "development";
  delete process.env.OLLAMA_API_KEY;
  delete process.env.GROQ_API_KEY;
  delete process.env.AI_CHAT_ENABLED;
  const response = await POST(new Request("http://127.0.0.1/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ consent: true, messages: [message("user", "Do not forward this")] }),
  }));
  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /turned off/i);
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("chat API rejects non-local hosts and non-loopback Ollama URLs", async () => {
  process.env.NODE_ENV = "development";
  delete process.env.OLLAMA_API_KEY;
  delete process.env.GROQ_API_KEY;
  process.env.AI_CHAT_ENABLED = "true";
  const body = JSON.stringify({ consent: true, messages: [message("user", "Hello")] });
  const remoteHost = await POST(new Request("http://daybreak.example/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  }));
  assert.equal(remoteHost.status, 503);

  process.env.OLLAMA_BASE_URL = "http://example.com/v1";
  const remoteOllama = await POST(new Request("http://127.0.0.1/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  }));
  assert.equal(remoteOllama.status, 503);
  assert.match((await remoteOllama.json()).error, /local Ollama server/i);
});

test("chat API streams replies from the configured local Ollama model", async () => {
  const server = createServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      server.requestBody = JSON.parse(body);
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.end([
        'data: {"id":"chatcmpl-test","object":"chat.completion.chunk","created":1,"model":"llama3:latest","choices":[{"index":0,"delta":{"role":"assistant","content":"One small step."},"finish_reason":null}]}',
        "",
        'data: {"id":"chatcmpl-test","object":"chat.completion.chunk","created":1,"model":"llama3:latest","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}',
        "",
        "data: [DONE]",
        "",
        "",
      ].join("\n"));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  process.env.NODE_ENV = "development";
  process.env.AI_CHAT_ENABLED = "true";
  delete process.env.OLLAMA_API_KEY;
  delete process.env.GROQ_API_KEY;
  delete process.env.OLLAMA_MODEL;
  process.env.OLLAMA_BASE_URL = `http://127.0.0.1:${port}/v1`;

  try {
    const response = await POST(new Request("http://127.0.0.1/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ consent: true, messages: [message("user", "Help me begin")] }),
    }));
    assert.equal(response.status, 200);
    assert.match(await response.text(), /One small step\./);
    assert.equal(server.requestBody.model, "llama3.2:latest");
    assert.equal(server.requestBody.messages.at(-1).content, "Help me begin");
    assert.match(
      JSON.stringify(server.requestBody.messages),
      /Current date and time: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+08:00 \(Singapore Time, SGT\)/,
    );
    assert.match(JSON.stringify(server.requestBody.messages), /Light, Steady, or Deep Focus/);
    assert.match(JSON.stringify(server.requestBody.messages), /#SubjectName/);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("chat API explains when the local Ollama model is unavailable", async () => {
  const server = createServer((_request, response) => {
    response.writeHead(503, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "model not found" }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  process.env.NODE_ENV = "development";
  process.env.AI_CHAT_ENABLED = "true";
  delete process.env.OLLAMA_API_KEY;
  delete process.env.GROQ_API_KEY;
  delete process.env.OLLAMA_MODEL;
  process.env.OLLAMA_BASE_URL = `http://127.0.0.1:${port}/v1`;

  try {
    const response = await POST(new Request("http://127.0.0.1/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ consent: true, messages: [message("user", "Help me begin")] }),
    }));
    assert.equal(response.status, 200);
    assert.match(await response.text(), /ollama serve.*llama3\.2:latest/s);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("production chat requires Groq and Upstash rather than attempting local Ollama", async () => {
  process.env.NODE_ENV = "production";
  process.env.AI_CHAT_ENABLED = "true";
  delete process.env.OLLAMA_API_KEY;
  delete process.env.GROQ_API_KEY;
  const response = await POST(new Request("https://daybreak.example/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ consent: true, messages: [message("user", "Hello")] }),
  }));
  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /OLLAMA_API_KEY or GROQ_API_KEY/i);
});

test("production Ollama Cloud requires Upstash rate limiting", async () => {
  process.env.NODE_ENV = "production";
  process.env.AI_CHAT_ENABLED = "true";
  process.env.OLLAMA_API_KEY = "server-only-test-key";
  delete process.env.GROQ_API_KEY;
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  const response = await POST(new Request("https://daybreak.example/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json", "x-real-ip": "203.0.113.10" },
    body: JSON.stringify({ consent: true, messages: [message("user", "Hello")] }),
  }));
  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /Upstash/i);
});

test("chat API streams from Ollama Cloud with its server-only key and requested model", async () => {
  process.env.NODE_ENV = "development";
  process.env.AI_CHAT_ENABLED = "true";
  process.env.OLLAMA_API_KEY = "server-only-test-key";
  delete process.env.GROQ_API_KEY;
  let ollamaRequest;
  globalThis.fetch = async (input, init) => {
    ollamaRequest = {
      url: String(input),
      authorization: new Headers(init.headers).get("authorization"),
      body: JSON.parse(init.body),
    };
    return new Response([
      'data: {"id":"chatcmpl-test","object":"chat.completion.chunk","created":1,"model":"glm-5.3-flash","choices":[{"index":0,"delta":{"role":"assistant","content":"A considered next step."},"finish_reason":null}]}',
      "",
      'data: {"id":"chatcmpl-test","object":"chat.completion.chunk","created":1,"model":"glm-5.3-flash","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}',
      "",
      "data: [DONE]",
      "",
      "",
    ].join("\n"), { status: 200, headers: { "content-type": "text/event-stream" } });
  };

  const response = await POST(new Request("http://127.0.0.1/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ consent: true, messages: [message("user", "Help me plan")] }),
  }));
  assert.equal(response.status, 200);
  assert.match(await response.text(), /A considered next step\./);
  assert.equal(ollamaRequest.url, "https://ollama.com/v1/chat/completions");
  assert.equal(ollamaRequest.authorization, "Bearer server-only-test-key");
  assert.equal(ollamaRequest.body.model, "glm-5.3-flash");
  assert.match(JSON.stringify(ollamaRequest.body.messages), /AI provider: Ollama Cloud/);
  assert.match(
    JSON.stringify(ollamaRequest.body.messages),
    /Current date and time: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+08:00 \(Singapore Time, SGT\)/,
  );
});

test("production Groq chat fails closed without Upstash rate limiting", async () => {
  process.env.NODE_ENV = "production";
  process.env.AI_CHAT_ENABLED = "true";
  delete process.env.OLLAMA_API_KEY;
  process.env.GROQ_API_KEY = "server-only-test-key";
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  const response = await POST(new Request("https://daybreak.example/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json", "x-real-ip": "203.0.113.10" },
    body: JSON.stringify({ consent: true, messages: [message("user", "Hello")] }),
  }));
  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /Upstash/i);
});

test("chat API streams from Groq with the server-only key and configured model", async () => {
  process.env.NODE_ENV = "development";
  process.env.AI_CHAT_ENABLED = "true";
  delete process.env.OLLAMA_API_KEY;
  process.env.GROQ_API_KEY = "server-only-test-key";
  let groqRequest;
  globalThis.fetch = async (input, init) => {
    groqRequest = {
      url: String(input),
      authorization: new Headers(init.headers).get("authorization"),
      body: JSON.parse(init.body),
    };
    return new Response([
      'data: {"id":"chatcmpl-test","object":"chat.completion.chunk","created":1,"model":"llama-3.1-8b-instant","choices":[{"index":0,"delta":{"role":"assistant","content":"A measured next step."},"finish_reason":null}]}',
      "",
      'data: {"id":"chatcmpl-test","object":"chat.completion.chunk","created":1,"model":"llama-3.1-8b-instant","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}',
      "",
      "data: [DONE]",
      "",
      "",
    ].join("\n"), { status: 200, headers: { "content-type": "text/event-stream" } });
  };

  const response = await POST(new Request("http://127.0.0.1/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ consent: true, messages: [message("user", "Help me plan")] }),
  }));
  assert.equal(response.status, 200);
  assert.match(await response.text(), /A measured next step\./);
  assert.equal(groqRequest.url, "https://api.groq.com/openai/v1/chat/completions");
  assert.equal(groqRequest.authorization, "Bearer server-only-test-key");
  assert.equal(groqRequest.body.model, "llama-3.1-8b-instant");
  assert.match(
    JSON.stringify(groqRequest.body.messages),
    /AI provider: Groq Cloud/,
  );
  assert.match(
    JSON.stringify(groqRequest.body.messages),
    /Current date and time: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+08:00 \(Singapore Time, SGT\)/,
  );
});

test("chat API rejects oversized bodies while reading the request", async () => {
  const response = await POST(new Request("https://daybreak.invalid/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ consent: true, messages: [message("user", "x".repeat(25_000))] }),
  }));
  assert.equal(response.status, 413);
});

test("planner static assets and app-relative module imports resolve", async () => {
  const { readFile, readdir, stat } = await import("node:fs/promises");
  const { dirname, join, resolve } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

  async function filesIn(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    const nested = await Promise.all(entries.map((entry) => entry.isDirectory()
      ? filesIn(join(directory, entry.name))
      : [join(directory, entry.name)]));
    return nested.flat();
  }

  for (const documentPath of ["public/planner/index.html", "public/planner/tests/index.html"]) {
    const absoluteDocumentPath = join(root, documentPath);
    const html = await readFile(absoluteDocumentPath, "utf8");
    for (const [, assetPath] of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
      if (/^(?:[a-z]+:|#|\/)/i.test(assetPath)) continue;
      await stat(resolve(dirname(absoluteDocumentPath), assetPath));
    }
  }

  for (const sourcePath of await filesIn(join(root, "app"))) {
    if (!/\.(?:js|jsx|mjs)$/.test(sourcePath)) continue;
    const source = await readFile(sourcePath, "utf8");
    for (const [, importedPath] of source.matchAll(/(?:from\s*|import\s*\()\s*["']([^"']+)["']/g)) {
      if (!importedPath.startsWith(".")) continue;
      await stat(resolve(dirname(sourcePath), importedPath));
    }
  }
});
