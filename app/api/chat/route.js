import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { streamText } from "ai";
import { validateChatRequest } from "../../lib/chat-validation.js";

export const maxDuration = 30;

const MAX_BODY_BYTES = 24 * 1024;
const GROQ_MODEL = "llama-3.1-8b-instant";
let limiter;
const singaporeDateTimeFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Singapore",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});
const systemPrompt = `You are Daybreak's supportive study companion. Help the user reflect, organize study work, and find one manageable next step. Be warm, calm, specific, and non-judgmental; never shame them for missed days or imply that productivity determines their worth. Ask at most one gentle question at a time.

Daybreak principles:
- Use quiet academic clarity. Do not use decorative emoji, hype, fake motivational statistics, streaks, badges, levels, or other gamification.
- Be honest about recommendations. Base task ordering and study rhythms (Light, Steady, or Deep Focus) only on dates, priorities, deadlines, and constraints the user actually gave you. Explain the reason plainly. Do not invent workload, deadlines, available time, or planner data; ask one concise question if a necessary detail is missing.
- Break tasks into manageable, concrete steps when useful. You may help plan from information the user provides, but you cannot view or edit their Daybreak planner and must never claim to have scheduled, saved, or changed anything.
- When the user requests JSON, return valid JSON only, with no surrounding prose or code fences. Otherwise use concise, scannable Markdown and do not begin with meta-chatter such as "Sure, here is your plan" or "As an AI".
- Interpret relative dates, deadlines, and midnight boundaries in Singapore Time (SGT, UTC+08:00), using the current SGT date and time supplied below. Use YYYY-MM-DD for unambiguous absolute dates.
- Recognize Daybreak quick-add syntax when explaining or formatting a task: #SubjectName for a subject, today, tomorrow, or YYYY-MM-DD for a date, 30m, 1h, or 45m for an estimate, and !high, !medium, or !low for priority. These are text conventions only; you cannot add the task to the planner.

You are an AI, not a therapist, clinician, or emergency service. Do not diagnose, prescribe, or claim professional expertise. For an immediate danger or a stated plan to hurt themselves or someone else, respond with empathy, encourage them to contact local emergency services or a trusted person now, and do not provide harmful instructions. Do not invent hotline numbers or claim you contacted anyone.

The user has explicitly consented to send their typed chat messages to the AI provider identified below. Daybreak does not provide you with planner data, identity, or background activity. Do not claim access to any of those.`;

