const MAX_MESSAGES = 20;
const MAX_MESSAGE_LENGTH = 2_000;
const MAX_HISTORY_LENGTH = 12_000;
const allowedMessageKeys = new Set(["id", "role", "parts", "metadata"]);
const allowedPartKeys = new Set(["type", "text", "state"]);

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function validateChatRequest(payload) {
  if (!isRecord(payload) || Object.keys(payload).some((key) => !["consent", "messages"].includes(key))) {
    return { valid: false, error: "Only explicit consent and chat messages are accepted." };
  }
  if (payload.consent !== true) return { valid: false, error: "Consent is required before sending messages." };
  if (!Array.isArray(payload.messages) || payload.messages.length < 1 || payload.messages.length > MAX_MESSAGES) {
    return { valid: false, error: "Start a new chat before sending more messages." };
  }

  const messages = [];
  let historyLength = 0;
  for (const message of payload.messages) {
    if (!isRecord(message) || Object.keys(message).some((key) => !allowedMessageKeys.has(key))) {
      return { valid: false, error: "Only plain text chat messages are accepted." };
    }
    if (!["user", "assistant"].includes(message.role) || !Array.isArray(message.parts) || message.parts.length < 1) {
      return { valid: false, error: "The chat history contains an invalid message." };
    }

    let text = "";
    for (const part of message.parts) {
      if (!isRecord(part) || Object.keys(part).some((key) => !allowedPartKeys.has(key)) || part.type !== "text" || typeof part.text !== "string") {
        return { valid: false, error: "Only plain text chat messages are accepted." };
      }
      text += part.text;
    }
    if (!text.trim() || text.length > MAX_MESSAGE_LENGTH) {
      return { valid: false, error: "Each message must contain 1–2,000 characters." };
    }

    historyLength += text.length;
    if (historyLength > MAX_HISTORY_LENGTH) return { valid: false, error: "This conversation is too long. Start a new chat to continue." };
    messages.push({ role: message.role, content: text });
  }

  if (messages.at(-1)?.role !== "user") return { valid: false, error: "Send a message to continue the conversation." };
  return { valid: true, messages };
}
