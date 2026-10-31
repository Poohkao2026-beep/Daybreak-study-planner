# Daybreak

Daybreak is a local-first study planner with an optional, explicitly consented AI study-support chat.

## Run locally

Use Node.js 20.9 or newer:

```sh
npm install
npm run dev
```

Open <http://localhost:3000>. The Next.js support page is at `/`; the existing planner is preserved at `/planner/`.

Study Support uses Ollama Cloud (`glm-5.3-flash`) when a server-side `OLLAMA_API_KEY` is configured; otherwise it uses Groq Cloud when `GROQ_API_KEY` is set, then falls back to local Ollama during development. Set `AI_CHAT_ENABLED=true` and restart Daybreak. Never expose provider credentials with a `NEXT_PUBLIC_` prefix.

## Tests

- `npm run test:api` checks chat-request validation, fail-closed configuration, and deployment asset/module paths.
- Open `/planner/tests/index.html` in the running app for the dependency-free browser suite. It uses a randomly named temporary IndexedDB database and does not read or modify planner localStorage.
- `npm run build` checks the production Next.js build.

## Planner

The planner remains static and local-first under `public/planner/`. Subjects, tasks, focus sessions, and settings stay in this browser's IndexedDB; the migration keeps the old `studyloop.v1` value and its safety copy. The planner includes task and subject management, quick add, daily productivity tips, a customizable focus timer, optional browser-generated focus sounds with volume controls, appearance settings, and JSON backup/restore. Focus sounds are off until the user starts them and are not streamed or uploaded. An optional YouTube Music search link opens external music in a new tab; users control playback on that service.

## Study Support privacy

Study Support sends typed messages to the configured provider only after the user checks the consent box. Provider priority is Ollama Cloud (`OLLAMA_API_KEY`, model `glm-5.3-flash`), Groq Cloud (`GROQ_API_KEY`, model `llama-3.1-8b-instant`), then local Ollama in development (`OLLAMA_MODEL`, default `llama3.2:latest`). Cloud requests use server-side keys; planner data is never included, and chats are not stored in planner storage. The assistant receives the current Singapore Time (SGT, UTC+08:00) date and time for deadline reasoning, recognizes Daybreak quick-add tags, and must not claim to read or edit planner tasks. The local fallback accepts only loopback URLs and is unavailable in production. Do not set `OLLAMA_ORIGINS=*`: the browser talks to Daybreak, not directly to Ollama. The assistant is not a therapist, clinician, or emergency service.

Local setup, using separate terminal windows:

```sh
ollama pull llama3.2:latest
```

Start Ollama if the desktop app has not already started it:

```sh
ollama serve
```

In another terminal, run `cp .env.example .env.local`, change `AI_CHAT_ENABLED=false` to `AI_CHAT_ENABLED=true`, then run `npm run dev`. Optional settings are `OLLAMA_BASE_URL=http://127.0.0.1:11434/v1` and `OLLAMA_MODEL=llama3.2:latest`. The `qwen2.5-coder:7b` model is optional and is not used by Study Support. No `OLLAMA_ORIGINS` setting is needed.

## Vercel deployment

For hosted chat, configure `AI_CHAT_ENABLED=true`, `OLLAMA_API_KEY` (or `GROQ_API_KEY`), `UPSTASH_REDIS_REST_URL`, and `UPSTASH_REDIS_REST_TOKEN` in Vercel's server-side project environment settings. Production chat uses the selected cloud provider and a per-IP Upstash limit of 8 messages per 10 minutes; it never falls back to local Ollama. The consent notice explains that messages are sent to the configured cloud provider. Without a cloud key or rate-limit configuration, production chat fails closed.
