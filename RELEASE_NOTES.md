# November 2026 student preview · 0.2.0-preview.1

[Open the deployed Planner](https://daybreak-study-planner.vercel.app/planner). This preview introduces the public launcher for the hosted English and Thai planner. The four-mode switcher now fits in a two-by-two grid on phones. On the Horizon renders upcoming workload as a landscape, with a brief completion effect that respects reduced motion.

The release assets contain the launcher and its SHA-256 checksum. See the [complete preview guide](https://github.com/Poohkao2026-beep/Daybreak-study-planner/blob/preview-0.2.0-1/packages/planner-launcher/README.md) for current capabilities, service limits, technical details and the proposed March 2027 launch roadmap.

---

# Daybreak v0.1.0 — Foundation

This is the first versioned source release of the **existing public GitHub implementation**. It is a foundation release, not the full planned Daybreak Pro or 2027 roadmap.

## Included

- Local-first planner at `/planner/` with subjects, tasks, quick-add, focus sessions, settings, and JSON backup/restore.
- IndexedDB browser persistence, including legacy-data migration safeguards.
- Optional Study Support chat at `/`, gated on explicit consent and an `AI_CHAT_ENABLED` flag.
- Ollama Cloud and Groq server-side integrations, with local Ollama available only in development.
- Production rate-limit prerequisites via Upstash; cloud chat fails closed when required configuration is absent.
- API tests and browser test page (`/planner/tests/index.html`).

## Limitations

- No hosted account synchronization or collaborative progress sharing.
- No verified Gemini integration, full academic timetables, gradebook, exam scheduler, or Pro checkout in this repository.
- The included ZIP is **source code**, not a standalone executable, mobile app, or npm library.
- The browser planner uses local storage; backup before clearing browser site data.
- AI requires separate server-side configuration, and message data is sent to the provider only with consent.

## Run locally

Requires Node.js 20.9 or newer.

```sh
npm ci
npm run test:api
npm run build
npm run dev
```

Visit `http://localhost:3000/planner/` for the planner or `http://localhost:3000/` for Study Support. Chat is off by default. No live paid AI calls are needed to run the tests or build.

See [README.md](README.md) and [.env.example](.env.example) for documentation. Never commit credentials.
