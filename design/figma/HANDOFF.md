# Daybreak Figma handoff

This is an implementation-matched handoff for recreating Daybreak in Figma. No Figma file is connected to this workspace, so this handoff does not claim to create or edit a live Figma document.

## Importable tokens

Import [`daybreak.tokens.json`](./daybreak.tokens.json) as a Design Tokens Community Group (DTCG) token file using Tokens Studio, or use its values to create Figma local variables. The `color.dark` group is the dark-theme collection. Keep semantic variables (canvas, surface, text, accent, status) separate from subject-label colors.

The running CSS source is [`../../public/planner/tokens.css`](../../public/planner/tokens.css); component styles are in [`../../public/planner/styles.css`](../../public/planner/styles.css). Keep both in sync with any design-file changes.

## Page and frame map

Create a `Daybreak · Planner` page with these frames:

| Frame | Reference size | Layout |
|---|---:|---|
| Today · desktop | 1440 × 1000 | 240 px persistent sidebar; centered content up to 1152 px; main column and support rail |
| Today · mobile | 390 × 844 | Single content column; six-item bottom navigation with safe-area padding |
| Focus · desktop | 1440 × 1000 | Duration, task, and sound controls beside recent sessions |
| Focus · mobile | 390 × 844 | Stacked timer and session history; full-width controls |
| Settings · desktop | 1440 × 1000 | Grouped appearance, privacy, backup, and recovery panels |
| Settings · mobile | 390 × 844 | One-column panels; controls stay thumb-friendly |

Use the app breakpoints as references: 1024 px for compact sidebar/content, 760 px for mobile navigation, and 480 px for the narrow-phone layout. Keep the layout usable down to 288 px without horizontal scrolling.

## Components and states

- **Navigation item:** default, hover, keyboard focus, active. Active route uses the accent-subtle fill and accent text.
- **Primary button:** default, hover, pressed, disabled, visible focus ring. Minimum target height is 44 px.
- **Task row:** open, completed, dragging, keyboard-reorder action; preserve the visible task title and due metadata in every state.
- **Next Up card:** recommendation, no tasks, no subjects, alternatives expanded. Use one clear primary action; avoid guilt or streak pressure.
- **Daily tip card:** one calm suggestion per local day with a path to start a focus block.
- **Focus timer:** editable 1–180 minute duration, presets, saved default, linked/unlinked task, running, paused, complete, early finish.
- **Sound controls:** opt-in play/stop, ambient/pink/brown generated sound, persistent volume preference, visible 0–100% value. Silence remains the default.
- **Chat consent:** unchecked by default; sending is unavailable until consent. Keep a plain-language destination and data-sharing notice adjacent to the checkbox.
- **Feedback:** storage errors, save confirmation, chat configuration errors, and empty states need both visible text and an accessible status/alert role.

## Interaction and accessibility notes

- Keep all existing planner data local to the browser. Do not depict cloud sync or automatic university integration.
- Focus audio is generated locally. External music is a separate link and the user controls that service in its own tab.
- Preserve keyboard navigation, visible focus, semantic headings/labels, sufficient contrast, and reduced-motion behavior.
- Dark and light modes must use semantic tokens rather than hard-coded component colors.
- Do not use punitive streaks, shame copy, surprise audio, auto-play, or automatic chat-context sharing.

## Visual direction

Calm study studio: warm neutral canvas, restrained indigo action color, generous whitespace, clear type hierarchy, subtle card depth, and a quiet ambient background. The visual system should make the next step obvious without making the interface feel like an alarm or productivity scoreboard.
