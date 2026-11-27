# Daybreak Study Planner

Daybreak is a local-first study planner in English and Thai. It helps students choose what to study next, make time to focus, and keep study dates separate from deadlines.

[Try the hosted Planner](https://daybreak-study-planner.vercel.app/planner) · [Read the preview guide](packages/planner-launcher/README.md) · [Download the optional launcher](https://github.com/Poohkao2026-beep/Daybreak-study-planner/releases/tag/preview-0.2.0-1)

## Try it in two minutes

1. Open the hosted Planner and choose English or ไทย.
2. Add a course and a sample assignment. Give it a study date and a separate due date.
3. Open Today, choose the assignment, and start a focus session.

Guest planning does not require an account. [Study Support](https://daybreak-study-planner.vercel.app/) is optional; see the [preview guide](packages/planner-launcher/README.md) for sign-in, consent, and availability details. March 2027 is the target for the official web launch, not a confirmed date.

## What’s in this repository?

| If you want to… | Start here |
| --- | --- |
| Try the current product | [Hosted preview](https://daybreak-study-planner.vercel.app/planner) |
| Open the hosted preview from a terminal | [Launcher documentation](packages/planner-launcher/README.md#use-the-launcher) |
| Explore or improve the earlier public implementation | [Foundation guide](FOUNDATION.md) |

The launcher opens the hosted preview; it does not install the current app. The Foundation source here is an earlier implementation, not the source for the hosted preview.

## Contribute or report a problem

Small documentation fixes and reproducible bug reports are a good place to start. In an [issue](https://github.com/Poohkao2026-beep/Daybreak-study-planner/issues), say whether you used the hosted preview, the launcher, or a local Foundation checkout. Include the language, browser and screen size, the shortest steps to reproduce, and what you expected. Use sample data in screenshots; omit real schedules, credentials, and account details.

For changes to the Foundation source, use Node.js 22 to match CI and run the same checks locally with AI disabled:

```sh
npm ci
AI_CHAT_ENABLED=false npm run test:api
AI_CHAT_ENABLED=false npm run build
```

For learner-facing changes, check the affected workflow in both English and Thai where supported.
