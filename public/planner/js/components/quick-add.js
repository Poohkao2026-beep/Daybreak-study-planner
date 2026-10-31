import { addDays, dateKey } from "../lib/dates.js";

const weekdays = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

function nextWeekday(name, now) {
  const wanted = weekdays.indexOf(name.toLocaleLowerCase());
  if (wanted < 0) return null;
  const offset = (wanted - now.getDay() + 7) % 7 || 7;
  return addDays(dateKey(now), offset);
}

export function parseQuickAdd(input, subjects, now = new Date()) {
  let title = input.trim();
  const parsed = { title, subjectId: undefined, priority: "normal", dueDate: undefined, estimateMin: undefined, createSubjectName: undefined, ambiguity: undefined };
  const used = [];
  const subjectMatch = title.match(/(?:^|\s)#([\p{L}\p{N}_-]+)/u);
  if (subjectMatch) {
    const token = subjectMatch[1];
    const matches = subjects.filter((subject) => subject.name.toLocaleLowerCase() === token.toLocaleLowerCase() && !subject.archivedAt);
    if (matches.length === 1) {
      parsed.subjectId = matches[0].id;
      used.push(subjectMatch[0]);
    } else if (matches.length > 1) {
      parsed.ambiguity = `More than one subject matches #${token}. Choose a subject in the editor.`;
      used.push(subjectMatch[0]);
    } else {
      parsed.createSubjectName = token;
      used.push(subjectMatch[0]);
    }
  }

  const priorityMatch = title.match(/(?:^|\s)!(high|low)\b/i);
  if (priorityMatch) {
    parsed.priority = priorityMatch[1].toLowerCase();
    used.push(priorityMatch[0]);
  }

  const dateTokens = [
    { pattern: /(?:^|\s)today\b/i, resolve: () => dateKey(now) },
    { pattern: /(?:^|\s)tomorrow\b/i, resolve: () => addDays(dateKey(now), 1) },
    ...weekdays.map((day) => ({ pattern: new RegExp(`(?:^|\\s)${day}\\b`, "i"), resolve: () => nextWeekday(day, now) })),
  ];
  for (const token of dateTokens) {
    const match = title.match(token.pattern);
    if (!match) continue;
    if (parsed.dueDate) {
      parsed.ambiguity = "This quick add has more than one date. Keep one date token and try again.";
      break;
    }
    parsed.dueDate = token.resolve();
    used.push(match[0]);
  }

  const estimateMatch = title.match(/(?:^|\s)(30m|1h30m|1h)\b/i);
  if (estimateMatch) {
    parsed.estimateMin = estimateMatch[1].toLowerCase() === "30m" ? 30 : estimateMatch[1].toLowerCase() === "1h" ? 60 : 90;
    used.push(estimateMatch[0]);
  }

  for (const token of used) {
    const value = token.trim();
    const index = title.indexOf(value);
    if (index >= 0) title = `${title.slice(0, index)} ${title.slice(index + value.length)}`;
  }
  parsed.title = title.replace(/\s+/g, " ").trim();
  return parsed;
}

export function renderTokenChips(container, parsed, onRemove, onCreateSubject) {
  container.replaceChildren();
  const chips = [
    parsed.subjectId && ["Subject selected", "subjectId"],
    parsed.priority !== "normal" && [`${parsed.priority} priority`, "priority"],
    parsed.dueDate && [parsed.dueDate, "dueDate"],
    parsed.estimateMin && [`${parsed.estimateMin} min`, "estimateMin"],
  ].filter(Boolean);
  for (const [label, key] of chips) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "quick-token";
    chip.textContent = `${label} ×`;
    chip.setAttribute("aria-label", `Remove ${label} token`);
    chip.addEventListener("click", () => onRemove(key));
    container.append(chip);
  }
  if (parsed.createSubjectName && onCreateSubject) {
    const create = document.createElement("button");
    create.type = "button";
    create.className = "quick-token";
    create.textContent = `Create subject “${parsed.createSubjectName}”`;
    create.addEventListener("click", () => onCreateSubject(parsed.createSubjectName));
    container.append(create);
  }
}