function currentSingaporeDateTime() {
  const parts = Object.fromEntries(
    singaporeDateTimeFormatter.formatToParts(new Date()).map(({ type, value }) => [type, value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}+08:00`;
}

function jsonResponse(status, body, headers = {}) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...headers,
    },
  });
}

function getLocalOllamaUrl() {
  const value = process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434/v1";
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (
    url.protocol !== "http:"
    || !["127.0.0.1", "localhost", "::1"].includes(url.hostname)
    || url.username
    || url.password
    || url.search
    || url.hash
  ) return null;
  return url.toString().replace(/\/+$/, "");
}

function getLimiter() {
  if (limiter) return limiter;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  limiter = new Ratelimit({
    redis: new Redis({ url, token }),
    limiter: Ratelimit.slidingWindow(8, "10 m"),
    prefix: "daybreak:study-support",
  });
  return limiter;
}

async function checkCloudRateLimit(request) {
  const rateLimiter = getLimiter();
  if (!rateLimiter) {
    return jsonResponse(503, { error: "Cloud Study Support requires Upstash rate-limit settings. Your message was not sent." });
  }
  const ip = request.headers.get("x-real-ip")
    || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (!ip) return jsonResponse(503, { error: "Study Support could not verify this request safely." });

  try {
    const limit = await rateLimiter.limit(`ip:${ip}`);
    if (!limit.success) {
      const retryAfter = Math.max(1, Math.ceil((limit.reset - Date.now()) / 1_000));
      return jsonResponse(429, { error: "You’ve reached the short-term chat limit. Please try again later." }, {
        "Retry-After": String(retryAfter),
      });
    }
  } catch (error) {
    console.error("Study Support rate limiting failed.", { name: error?.name || "Error" });
    return jsonResponse(503, { error: "Study Support is temporarily unavailable. Your message was not sent." });
  }
  return null;
}

async function readBoundedBody(request) {
  const reader = request.body?.getReader();
  if (!reader) return "";
  const chunks = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_BODY_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function POST(request) {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return jsonResponse(415, { error: "Send the request as application/json." });
  }

  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return jsonResponse(413, { error: "This conversation is too large. Start a new chat." });
  }

  let rawBody;
  try {
    rawBody = await readBoundedBody(request);
  } catch {
    return jsonResponse(400, { error: "The chat request could not be read." });
  }
  if (rawBody === null) {
    return jsonResponse(413, { error: "This conversation is too large. Start a new chat." });
  }

  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return jsonResponse(400, { error: "Send a valid JSON request." });
  }

  const validated = validateChatRequest(payload);
  if (!validated.valid) return jsonResponse(400, { error: validated.error });

  if (process.env.AI_CHAT_ENABLED !== "true") {
    return jsonResponse(503, { error: "Study Support is turned off. Set AI_CHAT_ENABLED=true in the server environment and restart Daybreak." });
  }

  const ollamaApiKey = process.env.OLLAMA_API_KEY;
  const groqApiKey = process.env.GROQ_API_KEY;
  let model;
  let providerDescription;
  if ((ollamaApiKey || groqApiKey) && process.env.NODE_ENV === "production") {
    const rateLimitError = await checkCloudRateLimit(request);
    if (rateLimitError) return rateLimitError;
  }
  if (ollamaApiKey) {
    const ollamaCloud = createOpenAICompatible({
      name: "ollama-cloud",
      baseURL: "https://ollama.com/v1",
      apiKey: ollamaApiKey,
    });
    model = ollamaCloud("glm-5.3-flash");
    providerDescription = "Ollama Cloud";
  } else if (groqApiKey) {
    const groq = createOpenAICompatible({
      name: "groq",
      baseURL: "https://api.groq.com/openai/v1",
      apiKey: groqApiKey,
    });
    model = groq(GROQ_MODEL);
    providerDescription = "Groq Cloud";
  } else {
    const requestHost = new URL(request.url).hostname;
    if (
      process.env.NODE_ENV !== "development"
      || !["localhost", "127.0.0.1", "::1"].includes(requestHost)
    ) {
      return jsonResponse(503, { error: "Local Ollama is available only from the Daybreak app running on this computer. Configure OLLAMA_API_KEY or GROQ_API_KEY for hosted Study Support." });
    }
    const baseURL = getLocalOllamaUrl();
    if (!baseURL) {
      return jsonResponse(503, { error: "OLLAMA_BASE_URL must point to a local Ollama server, such as http://127.0.0.1:11434/v1." });
    }
    const ollama = createOpenAICompatible({ name: "ollama", baseURL });
    const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "llama3.2:latest";
    model = ollama(OLLAMA_MODEL);
    providerDescription = "Ollama running on this computer";
  }

  try {
    const result = streamText({
      model,
      system: `${systemPrompt}\n\nAI provider: ${providerDescription}.\nCurrent date and time: ${currentSingaporeDateTime()} (Singapore Time, SGT).`,
      messages: validated.messages,
      maxOutputTokens: 700,
      abortSignal: request.signal,
    });
    return result.toUIMessageStreamResponse({
      headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
      onError: (error) => {
        console.error(`${providerDescription} request failed.`, { name: error?.name || "Error" });
        if (providerDescription === "Ollama Cloud") {
          return "Ollama Cloud couldn’t complete that reply. Check the server configuration and try again.";
        }
        return providerDescription === "Groq Cloud"
          ? "Groq Cloud couldn’t complete that reply. Check the server configuration and try again."
          : `Local Ollama didn’t reply. Make sure \`ollama serve\` is running and \`${process.env.OLLAMA_MODEL || "llama3.2:latest"}\` is installed.`;
      },
    });
  } catch (error) {
    console.error(`${providerDescription} request failed.`, { name: error?.name || "Error" });
    return jsonResponse(502, {
      error: providerDescription === "Ollama Cloud"
        ? "Could not reach Ollama Cloud. Check your server-side OLLAMA_API_KEY and try again."
        : providerDescription === "Groq Cloud"
          ? "Could not reach Groq Cloud. Check your server-side GROQ_API_KEY and try again."
          : "Could not reach Ollama. Start Ollama with `ollama serve` and confirm your model is installed with `ollama list`.",
    });
  }
}
