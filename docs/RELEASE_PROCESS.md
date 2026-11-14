# Daybreak release process

Daybreak is a private npm application package (`"private": true`), not a publishable npm library. Ship source archives as GitHub Releases. Do not publish to npm or enable a paid API to produce an artifact.

## Checks and source of truth

1. Keep AI off during validation: `AI_CHAT_ENABLED=false`.
2. From the exact commit to be released, run `npm ci`, `npm run test:api`, and `npm run build`.
3. Run the in-browser suite at `/planner/tests/index.html` in a real browser; CI currently does not automate this suite.
4. Review the changelog and any breaking changes, data migrations, and environment variables.
5. Confirm no credentials or personal data are present in committed files.
6. Merge reviewed release changes to `main` after CI is green.
7. Create and push an annotated version tag from the verified `main` commit, e.g. `git tag -a v0.1.0 -m "Daybreak v0.1.0"` followed by `git push origin v0.1.0`.
8. The release workflow reruns tests and build, creates a deterministic source ZIP from the checked-out tag, generates a SHA-256 checksum, and publishes the GitHub Release. Review the workflow result and release page.

The workflow intentionally does not tag or release on an ordinary push to `main`. It does not deploy a running service or bundle secrets. Do not create a GitHub Release until these checks succeed.

## Scope

This repository currently contains a Next.js Study Support page and a local-first static planner. Do not advertise unmerged features (Gemini, social media sharing, sync, full academic timetable, payments, etc.) as part of a release. Only publish user-facing functionality verified at the tagged commit.

## Security and privacy

- Server-only environment values belong in deployment secret settings, never a Git archive.
- Maintain consent-first AI and separation of planner data from chat.
- Never use live paid API calls in CI.
- Do not assume the repository's public visibility grants approval to deploy user data or credentials.
