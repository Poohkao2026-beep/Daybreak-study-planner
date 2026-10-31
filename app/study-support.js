"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useMemo, useRef, useState } from "react";

const starterPrompts = [
  "Help me break a study task into small steps.",
  "I feel overwhelmed. Help me pause and reset.",
  "I missed a day. Help me make a gentle restart.",
];

function getVisibleChatError(error) {
  const fallback = "The response could not be completed. Please try again.";
  if (!error?.message) return fallback;
  if (/failed to fetch|networkerror|load failed/i.test(error.message)) {
    const localHost = ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);
    return localHost
      ? "Can't reach the Daybreak server. Start it with `npm run dev`, then open http://localhost:3000."
      : "Can't reach the Study Support server. Check your connection and try again later.";
  }
  try {
    const body = JSON.parse(error.message);
    if (typeof body.error === "string") return body.error;
  } catch {
    return error.message;
  }
  return error.message;
}

export default function StudySupport() {
  const [consent, setConsent] = useState(false);
  const [input, setInput] = useState("");
  const inputRef = useRef(null);
  const transport = useMemo(() => new DefaultChatTransport({
    api: "/api/chat",
    prepareSendMessagesRequest: ({ messages }) => ({
      body: { consent, messages: messages.slice(-20) },
    }),
  }), [consent]);
  const { messages, sendMessage, status, error, setMessages, stop } = useChat({ transport });
  const busy = status === "submitted" || status === "streaming";

  function submitMessage(event) {
    event.preventDefault();
    const text = input.trim();
    if (!text || !consent || busy) return;
    sendMessage({ text });
    setInput("");
  }

  function choosePrompt(prompt) {
    setInput(prompt);
    inputRef.current?.focus();
  }

  return (
    <main className="support-shell min-h-screen flex flex-col">
      <header className="support-header">
        <a className="wordmark" href="/planner/index.html#today" aria-label="Daybreak planner">daybreak<span>.</span></a>
        <nav className="support-nav" aria-label="Daybreak links">
          <a href="/planner/index.html#today">Open planner</a>
          <span aria-current="page">Study support</span>
        </nav>
      </header>

      <div className="support-main mx-auto w-full flex-1">
        <div className="support-heading">
          <p className="eyebrow">A GENTLER WAY FORWARD</p>
          <h1>Study support</h1>
          <p className="lede">Talk through a tough study moment or find one manageable next step. Start wherever you are.</p>
        </div>

        <div className="support-grid">
          <section className="chat-panel overflow-hidden rounded-2xl bg-white" aria-label="Study Support chat">
            <div className="chat-panel-header">
              <div>
                <h2>Your study buddy</h2>
                <p>AI support, on your terms</p>
              </div>
              <button
                className="text-button"
                type="button"
                onClick={() => setMessages([])}
                disabled={messages.length === 0 || busy}
              >
                New chat
              </button>
            </div>

            <div className="chat-transcript" aria-live="polite" aria-relevant="additions text">
              {messages.length === 0 ? (
                <div className="chat-intro">
                  <p>I can help you untangle a task, plan a small study step, or take a breath and reset.</p>
                  <p className="quiet-copy">I’m an AI study companion, not a therapist, clinician, or emergency service.</p>
                  <div className="starter-list" aria-label="Conversation starters">
                    {starterPrompts.map((prompt) => (
                      <button className="starter-button" key={prompt} type="button" onClick={() => choosePrompt(prompt)}>
                        {prompt}
                      </button>
                    ))}
                  </div>
                </div>
              ) : messages.map((message) => (
                <article className={`message message-${message.role}`} key={message.id}>
                  <p className="message-label">{message.role === "user" ? "You" : "Study buddy"}</p>
                  {message.parts.map((part, index) => part.type === "text"
                    ? <p className="message-text" key={`${message.id}-${index}`}>{part.text}</p>
                    : null)}
                </article>
              ))}
              {busy && (
                <p className="response-status" role="status">
                  {status === "submitted" ? "Finding a helpful next step…" : "Writing…"}
                </p>
              )}
              {error && <p className="chat-error" role="alert">{getVisibleChatError(error)}</p>}
            </div>

            <div className="chat-compose">
              <label className="consent-row">
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={(event) => setConsent(event.target.checked)}
                />
                <span>I agree to send my typed messages to Daybreak’s configured AI provider. Ollama Cloud is used if OLLAMA_API_KEY is set, then Groq Cloud if GROQ_API_KEY is set; otherwise, local Ollama is used during development. Planner data is never included.</span>
              </label>
              <p className="privacy-note">When a cloud provider is configured, messages are sent to that provider. Otherwise, during local development, messages go to Ollama on this computer. Chat is not saved in planner storage.</p>
              <form className="chat-form" onSubmit={submitMessage}>
                <label className="visually-hidden" htmlFor="support-message">Your message</label>
                <textarea
                  id="support-message"
                  ref={inputRef}
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      event.currentTarget.form?.requestSubmit();
                    }
                  }}
                  maxLength={2_000}
                  placeholder="What would feel helpful right now?"
                  rows={3}
                  disabled={busy}
                />
                <div className="compose-footer">
                  <span className="quiet-copy">Enter to send · Shift+Enter for a new line</span>
                  {busy ? (
                    <button className="button button-secondary" type="button" onClick={() => stop()}>
                      Stop
                    </button>
                  ) : (
                    <button className="button button-primary" type="submit" disabled={!consent || !input.trim()}>
                      Send message
                    </button>
                  )}
                </div>
              </form>
            </div>
          </section>

          <aside className="support-aside">
            <section className="aside-section">
              <p className="eyebrow">A SMALL STEP COUNTS</p>
              <h2>What we can work on</h2>
              <ul>
                <li>Break a task into a first, five-minute step.</li>
                <li>Make a realistic plan around your energy.</li>
                <li>Reset without guilt after a difficult day.</li>
              </ul>
            </section>
            <section className="aside-section boundary-note">
              <h2>When you need more support</h2>
              <p>This AI can listen and help you reflect, but it can’t provide professional care. If you may be in immediate danger, contact local emergency services or someone you trust.</p>
            </section>
            <a className="planner-return" href="/planner/index.html#today">Return to your planner <span aria-hidden="true">→</span></a>
          </aside>
        </div>
      </div>
      <footer className="support-footer">A quiet place to think. Your planner stays yours.</footer>
    </main>
  );
}
