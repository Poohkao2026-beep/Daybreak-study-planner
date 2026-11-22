# Daybreak student preview

[Open the Planner](https://daybreak-study-planner.vercel.app/planner) · [Open Study Support](https://daybreak-study-planner.vercel.app/)

**November 22, 2026** · Public preview · Official launch target **March 2027**

Choose English or ไทย on your first visit. Add a course, capture an assignment, and give it a study date. Today will suggest a next step. Start a focus session on that task, then return to Progress to see the work you recorded.

## What students can use

| Area | Available in the hosted preview | Conditions and limits |
| --- | --- | --- |
| Getting started | English and Thai, remembered language, optional spoken welcome, day and night themes | Welcome audio follows a language selection and browser playback permissions. |
| Today | Auto, Spotlight, Exam Crunch and Recovery modes. The workload horizon shows planned minutes, available capacity and deadlines. Select a day to inspect it. | Recommendations use the tasks, estimates, sleep window and schedule you enter. Missing estimates limit the forecast. |
| Courses and tasks | Quick capture, priorities, subtasks, separate study and due dates, course grades and weighted grade triage | Grade suggestions depend on supplied weights and scores. Official university records are maintained by the university. |
| Focus and review | 25-minute Small Start, 65-minute Deep Work, 180-minute Full Immersion, adjustable sessions up to 12 hours, Zen view, local soundscapes, pause notes and recall prompts | Audio requires browser support. Session history reflects recorded work. |
| Progress and exam preparation | Completed work, focus history, course progress, exam readiness and revision planning | Some exam planning tools check for a Pro entitlement. Live paid access is outside this preview release. |
| Calendar and course setup | Import supported calendar feeds, export a calendar, share a course template and merge it into a planner. Resync preserves personal study dates and notes. AI-assisted syllabus parsing offers a review step. | A compatible feed or template is required. Calendar import provides one-way updates. Syllabus AI requires account access and consent. |
| Study Support | Signed-in, opt-in study chat with Google Gemini; optional study context and task breakdowns | The hosted readiness check passed on November 22. This release check covered configuration only. Actual replies depend on sign-in, consent, provider availability and quota. |
| Weather | Optional weather-aware planning with city search and forecasts through WeatherAPI | Fresh forecasts need connectivity, provider access and available quota. |
| Storage and accounts | Guest planning in local IndexedDB, JSON backup and restore, optional offline reopening, Firebase accounts and account-scoped synchronization | Save a backup before clearing site data. First use needs connectivity. Sync requires an account, connectivity and a configured cloud database. End-to-end production sync was outside this release check. |
| Payments | The product includes a separate subscription service and Stripe sandbox integration | Public purchasing, final prices and a live billing launch date are unconfirmed. |

## Technology

The hosted planner uses Next.js 16 App Router, React 19 and JavaScript. IndexedDB stores planner records per browser profile. Signed-in records have a separate database and a queue for pending changes. Firebase Authentication handles identity, Firebase Admin verifies tokens on the server, and Firestore rules govern synchronized records. Server routes handle Gemini and WeatherAPI calls. The browser synthesizes focus sound using the Web Audio API. The billing service uses Java 21, Spring Boot, PostgreSQL, Flyway and Stripe. Vercel hosts the web release.

The public repository also preserves the earlier Foundation implementation. Running its root source locally starts that edition. This launcher opens the current hosted preview. The product has no native mobile installer in this release.

## Release checks

The hosted revision passed 337 Planner tests and 183 API tests, bilingual catalog and type checks, and a production build. Browser checks selected every workspace mode at 320, 768 and 1440 pixels in both languages. Initial Planner JavaScript measured 212,347 bytes gzipped against a 235,000-byte ceiling. These checks cover the web release; they do not certify every browser, external account or provider.

## Proposed route to March 2027

| Target | Work before launch | Evidence to review |
| --- | --- | --- |
| November 2026 | Publish the preview and gather feedback on the first task, mode switcher and first focus session. | Reproducible issues with language, screen size and steps. |
| December 2026 | Exercise sign-in, offline reopening, account switching, interrupted sync and backup restoration on real devices. | Restored records match the originals, including notes and study dates. |
| January 2027 | Pilot syllabus and calendar imports with students. Check Thai accessibility, forecast failures and AI quota handling. | Students can review imported changes and keep planning during a provider outage. |
| February 2027 | Rehearse the release candidate, support process and rollback. Review subscription costs, tax treatment and entitlement recovery. | Documented launch decision for each paid or externally hosted feature. |
| March 2027 | Target the official web launch after accessibility, data recovery, sign-in and service readiness reviews. | Publish final availability, support information, release notes and any deferred features. |

## Use the launcher

The browser links above require no installation. For the command line, download the launcher tarball from [GitHub Releases](https://github.com/Poohkao2026-beep/Daybreak-study-planner/releases). With Node.js 20 or later, run:

```sh
npm install --global ./poohkao2026-beep-daybreak-planner-launcher-0.2.0-preview.1.tgz
daybreak-planner --open
```

Running `daybreak-planner` alone prints the URL, including on a headless machine. The tarball contains the launcher and this guide and has no runtime dependencies. The release also includes its SHA-256 checksum.
