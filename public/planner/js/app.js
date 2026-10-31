import { getState, initializeStore, refresh, subscribe, update } from "./store.js";
import { navigate, onRouteChange, readLocation } from "./router.js";
import { addDays, dateKey, daysBetween, formatFullDate, formatLocalTime, relativeDate } from "./lib/dates.js";
import { recommendTask } from "./lib/recommendation.js";
import { dailyProductivityTip } from "./lib/productivity.js";
import { validateBackup, subjectColorKeys } from "./lib/validation.js";
import { parseQuickAdd, renderTokenChips } from "./components/quick-add.js";
import { createTaskRow } from "./components/task-row.js";
import { button, element, field, input, screenTitle, select } from "./components/dom.js";
import { activeSession, broadcastSessionChange, finishSession, pauseSession, remainingMilliseconds, resumeSession, startSession } from "./services/timer.js";
import { isFocusAudioPlaying, playFocusAudio, setFocusAudioVolume, stopFocusAudio } from "./services/focus-audio.js";
import { downloadJson, downloadRawData, importBackup, makeBackup, recordBackupTime } from "./services/backup.js";
import { putMeta } from "./db/repositories/meta.js";

const root = document.querySelector("#screen");
const routeHeading = document.querySelector("#route-heading");
const routeDate = document.querySelector("#route-date");
const routeTime = document.querySelector("#route-time");
const quickAddOpen = document.querySelector("#quick-add-open");
const sheet = document.querySelector("#edit-sheet");
const confirmDialog = document.querySelector("#confirm-dialog");
const commandDialog = document.querySelector("#command-dialog");
const toast = document.querySelector("#toast");
const announcer = document.querySelector("#live-announcer");
const storageMessage = document.querySelector("#storage-message");
const routeTitles = { today: "Today", tasks: "Tasks", subjects: "Subjects", focus: "Focus", settings: "Settings" };
const colors = {
  indigo: "Indigo", teal: "Teal", amber: "Amber", rose: "Rose", violet: "Violet",
  blue: "Blue", green: "Green", orange: "Orange", pink: "Pink", slate: "Slate",
};
const COMPLETION_COLLAPSE_MS = 600;
const DELETED_TASK_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

let state;
let route = "today";
let query = new URLSearchParams();
let toastTimeout;
let toastRemaining = 6000;
let toastStartedAt = 0;
let toastUndo;
let timerTick;
let headerClockTick;
let activeTaskId;
let selectedAlternative = "";
let quickParsed = null;
let quickAddValue = "";
let quickDebounce;
let taskSaveDebounce;
let taskSavePending = false;
let subjectSearch = "";
let quickDraftSubjectId = "";
let toastPaused = false;
let pendingImport = null;
let importMessage = "";
let recoveryRaw = null;
let draggedTaskId = "";
let eventsBound = false;
let unsubscribeStore;

const uid = () => crypto.randomUUID();
const nowIso = () => new Date().toISOString();
const byOrder = (a, b) => (a.order ?? 0) - (b.order ?? 0) || String(a.createdAt).localeCompare(String(b.createdAt));
const openTasks = () => state.tasks.filter((task) => !task.deletedAt && task.status !== "done");
const activeSubjects = () => state.subjects.filter((subject) => !subject.archivedAt);
const subjectById = (id) => state.subjects.find((subject) => subject.id === id);

function notifyStorageError(error) {
  storageMessage.hidden = false;
  storageMessage.replaceChildren(element("span", { text: error.message || "Daybreak could not save this change." }));
  console.error("Daybreak storage operation failed.", error);
  showToast("Your change could not be saved.");
}

function save(mutator) {
  return update(mutator).catch((error) => {
    notifyStorageError(error);
    throw error;
  });
}

function escapeKey(inputName) {
  return CSS.escape(inputName);
}

function updateHeaderDateTime(now = new Date()) {
  routeDate.textContent = formatFullDate(now);
  routeTime.textContent = formatLocalTime(now);
  routeTime.dateTime = now.toISOString();
}

function renderScreen({ restoreFocus = true } = {}) {
  if (!state) return;
  const active = document.activeElement;
  const focusKey = active?.dataset?.focusKey;
  const activeAction = active?.dataset?.action;
  const activeWithinRoot = root.contains(active);
  const activeTaskId = active?.dataset?.taskId || active?.closest?.(".task-row")?.dataset?.taskId;
  const activeSubjectId = active?.closest?.("[data-subject-id]")?.dataset?.subjectId;
  const start = active?.selectionStart;
  const end = active?.selectionEnd;
  const scrollY = window.scrollY;
  routeHeading.textContent = routeTitles[route] || "Today";
  updateHeaderDateTime();
  quickAddOpen.hidden = !["today", "tasks"].includes(route);
  document.title = `${routeTitles[route] || "Today"} — Daybreak`;
  document.querySelectorAll("[data-route]").forEach((link) => {
    if (link.dataset.route === route) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
  root.replaceChildren();
  if (route === "today") renderToday();
  else if (route === "tasks") renderTaskView();
  else if (route === "subjects") renderSubjects();
  else if (route === "focus") renderFocus();
  else renderSettings();
  if (restoreFocus && focusKey) {
    const target = root.querySelector(`[data-focus-key="${escapeKey(focusKey)}"]`);
    target?.focus({ preventScroll: true });
    if (target && typeof start === "number" && typeof end === "number") target.setSelectionRange(start, end);
  } else if (restoreFocus && activeAction && activeWithinRoot) {
    const taskTarget = activeTaskId
      ? root.querySelector(`[data-task-id="${escapeKey(activeTaskId)}"] [data-action="${escapeKey(activeAction)}"], [data-action="${escapeKey(activeAction)}"][data-task-id="${escapeKey(activeTaskId)}"]`)
      : null;
    const subjectTarget = activeSubjectId
      ? root.querySelector(`[data-subject-id="${escapeKey(activeSubjectId)}"] [data-action="${escapeKey(activeAction)}"]`)
      : null;
    const actionTarget = root.querySelector(`[data-action="${escapeKey(activeAction)}"]`);
    (taskTarget || subjectTarget || actionTarget || document.querySelector("#view-root"))?.focus({ preventScroll: true });
  } else if (restoreFocus && activeWithinRoot && active?.closest?.(".task-row")) {
    document.querySelector("#view-root")?.focus({ preventScroll: true });
  }
  window.scrollTo({ top: scrollY, behavior: "auto" });
}

function navigateTo(location, fromHistory = false) {
  const changedRoute = route !== location.route;
  if (changedRoute && route === "focus" && location.route !== "focus") stopFocusAudio();
  route = location.route;
  query = location.query;
  renderScreen({ restoreFocus: !changedRoute });
  if (changedRoute && !fromHistory) {
    document.querySelector(".more-menu")?.removeAttribute("open");
    root.focus({ preventScroll: true });
  }
}

function safeDateLabel(value) {
  return value ? relativeDate(value) : "No date";
}

function dateGroup(task) {
  if (task.pinnedAt) return "Pinned";
  if (!task.dueDate) return "No date";
  const difference = daysBetween(dateKey(), task.dueDate);
  if (difference < 0) return "Overdue";
  if (difference === 0) return "Today";
  if (difference === 1) return "Tomorrow";
  if (difference < 7) return "This week";
  return "Later";
}

function compareSmartTasks(a, b) {
  const today = dateKey();
  const tomorrow = addDays(today, 1);
  const tier = (task) => !task.dueDate ? 3 : task.dueDate < today ? 0 : task.dueDate === today ? 1 : task.dueDate === tomorrow ? 2 : 3;
  const deadline = tier(a) - tier(b);
  if (deadline) return deadline;
  if (a.dueDate === today && b.dueDate === today && a.dueTime && b.dueTime) {
    const time = a.dueTime.localeCompare(b.dueTime);
    if (time) return time;
  }
  const priorityRank = { high: 0, normal: 1, low: 2 };
  const priority = priorityRank[a.priority] - priorityRank[b.priority];
  if (priority) return priority;
  const progress = Number(b.status === "doing") - Number(a.status === "doing");
  if (progress) return progress;
  if (a.estimateMin < 60 && b.estimateMin < 60 && a.estimateMin !== b.estimateMin) return a.estimateMin - b.estimateMin;
  return byOrder(a, b);
}

function taskGroup(tasks, options = {}) {
  const order = options.order || ["Overdue", "Pinned", "Today", "Tomorrow", "This week", "Later", "No date", "Completed today"];
  const groups = new Map(order.map((name) => [name, []]));
  for (const task of tasks) {
    const name = options.completed?.has(task.id) ? "Completed today" : dateGroup(task);
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(task);
  }
  const wrapper = element("div", { className: "task-groups" });
  for (const [name, items] of groups) {
    if (!items.length) continue;
    const section = element("section", { className: "task-group", attrs: { "aria-label": name } });
    section.append(element("h3", { text: `${name} · ${items.length}` }));
    const list = element("div", { className: "task-list" });
    (options.preserveOrder ? items : items.sort(byOrder)).forEach((task) => list.append(createTaskRow(task, subjectById(task.subjectId), { onFocus: true })));
    section.append(list);
    wrapper.append(section);
  }
  return wrapper;
}

function createQuickAdd() {
  const wrapper = element("form", { className: "quick-add", attrs: { "aria-label": "Quick add a task" } });
  const row = element("div", { className: "quick-add-row" });
  const title = input({ value: quickAddValue, placeholder: "Add a task… Try #Subject !high tomorrow 30m", maxlength: 160 });
  title.dataset.quickTitle = "true";
  title.dataset.focusKey = "quick-title";
  title.setAttribute("aria-label", "Quick add task title");
  const submit = button("Add task", "quick-add-submit", { className: "button button-primary" });
  submit.type = "submit";
  row.append(title, submit);
  const tokens = element("div", { className: "token-list", attrs: { "aria-label": "Recognized quick add tokens" } });
  const error = element("p", { className: "inline-error", attrs: { role: "status" } });
  error.hidden = true;
  wrapper.append(row, tokens, error);
  wrapper.addEventListener("input", () => {
    quickAddValue = title.value;
    updateQuickPreview(title, tokens, error);
  });
  wrapper.addEventListener("submit", (event) => {
    event.preventDefault();
    createQuickTask(title, error);
  });
  return wrapper;
}

function updateQuickPreview(title, tokens, error) {
  window.clearTimeout(quickDebounce);
  quickDebounce = window.setTimeout(() => {
    quickParsed = parseQuickAdd(title.value, activeSubjects());
    if (quickDraftSubjectId && subjectById(quickDraftSubjectId)?.name !== quickParsed.createSubjectName) quickDraftSubjectId = "";
    const chips = { ...quickParsed, dueDate: quickParsed.dueDate ? safeDateLabel(quickParsed.dueDate) : undefined };
    renderTokenChips(tokens, chips, (key) => removeQuickToken(title, key), async (name) => {
      try {
        const subject = await createSubjectRecord(name);
        quickDraftSubjectId = subject.id;
        showToast(`Subject “${subject.name}” created.`);
        const titleField = root.querySelector("[data-quick-title]");
        const tokenList = root.querySelector(".token-list");
        const errorMessage = root.querySelector(".quick-add .inline-error");
        if (titleField && tokenList && errorMessage) {
          updateQuickPreview(titleField, tokenList, errorMessage);
          titleField.focus();
        }
      } catch {}
    });
    if (quickParsed.ambiguity) {
      error.textContent = quickParsed.ambiguity;
      error.hidden = false;
    } else {
      error.textContent = "";
      error.hidden = true;
    }
  }, 50);
}

function removeQuickToken(inputField, key) {
  const patterns = {
    subjectId: /(?:^|\s)#[\p{L}\p{N}_-]+/u,
    createSubjectName: /(?:^|\s)#[\p{L}\p{N}_-]+/u,
    priority: /(?:^|\s)!(?:high|low)\b/i,
    dueDate: /(?:^|\s)(?:today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i,
    estimateMin: /(?:^|\s)(?:30m|1h30m|1h)\b/i,
  };
  inputField.value = inputField.value.replace(patterns[key], " ").replace(/\s+/g, " ").trimStart();
  inputField.dispatchEvent(new Event("input", { bubbles: true }));
  inputField.focus();
}

async function createQuickTask(titleField, error) {
  const parsed = parseQuickAdd(titleField.value, activeSubjects());
  if (quickDraftSubjectId && subjectById(quickDraftSubjectId)?.name === parsed.createSubjectName) parsed.subjectId = quickDraftSubjectId;
  if (!parsed.title) {
    error.textContent = "Add a task title before saving.";
    error.hidden = false;
    titleField.focus();
    return;
  }
  if (parsed.ambiguity) {
    error.textContent = parsed.ambiguity;
    error.hidden = false;
    return;
  }
  if (parsed.createSubjectName) {
    if (!quickDraftSubjectId) {
      error.textContent = `Choose “Create subject ${parsed.createSubjectName}” before adding this task.`;
      error.hidden = false;
      return;
    }
    parsed.subjectId = quickDraftSubjectId;
  }
  const task = newTask({
    title: parsed.title,
    subjectId: parsed.subjectId,
    dueDate: parsed.dueDate,
    priority: parsed.priority,
    estimateMin: parsed.estimateMin,
    type: "study",
  });
  window.clearTimeout(quickDebounce);
  const previousDraft = quickAddValue;
  quickAddValue = "";
  try {
    await save((next) => next.tasks.push(task));
    const currentTitle = root.querySelector("[data-quick-title]");
    if (currentTitle) {
      currentTitle.value = "";
      currentTitle.focus();
    }
    root.querySelector(".token-list")?.replaceChildren();
    const currentError = root.querySelector(".quick-add .inline-error");
    if (currentError) currentError.hidden = true;
    quickParsed = null;
    quickDraftSubjectId = "";
    showToast("Task added.", () => undoTask(task.id, true));
  } catch {
    quickAddValue = previousDraft;
    renderScreen();
    root.querySelector("[data-quick-title]")?.focus();
  }
}

function newTask(values = {}) {
  const timestamp = nowIso();
  return {
    id: uid(), title: values.title.trim(), subjectId: values.subjectId || undefined,
    type: values.type || "study", status: values.status || "todo", priority: values.priority || "normal",
    dueDate: values.dueDate || undefined, dueTime: values.dueTime || undefined,
    estimateMin: values.estimateMin || undefined, subtasks: values.subtasks || [],
    notes: values.notes || undefined, order: state.tasks.length, createdAt: timestamp,
    updatedAt: timestamp, completedAt: undefined, deletedAt: undefined, pinnedAt: undefined,
    legacy: values.legacy || undefined,
  };
}

function todayCandidates() {
  const today = dateKey();
  const tomorrow = addDays(today, 1);
  return openTasks().filter((task) => task.pinnedAt || !task.dueDate || task.dueDate <= tomorrow);
}

function renderToday() {
  const today = dateKey();
  const dueToday = openTasks().filter((task) => task.dueDate === today);
  const overdue = openTasks().filter((task) => task.dueDate && task.dueDate < today);
  const pinnedFuture = openTasks().filter((task) => task.pinnedAt && task.dueDate > today);
  const todayCompleted = state.tasks.filter((task) => task.status === "done" && task.completedAt
    && dateKey(new Date(task.completedAt)) === today
    && Date.now() - Date.parse(task.completedAt) >= COMPLETION_COLLAPSE_MS);
  const allToday = state.tasks.filter((task) => task.dueDate === today && !task.deletedAt);

  const title = screenTitle("YOUR STUDY PLAN", "Your day, at your pace.", "");
  root.append(title, createQuickAdd());

  const candidates = todayCandidates();
  const chosenTask = candidates.find((task) => task.id === selectedAlternative);
  const recommendation = chosenTask
    ? { task: chosenTask, reasons: ["Chosen by you"] }
    : recommendTask(candidates, new Date(), { subjects: state.subjects });
  if (recommendation) {
    const card = element("section", { className: "next-up next-up-recommendation", attrs: { "aria-labelledby": "next-up-title" } });
    card.append(element("p", { className: "next-label", text: "NEXT UP" }));
    card.append(element("h3", { attrs: { id: "next-up-title" }, text: recommendation.task.title }));
    const metadata = element("div", { className: "next-meta" });
    metadata.append(createSubjectChipNode(subjectById(recommendation.task.subjectId)));
    metadata.append(element("span", { text: recommendation.task.dueDate ? safeDateLabel(recommendation.task.dueDate) : "No due date" }));
    metadata.append(element("span", { text: recommendation.task.estimateMin ? `${recommendation.task.estimateMin} min` : "No estimate" }));
    if (!recommendation.task.estimateMin) {
      const estimate = input({ type: "number", min: 1, max: 600, placeholder: "Minutes", value: "" });
      estimate.dataset.focusKey = "next-estimate";
      estimate.setAttribute("aria-label", "Add an estimate in minutes");
      const estimateField = field("Add an estimate", estimate);
      estimateField.className = "field inline-estimate";
      const saveEstimate = button("Save estimate", "save-estimate", { className: "button" });
      saveEstimate.dataset.taskId = recommendation.task.id;
      estimateField.append(saveEstimate);
      metadata.append(estimateField);
    }
    const reasons = element("ul", { className: "why-list", attrs: { "aria-label": "Why this task" } });
    (recommendation.reasons.length ? recommendation.reasons : ["Your next open task"]).forEach((reason) => reasons.append(element("li", { text: reason })));
    const actions = element("div", { className: "next-actions" });
    const start = button("Start focus", "start-focus", { className: "button button-primary" });
    start.dataset.taskId = recommendation.task.id;
    const done = button("Mark done", "toggle-task", { className: "button" });
    done.dataset.taskId = recommendation.task.id;
    const pin = button("Pick another", "show-alternatives", { className: "button button-quiet" });
    actions.append(start, done, pin);
    card.append(metadata, reasons, actions);
    if (selectedAlternative) {
      const alternatives = todayCandidates()
        .filter((task) => task.id !== recommendation.task.id)
        .sort((a, b) => Number(Boolean(b.pinnedAt)) - Number(Boolean(a.pinnedAt)) || compareSmartTasks(a, b))
        .slice(0, 5);
      const options = element("div", { className: "alternative-list", attrs: { "aria-label": "Choose another task" } });
      for (const alternative of alternatives) {
        const choose = button(alternative.title, "choose-alternative", { className: "button" });
        choose.dataset.taskId = alternative.id;
        options.append(choose);
      }
      card.append(options);
    }
    root.append(card);
  } else {
    const noTasks = element("section", { className: "next-up" });
    noTasks.append(element("p", { className: "next-label", text: "NEXT UP" }));
    const noSubject = activeSubjects().length === 0;
    noTasks.append(element("h3", { text: noSubject ? "Start with one subject." : "Nothing needs your attention today." }));
    noTasks.append(element("p", { className: "prose", text: noSubject ? "Add a subject and one task to give your study plan a useful starting point." : "You have room to choose what comes next. Nothing is overdue or due today." }));
    const actions = element("div", { className: "next-actions" });
    if (noSubject) actions.append(button("Add subject", "open-subject-create", { className: "button button-primary" }));
    const suggestion = openTasks().filter((task) => task.dueDate && task.dueDate > today).sort(compareSmartTasks)[0];
    if (!noSubject && suggestion) {
      noTasks.append(element("p", { className: "prose", text: `Bring “${suggestion.title}” forward if you want to make a start.` }));
      const pull = button("Pull from upcoming", "pull-today", { className: "button button-primary" });
      pull.dataset.taskId = suggestion.id;
      actions.append(pull);
    }
    actions.append(button("Add task", "focus-quick-add", { className: noSubject ? "button" : "button button-primary" }));
    noTasks.append(actions);
    root.append(noTasks);
  }

  const columns = element("div", { className: "today-grid" });
  const primary = element("div", { className: "primary-column" });
  const todaySection = element("section", { className: "task-section", attrs: { "aria-labelledby": "today-tasks-title" } });
  const todayHeader = element("div", { className: "section-heading" });
  todayHeader.append(element("h2", { attrs: { id: "today-tasks-title" }, text: "Today" }));
  const todayProgress = element("span", { className: "metadata-text", text: `${allToday.filter((task) => task.status === "done").length} of ${allToday.length} done` });
  todayHeader.append(todayProgress);
  todaySection.append(todayHeader);
  const progress = element("div", { className: "progress-line", attrs: { "aria-label": "Today's completion progress" } });
  const track = element("div", { className: "progress-track" });
  const fill = element("div", { className: "progress-fill" });
  fill.style.width = `${allToday.length ? (allToday.filter((task) => task.status === "done").length / allToday.length) * 100 : 0}%`;
  track.append(fill);
  progress.append(track, element("span", { text: `${allToday.filter((task) => task.status === "done").length} of ${allToday.length} done` }));
  todaySection.append(progress);
  const visible = [...overdue, ...dueToday, ...pinnedFuture].filter((task, index, list) => list.findIndex((other) => other.id === task.id) === index);
  todaySection.append(visible.length ? taskGroup(visible) : element("div", { className: "empty-state", text: allToday.length ? "Your planned tasks are complete." : "No tasks due today." }));
  if (todayCompleted.length) {
    const completed = element("details", { className: "completed-section" });
    const summaryNode = element("summary", { text: `Completed today (${todayCompleted.length})` });
    completed.append(summaryNode, taskGroup(todayCompleted, { completed: new Set(todayCompleted.map((task) => task.id)), order: ["Completed today"] }));
    todaySection.append(completed);
  }
  primary.append(todaySection);

  const support = element("aside", { className: "support-column", attrs: { "aria-label": "Coming up" } });
  const upcoming = openTasks().filter((task) => task.dueDate && task.dueDate > today).sort((a, b) => a.dueDate.localeCompare(b.dueDate)).slice(0, 4);
  const upcomingBlock = element("section", { className: "support-block" });
  upcomingBlock.append(element("h3", { text: "Due soon" }));
  if (upcoming.length) {
    upcoming.forEach((task) => {
      const row = element("div", { className: "deleted-row" });
      row.append(element("span", { text: task.title }), element("span", { className: "metadata-text", text: safeDateLabel(task.dueDate) }));
      row.append(button("Pull to today", "pull-today", { className: "button button-quiet" }));
      row.lastChild.dataset.taskId = task.id;
      upcomingBlock.append(row);
    });
  } else upcomingBlock.append(element("p", { text: "No dated tasks coming up." }));
  support.append(upcomingBlock);

  const examBlock = element("section", { className: "support-block" });
  examBlock.append(element("h3", { text: "Exams" }));
  const exams = openTasks().filter((task) => task.type === "exam").sort((a, b) => (a.dueDate || "").localeCompare(b.dueDate || "")).slice(0, 3);
  examBlock.append(element("p", { text: exams.length ? exams.map((task) => `${task.title}${task.dueDate ? ` · ${safeDateLabel(task.dueDate)}` : ""}`).join(" | ") : "No open exams." }));
  support.append(examBlock);
  const tip = dailyProductivityTip();
  const tipBlock = element("section", { className: "support-block productivity-tip", attrs: { "aria-labelledby": "productivity-tip-title" } });
  tipBlock.append(element("p", { className: "next-label", text: "TODAY'S GENTLE TIP" }));
  tipBlock.append(element("h3", { attrs: { id: "productivity-tip-title" }, text: tip.title }));
  tipBlock.append(element("p", { className: "prose", text: tip.body }));
  tipBlock.append(button("Plan a focus block", "go-focus", { className: "button button-quiet" }));
  support.append(tipBlock);
  columns.append(primary, support);
  root.append(columns);

  const allDone = allToday.length > 0 && allToday.every((task) => task.status === "done");
  if (allDone) {
    const minutesFocused = state.sessions.filter((session) => session.outcome === "completed" && session.endedAt && dateKey(new Date(session.endedAt)) === today).reduce((sum, session) => sum + session.plannedMin, 0);
    const completion = element("section", { className: "completion-summary" });
    completion.append(element("h2", { text: "Day's work, complete." }));
    completion.append(element("p", { text: `You finished ${allToday.length} task${allToday.length === 1 ? "" : "s"}${minutesFocused ? ` and focused for ${formatMinutes(minutesFocused)}` : ""} today.` }));
    completion.append(element("p", { className: "metadata-text", text: `Tomorrow · ${openTasks().filter((task) => task.dueDate === addDays(today, 1)).length} tasks planned` }));
    root.append(completion);
  }
}

function createSubjectChipNode(subject) {
  const chip = element("span", { className: `subject-chip ${subject ? `color-${subject.colorKey}` : "subject-none"}`, text: subject?.name || "No subject" });
  return chip;
}

function formatMinutes(minutes) {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours && rest ? `${hours}h ${rest}m` : hours ? `${hours}h` : `${rest}m`;
}

function renderTaskView() {
  root.append(screenTitle("YOUR WORK", "Tasks", "Group, filter, and shape the work that is actually on your plan."));
  root.append(createQuickAdd());
  const filters = element("div", { className: "filter-bar", attrs: { role: "group", "aria-label": "Task filters" } });
  const subjectFilter = select([{ value: "", label: "All subjects" }, ...activeSubjects().map((subject) => ({ value: subject.id, label: subject.name }))], query.get("subject") || "");
  subjectFilter.dataset.filter = "subject";
  subjectFilter.dataset.focusKey = "filter-subject";
  subjectFilter.setAttribute("aria-label", "Filter by subject");
  const statusFilter = select([{ value: "", label: "All statuses" }, { value: "todo", label: "To do" }, { value: "doing", label: "In progress" }, { value: "done", label: "Done" }], query.get("status") || "");
  statusFilter.dataset.filter = "status";
  statusFilter.dataset.focusKey = "filter-status";
  statusFilter.setAttribute("aria-label", "Filter by status");
  const dueFilter = select([{ value: "", label: "Any due date" }, { value: "overdue", label: "Overdue" }, { value: "today", label: "Today" }, { value: "week", label: "This week" }, { value: "none", label: "No date" }], query.get("due") || "");
  dueFilter.dataset.filter = "due";
  dueFilter.dataset.focusKey = "filter-due";
  dueFilter.setAttribute("aria-label", "Filter by due date");
  const sort = select([{ value: "smart", label: "Smart order" }, { value: "due", label: "Due date" }, { value: "priority", label: "Priority" }, { value: "recent", label: "Recently added" }], query.get("sort") || "smart");
  sort.dataset.filter = "sort";
  sort.dataset.focusKey = "filter-sort";
  sort.setAttribute("aria-label", "Sort tasks");
  filters.append(subjectFilter, statusFilter, dueFilter, sort);
  root.append(filters);

  const today = dateKey();
  const due = query.get("due") || "";
  const selectedSubject = query.get("subject") || "";
  const status = query.get("status") || "";
  const sortBy = query.get("sort") || "smart";
  let tasks = state.tasks.filter((task) => !task.deletedAt);
  if (selectedSubject) tasks = tasks.filter((task) => task.subjectId === selectedSubject);
  if (status) tasks = tasks.filter((task) => task.status === status);
  if (due === "overdue") tasks = tasks.filter((task) => task.status !== "done" && task.dueDate && task.dueDate < today);
  else if (due === "today") tasks = tasks.filter((task) => task.dueDate === today);
  else if (due === "week") tasks = tasks.filter((task) => task.dueDate && daysBetween(today, task.dueDate) >= 0 && daysBetween(today, task.dueDate) <= 7);
  else if (due === "none") tasks = tasks.filter((task) => !task.dueDate);
  if (sortBy === "due") tasks.sort((a, b) => (a.dueDate || "9999").localeCompare(b.dueDate || "9999"));
  else if (sortBy === "priority") tasks.sort((a, b) => ({ high: 0, normal: 1, low: 2 }[a.priority] - { high: 0, normal: 1, low: 2 }[b.priority]) || byOrder(a, b));
  else if (sortBy === "recent") tasks.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  else tasks.sort(compareSmartTasks);
  if (!tasks.length) {
    const empty = element("div", { className: "empty-state" });
    empty.append(element("h3", { text: "No matching tasks." }), element("p", { text: "Try a different filter, or add a new task." }));
    root.append(empty);
    return;
  }
  root.append(taskGroup(tasks, { preserveOrder: true }));
}

function renderSubjects() {
  const heading = screenTitle("YOUR COURSES", "Subjects", "Keep course context beside the tasks that belong to it.");
  const create = button("Add subject", "open-subject-create", { className: "button button-primary" });
  const bar = element("div", { className: "section-heading" });
  bar.append(heading, create);
  root.append(bar);
  const search = input({ placeholder: "Find a subject", value: subjectSearch });
  search.dataset.focusKey = "subject-search";
  search.setAttribute("aria-label", "Find a subject");
  search.addEventListener("input", () => {
    subjectSearch = search.value;
    const focus = search.selectionStart;
    renderScreen();
    const restored = root.querySelector('[data-focus-key="subject-search"]');
    restored?.focus();
    restored?.setSelectionRange(focus, focus);
  });
  root.append(search);
  const list = element("div", { className: "subject-list", attrs: { "aria-label": "Subjects" } });
  const queryText = subjectSearch.trim().toLocaleLowerCase();
  const shown = state.subjects.filter((subject) => subject.name.toLocaleLowerCase().includes(queryText));
  for (const subject of shown) {
    const row = element("article", { className: "subject-row", attrs: { "data-subject-id": subject.id } });
    const info = element("div", { className: "subject-info" });
    const name = element("strong", { text: subject.name });
    name.className = `subject-chip color-${subject.colorKey}`;
    info.append(name);
    if (subject.archivedAt) info.append(element("span", { className: "status-label", text: "Archived" }));
    const tasks = state.tasks.filter((task) => task.subjectId === subject.id && !task.deletedAt && task.status !== "done");
    const nextDue = tasks.map((task) => task.dueDate).filter(Boolean).sort()[0];
    info.append(element("p", { text: `${tasks.length} open task${tasks.length === 1 ? "" : "s"}${nextDue ? ` · next ${safeDateLabel(nextDue)}` : ""}` }));
    const actions = element("div", { className: "task-actions" });
    const edit = button("Edit", "edit-subject");
    const archive = button(subject.archivedAt ? "Restore" : "Archive", subject.archivedAt ? "restore-subject" : "archive-subject");
    const remove = button("Delete", "delete-subject", { className: "button button-quiet button-danger" });
    actions.append(edit, archive, remove);
    row.append(info, actions);
    list.append(row);
  }
  root.append(list);
  if (!shown.length) {
    const empty = element("section", { className: "empty-state" });
    empty.append(element("h3", { text: state.subjects.length ? "No subjects match." : "One course is a useful start." }));
    empty.append(element("p", { text: state.subjects.length ? "Try another search." : "Create a subject to organize tasks, deadlines, and study sessions." }));
    if (!state.subjects.length) empty.append(button("Add subject", "open-subject-create", { className: "button button-primary" }));
    root.append(empty);
  }
  const archived = state.subjects.filter((subject) => subject.archivedAt);
  if (archived.length) {
    const section = element("details", { className: "panel" });
    section.append(element("summary", { text: `Archived subjects (${archived.length})` }));
    for (const subject of archived) {
      const restore = button(`Restore ${subject.name}`, "restore-subject", { className: "button button-quiet" });
      restore.dataset.subjectId = subject.id;
      section.append(restore);
    }
    root.append(section);
  }
}

async function createSubjectRecord(name, colorKey = "indigo") {
  const timestamp = nowIso();
  const subject = { id: uid(), name: name.trim(), colorKey, createdAt: timestamp, updatedAt: timestamp };
  await save((next) => next.subjects.push(subject));
  return subject;
}

function openSubjectSheet(subject = null) {
  const form = element("form", { className: "form-grid", attrs: { "data-form": "subject" } });
  const head = element("div", { className: "sheet-header" });
  const heading = element("div");
  heading.append(element("p", { className: "eyebrow", text: subject ? "COURSE DETAILS" : "NEW COURSE" }));
  heading.append(element("h2", { attrs: { id: "sheet-title" }, text: subject ? "Edit subject" : "Add a subject" }));
  head.replaceChildren(heading, button("Close", "close-sheet", { className: "button button-quiet" }));
  form.append(head);
  const name = input({ value: subject?.name || "", maxlength: 60, placeholder: "e.g. Data structures", required: true });
  name.name = "name";
  name.dataset.focusKey = "subject-name";
  form.append(field("Subject name", name));
  const selectedColor = subject?.colorKey || "indigo";
  const colorGroup = element("div", { className: "form-grid", attrs: { role: "group", "aria-label": "Subject color" } });
  colorGroup.append(element("span", { text: "Color" }));
  const options = element("div", { className: "color-options" });
  for (const key of subjectColorKeys) {
    const option = button(colors[key], "choose-subject-color", { className: `color-option subject-chip color-${key}` });
    option.setAttribute("aria-pressed", String(key === selectedColor));
    option.dataset.colorKey = key;
    options.append(option);
  }
  colorGroup.append(options);
  form.append(colorGroup);
  const details = element("div", { className: "form-row" });
  const teacher = input({ value: subject?.teacher || "", maxlength: 80, placeholder: "Optional" });
  teacher.name = "teacher";
  details.append(field("Teacher", teacher));
  const room = input({ value: subject?.room || "", maxlength: 80, placeholder: "Optional" });
  room.name = "room";
  details.append(field("Room", room));
  form.append(details);
  const notes = element("textarea", { className: "input notes-area" });
  notes.name = "notes";
  notes.maxLength = 1000;
  notes.placeholder = "Optional course notes";
  notes.value = subject?.notes || "";
  form.append(field("Notes", notes));
  const error = element("p", { className: "form-error", attrs: { role: "alert", "data-error": "subject" } });
  error.hidden = true;
  form.append(error);
  const footer = element("div", { className: "sheet-footer" });
  footer.append(button("Cancel", "close-sheet"));
  const submit = button(subject ? "Save subject" : "Create subject", "save-subject", { className: "button button-primary" });
  submit.type = "submit";
  footer.append(submit);
  form.append(footer);
  form.dataset.subjectId = subject?.id || "";
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    saveSubjectForm(form);
  });
  sheet.replaceChildren(form);
  sheet.showModal();
  name.focus();
}

async function saveSubjectForm(form) {
  const name = form.elements.name.value.trim();
  const error = form.querySelector('[data-error="subject"]');
  if (!name) {
    error.textContent = "Enter a subject name.";
    error.hidden = false;
    form.elements.name.focus();
    return;
  }
  const id = form.dataset.subjectId;
  const colorKey = form.querySelector('[data-action="choose-subject-color"][aria-pressed="true"]')?.dataset.colorKey || "indigo";
  const values = {
    name,
    colorKey,
    teacher: form.elements.teacher.value.trim() || undefined,
    room: form.elements.room.value.trim() || undefined,
    notes: form.elements.notes.value.trim() || undefined,
    updatedAt: nowIso(),
  };
  try {
    await save((next) => {
      const subject = next.subjects.find((item) => item.id === id);
      if (subject) Object.assign(subject, values);
      else next.subjects.push({ id: uid(), ...values, createdAt: values.updatedAt });
    });
    sheet.close();
    showToast(id ? "Subject saved." : "Subject created.");
  } catch {}
}

function openTaskSheet(task) {
  if (!task) return;
  const form = element("form", { className: "form-grid", attrs: { "data-form": "task" } });
  const head = element("div", { className: "sheet-header" });
  const heading = element("div");
  heading.append(element("p", { className: "eyebrow", text: "TASK DETAILS" }));
  heading.append(element("h2", { attrs: { id: "sheet-title" }, text: "Edit task" }));
  const saveStatus = element("span", { className: "metadata-text", text: "Saved" });
  saveStatus.dataset.savedStatus = "true";
  head.append(heading, saveStatus, button("Close", "close-sheet", { className: "button button-quiet" }));
  form.append(head);
  form.dataset.taskId = task.id;

  const title = input({ value: task.title, maxlength: 160, required: true, describedBy: "task-title-error" });
  title.name = "title";
  title.dataset.focusKey = "task-title";
  form.append(field("Task", title));
  const titleError = element("p", { className: "form-error", attrs: { id: "task-title-error", role: "alert" } });
  titleError.hidden = true;
  form.append(titleError);

  const taskSubject = subjectById(task.subjectId);
  const subjectChoices = activeSubjects().map((subject) => ({ value: subject.id, label: subject.name }));
  if (taskSubject?.archivedAt) subjectChoices.push({ value: taskSubject.id, label: `${taskSubject.name} (archived)` });
  const subjectSelect = select([{ value: "", label: "No subject" }, ...subjectChoices], task.subjectId || "");
  subjectSelect.name = "subjectId";
  const typeSelect = select([{ value: "study", label: "Study" }, { value: "homework", label: "Homework" }, { value: "exam", label: "Exam" }], task.type);
  typeSelect.name = "type";
  const rowOne = element("div", { className: "form-row" });
  rowOne.append(field("Subject", subjectSelect), field("Type", typeSelect));
  form.append(rowOne);

  const statusSelect = select([{ value: "todo", label: "To do" }, { value: "doing", label: "In progress" }, { value: "done", label: "Done" }], task.status);
  statusSelect.name = "status";
  const prioritySelect = select([{ value: "low", label: "Low priority" }, { value: "normal", label: "Normal priority" }, { value: "high", label: "High priority" }], task.priority);
  prioritySelect.name = "priority";
  const rowTwo = element("div", { className: "form-row" });
  rowTwo.append(field("Status", statusSelect), field("Priority", prioritySelect));
  form.append(rowTwo);

  const date = input({ type: "date", value: task.dueDate || "" });
  date.name = "dueDate";
  const time = input({ type: "time", value: task.dueTime || "" });
  time.name = "dueTime";
  const rowThree = element("div", { className: "form-row" });
  rowThree.append(field("Due date", date), field("Due time", time));
  form.append(rowThree);
  const estimate = input({ type: "number", min: 1, max: 600, step: 5, value: task.estimateMin || "", placeholder: "Minutes" });
  estimate.name = "estimateMin";
  form.append(field("Estimate in minutes", estimate));
  const notes = element("textarea", { className: "input notes-area" });
  notes.name = "notes";
  notes.value = task.notes || "";
  notes.maxLength = 5000;
  form.append(field("Notes", notes));

  const subtaskSection = element("section", { className: "panel" });
  subtaskSection.append(element("h3", { text: `Subtasks · ${task.subtasks.filter((subtask) => subtask.done).length}/${task.subtasks.length}` }));
  const subtaskList = element("ul", { className: "subtask-list", attrs: { "aria-label": "Task subtasks" } });
  for (const [index, subtask] of task.subtasks.entries()) {
    const item = element("li", { className: "subtask-row", attrs: { "data-subtask-id": subtask.id } });
    const toggle = input({ type: "checkbox" });
    toggle.checked = subtask.done;
    toggle.dataset.subtaskToggle = "true";
    toggle.setAttribute("aria-label", `Mark ${subtask.title} ${subtask.done ? "not done" : "done"}`);
    const label = element("label");
    label.append(toggle, element("span", { text: subtask.title }));
    item.append(label);
    const up = button("Move up", "move-subtask", { className: "button button-quiet" });
    up.dataset.direction = "-1";
    up.disabled = index === 0;
    const down = button("Move down", "move-subtask", { className: "button button-quiet" });
    down.dataset.direction = "1";
    down.disabled = index === task.subtasks.length - 1;
    item.append(up, down, button("Remove", "remove-subtask", { className: "button button-quiet" }));
    subtaskList.append(item);
  }
  subtaskSection.append(subtaskList);
  const subtaskRow = element("div", { className: "quick-add-row" });
  const subtaskInput = input({ placeholder: "Add a subtask", maxlength: 120 });
  subtaskInput.dataset.subtaskNew = "true";
  subtaskInput.dataset.focusKey = "subtask-new";
  subtaskRow.append(subtaskInput, button("Add subtask", "add-subtask"));
  subtaskSection.append(subtaskRow);
  form.append(subtaskSection);

  const footer = element("div", { className: "sheet-footer" });
  footer.append(button(task.pinnedAt ? "Unpin task" : "Pin task", "pin-task"));
  footer.append(button("Save changes", "save-task-sheet", { className: "button button-primary" }));
  form.append(footer);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    saveTaskForm(form);
  });
  form.addEventListener("input", (event) => {
    if (!event.target.matches("[data-subtask-toggle], [data-subtask-new]")) scheduleTaskSave(form);
  });
  form.addEventListener("change", (event) => {
    if (!event.target.matches("[data-subtask-toggle]")) scheduleTaskSave(form);
  });
  sheet.replaceChildren(form);
  if (!sheet.open) sheet.showModal();
  title.focus();
}

function getTaskFormValues(form) {
  const title = form.elements.title.value.trim();
  const estimateText = form.elements.estimateMin.value.trim();
  const estimateMin = estimateText ? Number(estimateText) : undefined;
  const subtasks = state.tasks.find((task) => task.id === form.dataset.taskId)?.subtasks || [];
  return {
    title,
    subjectId: form.elements.subjectId.value || undefined,
    type: form.elements.type.value,
    status: form.elements.status.value,
    priority: form.elements.priority.value,
    dueDate: form.elements.dueDate.value || undefined,
    dueTime: form.elements.dueTime.value || undefined,
    estimateMin,
    notes: form.elements.notes.value.trim() || undefined,
    subtasks,
  };
}

function scheduleTaskSave(form) {
  taskSavePending = true;
  const status = form.querySelector("[data-saved-status]");
  if (status) status.textContent = "Saving…";
  window.clearTimeout(taskSaveDebounce);
  taskSaveDebounce = window.setTimeout(() => saveTaskForm(form), 700);
}

async function saveTaskForm(form) {
  window.clearTimeout(taskSaveDebounce);
  const values = getTaskFormValues(form);
  const titleError = form.querySelector("#task-title-error");
  if (!values.title) {
    titleError.textContent = "Add a task title.";
    titleError.hidden = false;
    form.elements.title.setAttribute("aria-invalid", "true");
    return;
  }
  if (form.elements.estimateMin.value.trim() && (!Number.isInteger(values.estimateMin) || values.estimateMin < 1 || values.estimateMin > 600)) {
    titleError.textContent = "Choose an estimate between 1 and 600 minutes.";
    titleError.hidden = false;
    form.elements.estimateMin.setAttribute("aria-invalid", "true");
    return;
  }
  titleError.hidden = true;
  form.elements.title.removeAttribute("aria-invalid");
  try {
    await save((next) => {
      const task = next.tasks.find((item) => item.id === form.dataset.taskId);
      if (!task) throw new Error("This task was removed in another tab. Reload and try again.");
      Object.assign(task, values, {
        completedAt: values.status === "done" ? task.completedAt || nowIso() : undefined,
        updatedAt: nowIso(),
      });
    });
    const status = form.querySelector("[data-saved-status]");
    if (status) status.textContent = "Saved";
    taskSavePending = false;
  } catch {
    const status = form.querySelector("[data-saved-status]");
    if (status) status.textContent = "Not saved";
    taskSavePending = false;
  }
}

function renderFocus() {
  const heading = screenTitle("ONE SESSION AT A TIME", "Focus", "A task-linked timer that keeps its place across reloads and tabs.");
  root.append(heading);
  const layout = element("div", { className: "focus-layout" });
  const timerPanel = element("section", { className: "next-up", attrs: { "aria-labelledby": "focus-title" } });
  timerPanel.append(element("p", { className: "next-label", text: "FOCUS SESSION" }));
  timerPanel.append(element("h3", { attrs: { id: "focus-title" }, text: "Ready when you are." }));
  const defaultDuration = state.meta.focusDurationMin || 25;
  const display = element("div", { className: "timer-display", attrs: { "data-timer-display": "true", "aria-label": `${defaultDuration} minutes remaining` }, text: `${String(defaultDuration).padStart(2, "0")}:00` });
  timerPanel.append(display);
  const options = element("div", { className: "timer-options" });
  const duration = input({ type: "number", min: 1, max: 180, step: 1, value: String(state.meta.focusDurationMin || 25) });
  duration.dataset.focusKey = "timer-duration";
  duration.setAttribute("aria-label", "Focus duration in minutes");
  duration.dataset.timerDuration = "true";
  duration.addEventListener("input", () => {
    const minutes = Number(duration.value);
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 180) return;
    display.textContent = `${String(minutes).padStart(2, "0")}:00`;
    display.setAttribute("aria-label", `${minutes} minutes remaining`);
  });
  const presets = element("div", { className: "backup-actions", attrs: { "aria-label": "Focus duration presets" } });
  for (const [label, minutes] of [["15 min", 15], ["25 min", 25], ["45 min", 45], ["60 min", 60]]) {
    const preset = button(label, "timer-preset");
    preset.dataset.minutes = String(minutes);
    presets.append(preset);
  }
  timerPanel.append(presets);
  options.append(field("Minutes", duration));
  const saveDefault = button("Save as default", "save-focus-duration");
  presets.append(saveDefault);
  const taskSelect = select([{ value: "", label: "No linked task" }, ...openTasks().map((task) => ({ value: task.id, label: task.title }))], activeTaskId || "");
  taskSelect.dataset.focusKey = "timer-task";
  taskSelect.dataset.timerTask = "true";
  taskSelect.setAttribute("aria-label", "Link focus session to a task");
  options.append(field("Work on", taskSelect));
  timerPanel.append(options);
  timerPanel.append(element("p", { className: "metadata-text", text: "Choose a preset or enter any duration from 1 to 180 minutes. Your default is saved on this device." }));
  const audioSection = element("section", { className: "focus-audio", attrs: { "aria-labelledby": "focus-audio-title" } });
  audioSection.append(element("h4", { attrs: { id: "focus-audio-title" }, text: "Focus sounds" }));
  audioSection.append(element("p", { className: "metadata-text", text: "Optional sounds are generated in your browser. Nothing is streamed or uploaded." }));
  const audioMode = select([
    { value: "ambient", label: "Gentle ambient tones" },
    { value: "pink", label: "Soft pink noise" },
    { value: "brown", label: "Low brown noise" },
  ], state.meta.focusSound || "ambient");
  audioMode.dataset.focusKey = "focus-sound";
  audioMode.dataset.focusSetting = "focusSound";
  audioSection.append(field("Sound", audioMode));
  const volume = input({ type: "range", min: 0, max: 100, step: 1, value: String(state.meta.focusVolume ?? 25) });
  volume.dataset.focusKey = "focus-volume";
  volume.dataset.focusSetting = "focusVolume";
  volume.setAttribute("aria-label", "Focus sound volume");
  const volumeField = field("Volume", volume);
  const volumeValue = element("output", { text: `${volume.value}%` });
  volume.addEventListener("input", () => { volumeValue.textContent = `${volume.value}%`; });
  volumeField.append(volumeValue);
  audioSection.append(volumeField);
  const audioToggle = button(isFocusAudioPlaying() ? "Stop focus sound" : "Play focus sound", "toggle-focus-audio");
  audioToggle.classList.add("button-primary");
  audioSection.append(audioToggle);
  const musicLink = element("a", {
    className: "music-link",
    text: "Browse instrumental study music on YouTube Music ↗",
    attrs: { href: "https://music.youtube.com/search?q=instrumental%20focus%20music", target: "_blank", rel: "noopener noreferrer" },
  });
  audioSection.append(musicLink);
  audioSection.append(element("p", { className: "metadata-text", text: "External music opens in a new tab; choose and control playback there." }));
  audioSection.append(element("p", { className: "metadata-text", text: "No one sound works best for everyone. Start low, and choose silence whenever you prefer." }));
  timerPanel.append(audioSection);
  const actions = element("div", { className: "next-actions", attrs: { "data-timer-actions": "true" } });
  actions.append(button("Start focus", "start-timer", { className: "button button-primary" }));
  timerPanel.append(actions);
  const status = element("p", { className: "prose", attrs: { "data-timer-status": "true", role: "status" }, text: "Choose a duration and a task, or start a quiet focus block." });
  timerPanel.append(status);
  layout.append(timerPanel);

  const sessionPanel = element("section", { className: "support-block" });
  sessionPanel.append(element("h3", { text: "Recent sessions" }));
  const completed = state.sessions.filter((session) => session.endedAt).sort((a, b) => b.endedAt.localeCompare(a.endedAt)).slice(0, 8);
  if (!completed.length) sessionPanel.append(element("p", { text: "Your focus history will appear here after your first session." }));
  else {
    for (const session of completed) {
      const task = state.tasks.find((item) => item.id === session.taskId);
      sessionPanel.append(element("p", { text: `${formatDateTime(session.endedAt)} · ${session.plannedMin} min · ${task?.title || "Focus session"} · ${session.outcome.replaceAll("_", " ")}` }));
    }
  }
  layout.append(sessionPanel);
  root.append(layout);

  activeSession().then((session) => {
    if (route !== "focus" || !document.querySelector("[data-timer-display]")) return;
    if (session) setActiveTimerUi(session);
  }).catch(notifyStorageError);
}

function formatDateTime(iso) {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(iso));
}

function updateTimerDisplay(session) {
  const display = document.querySelector("[data-timer-display]");
  if (!display) return;
  const left = Math.ceil(remainingMilliseconds(session) / 1000);
  const minutes = Math.floor(left / 60);
  const seconds = left % 60;
  display.textContent = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  display.setAttribute("aria-label", `${minutes} minutes ${seconds} seconds remaining`);
  document.title = `${display.textContent} · Focus — Daybreak`;
}

function setActiveTimerUi(session) {
  const heading = document.querySelector("#focus-title");
  const task = state.tasks.find((item) => item.id === session.taskId);
  if (heading) heading.textContent = task?.title || "Focus session";
  const duration = document.querySelector("[data-timer-duration]");
  const taskSelect = document.querySelector("[data-timer-task]");
  if (duration) {
    duration.value = String(session.plannedMin);
    duration.disabled = true;
  }
  if (taskSelect) {
    taskSelect.value = session.taskId || "";
    taskSelect.disabled = true;
  }
  root.querySelectorAll('[data-action="timer-preset"], [data-action="save-focus-duration"]').forEach((control) => { control.disabled = true; });
  const actions = document.querySelector("[data-timer-actions]");
  if (!actions) return;
  actions.replaceChildren();
  if (session.status === "running") actions.append(button("Pause", "pause-timer", { className: "button button-primary" }));
  else actions.append(button("Resume", "resume-timer", { className: "button button-primary" }));
  actions.append(button("Finish early", "finish-timer"));
  actions.append(button("Cancel", "cancel-timer", { className: "button button-quiet" }));
  const status = document.querySelector("[data-timer-status]");
  if (status) status.textContent = session.status === "paused" ? "Paused. Your remaining time is saved." : "Focus is in progress. You can pause or finish any time.";
  updateTimerDisplay(session);
  window.clearInterval(timerTick);
  if (session.status === "running") timerTick = window.setInterval(() => tickActiveSession(session), 1000);
}

async function tickActiveSession(session) {
  const left = remainingMilliseconds(session);
  if (left <= 0) {
    window.clearInterval(timerTick);
    stopFocusAudio();
    try {
      const finished = await finishSession("completed");
      broadcastSessionChange();
      await refresh();
      if (finished) {
        showToast("Focus session complete.");
        await askMarkTaskDone(finished.taskId);
      }
      renderScreen();
    } catch (error) {
      notifyStorageError(error);
    }
    return;
  }
  updateTimerDisplay(session);
}

async function beginFocus(taskId, durationInput) {
  const duration = Number(durationInput?.value || state.meta.focusDurationMin || 25);
  if (!Number.isInteger(duration) || duration < 1 || duration > 180) {
    durationInput?.setAttribute("aria-invalid", "true");
    durationInput?.focus();
    showToast("Choose a focus length between 1 and 180 minutes.");
    return;
  }
  durationInput?.removeAttribute("aria-invalid");
  try {
    const session = await startSession({ taskId, plannedMin: duration });
    activeTaskId = taskId || "";
    broadcastSessionChange();
    navigate("focus");
    setTimeout(() => setActiveTimerUi(session), 0);
    if (taskId) {
      try {
        await save((next) => {
          const task = next.tasks.find((item) => item.id === taskId);
          if (task && task.status === "todo") task.status = "doing";
        });
      } catch {}
    }
    await refresh();
    setTimeout(() => setActiveTimerUi(session), 0);
    announcer.textContent = "Focus session started.";
  } catch (error) {
    showToast(error.message);
  }
}

async function askMarkTaskDone(taskId) {
  const task = state.tasks.find((item) => item.id === taskId);
  if (!task || task.status === "done") return;
  const result = await askConfirmation("Mark task done?", `You focused on “${task.title}”. Would you like to mark it done?`, [
    { label: "Keep it open", value: false },
    { label: "Mark done", value: true, primary: true },
  ]);
  if (result) await setTaskStatus(taskId, "done");
}

async function pauseTimer() {
  try {
    const session = await pauseSession();
    broadcastSessionChange();
    await refresh();
    if (session) setActiveTimerUi(session);
    announcer.textContent = "Focus session paused.";
  } catch (error) {
    notifyStorageError(error);
  }
}

async function resumeTimer() {
  try {
    const session = await resumeSession();
    broadcastSessionChange();
    await refresh();
    if (session) setActiveTimerUi(session);
    announcer.textContent = "Focus session resumed.";
  } catch (error) {
    notifyStorageError(error);
  }
}

async function endTimer(outcome) {
  if (outcome === "cancelled") {
    const accepted = await askConfirmation("Cancel this session?", "This session will be saved as cancelled.", [
      { label: "Keep session", value: false }, { label: "Cancel session", value: true, primary: true },
    ]);
    if (!accepted) return;
  }
  try {
    const session = await finishSession(outcome);
    stopFocusAudio();
    broadcastSessionChange();
    await refresh();
    window.clearInterval(timerTick);
    document.title = "Focus — Daybreak";
    if (outcome === "stopped_early" && session) await askMarkTaskDone(session.taskId);
    renderScreen();
    announcer.textContent = outcome === "cancelled" ? "Focus session cancelled." : "Focus session ended.";
  } catch (error) {
    notifyStorageError(error);
  }
}

function renderSettings() {
  root.append(screenTitle("YOUR SPACE", "Settings", "Manage appearance, shortcuts, local storage, backups, and deleted tasks."));
  const themeSection = element("section", { className: "panel" });
  themeSection.append(element("h3", { text: "Appearance" }));
  const themeSelect = select([{ value: "system", label: "System" }, { value: "light", label: "Light" }, { value: "dark", label: "Dark" }], currentTheme());
  themeSelect.dataset.focusKey = "theme";
  themeSelect.addEventListener("change", () => saveTheme(themeSelect.value));
  themeSection.append(field("Color theme", themeSelect));
  const shortcut = input({ type: "checkbox" });
  shortcut.checked = state.meta.shortcutN !== false;
  shortcut.dataset.focusKey = "shortcut-n";
  shortcut.addEventListener("change", () => save((next) => { next.meta.shortcutN = shortcut.checked; }).catch(() => {}));
  const shortcutLabel = element("label", { className: "storage-status" });
  shortcutLabel.append(shortcut, element("span", { text: "Use N to focus quick add when you are not typing" }));
  themeSection.append(shortcutLabel);
  root.append(themeSection);

  const storage = element("section", { className: "panel" });
  storage.append(element("h3", { text: "Local storage" }));
  const statusText = state.meta.storagePersistence === "persistent" ? "Storage: persistent" : "Storage: may be cleared by the browser";
  storage.append(element("p", { className: "storage-status", text: statusText }));
  storage.append(element("p", { className: "prose", text: "Your planner data stays in this browser. Export a backup before clearing site data or moving to another device." }));
  root.append(storage);

  const backupSection = element("section", { className: "panel" });
  backupSection.append(element("h3", { text: "Backups" }));
  const backupActions = element("div", { className: "backup-actions" });
  backupActions.append(button("Export JSON", "export-backup", { className: "button button-primary" }));
  const importLabel = element("label", { className: "button" });
  importLabel.append(element("span", { text: "Choose backup" }));
  const file = input({ type: "file" });
  file.accept = "application/json,.json";
  file.className = "visually-hidden";
  file.dataset.importFile = "true";
  file.dataset.focusKey = "import-file";
  importLabel.append(file);
  backupActions.append(importLabel);
  backupSection.append(backupActions);
  const lastBackup = state.meta.lastBackupAt;
  const backupAge = lastBackup ? daysBetween(dateKey(new Date(lastBackup)), dateKey()) : null;
  const backupLabel = backupAge === null ? "Not yet exported" : backupAge <= 0 ? "Today" : backupAge === 1 ? "Yesterday" : `${backupAge} days ago`;
  backupSection.append(element("p", { className: "storage-status", text: `Last backup: ${backupLabel}` }));
  const preview = element("div", { attrs: { "data-import-preview": "true", role: "status" } });
  if (importMessage) preview.append(element("p", { className: pendingImport ? "storage-status" : "form-error", text: importMessage }));
  if (pendingImport) {
    const confirmImport = button("Replace planner with this backup", "confirm-import", { className: "button button-danger" });
    preview.append(confirmImport);
  }
  backupSection.append(preview);
  root.append(backupSection);

  const deletedSection = element("section", { className: "panel" });
  const deletedTasks = state.tasks.filter((task) => task.deletedAt);
  deletedSection.append(element("h3", { text: `Recently deleted · ${deletedTasks.length}` }));
  deletedSection.append(element("p", { className: "prose", text: "Deleted tasks remain available here for 30 days, then Daybreak removes them permanently." }));
  if (!deletedTasks.length) deletedSection.append(element("p", { className: "storage-status", text: "Nothing has been deleted recently." }));
  for (const task of deletedTasks.sort((a, b) => b.deletedAt.localeCompare(a.deletedAt))) {
    const row = element("div", { className: "deleted-row" });
    row.append(element("span", { text: task.title }));
    const actions = element("div", { className: "task-actions" });
    const restore = button("Restore", "restore-task");
    restore.dataset.taskId = task.id;
    const permanent = button("Delete forever", "delete-permanently", { className: "button button-quiet button-danger" });
    permanent.dataset.taskId = task.id;
    actions.append(restore, permanent);
    row.append(actions);
    deletedSection.append(row);
  }
  root.append(deletedSection);

  renderLegacyPreservation();
}

function renderLegacyPreservation() {
  const legacy = state.meta.legacyState;
  if (!legacy) return;
  const section = element("section", { className: "panel" });
  section.append(element("h3", { text: "Earlier Daybreak data" }));
  section.append(element("p", { className: "prose", text: "Your original Daybreak data is preserved in the migration backup and in this browser database." }));
  if (legacy.campus?.url) {
    const link = element("a", { className: "button", text: legacy.campus.name || "Open saved university link", attrs: { href: legacy.campus.url, target: "_blank", rel: "noopener noreferrer" } });
    section.append(link);
  }
  if (typeof legacy.notes === "string" && legacy.notes) {
    const note = element("details", { className: "panel" });
    note.append(element("summary", { text: "Previous study notes" }), element("p", { className: "prose", text: legacy.notes }));
    section.append(note);
  }
  const checkins = Array.isArray(legacy.checkins) ? legacy.checkins.length : 0;
  if (checkins) section.append(element("p", { className: "storage-status", text: `${checkins} previous check-in record${checkins === 1 ? "" : "s"} preserved in your migration data.` }));
  const backupActions = element("div", { className: "backup-actions" });
  backupActions.append(button("Download original data", "download-legacy"));
  backupActions.append(button("Remove legacy browser copies", "remove-legacy", { className: "button button-quiet button-danger" }));
  section.append(backupActions);
  root.append(section);

  const resources = element("section", { className: "panel" });
  resources.append(element("h3", { text: "Learning links" }));
  for (const [label, href] of [
    ["Learn C++", "https://www.learncpp.com/"], ["LeetCode", "https://leetcode.com/problemset/"],
    ["Python tutorial", "https://docs.python.org/3/tutorial/"], ["Kaggle Learn", "https://www.kaggle.com/learn"],
    ["Google Scholar", "https://scholar.google.com/"], ["freeCodeCamp", "https://www.freecodecamp.org/learn/"],
  ]) resources.append(element("a", { className: "button", text: `${label} ↗`, attrs: { href, target: "_blank", rel: "noopener noreferrer" } }));
  root.append(resources);
}

function showToast(message, undo) {
  window.clearTimeout(toastTimeout);
  toastUndo = undo;
  toastRemaining = 6000;
  toastPaused = false;
  toast.replaceChildren(element("span", { text: message }));
  if (undo) toast.append(button("Undo", "undo-toast", { className: "button button-quiet" }));
  toast.append(button("Dismiss", "dismiss-toast", { className: "button button-quiet", label: "Dismiss message" }));
  toast.classList.add("is-visible");
  toastStartedAt = Date.now();
  toastTimeout = window.setTimeout(hideToast, toastRemaining);
}

function hideToast() {
  toast.classList.remove("is-visible");
  toastUndo = null;
}

function pauseToast() {
  if (toastPaused || !toast.classList.contains("is-visible")) return;
  toastPaused = true;
  window.clearTimeout(toastTimeout);
  toastRemaining = Math.max(0, toastRemaining - (Date.now() - toastStartedAt));
}

function resumeToast() {
  if (!toastPaused || !toast.classList.contains("is-visible")) return;
  toastPaused = false;
  toastStartedAt = Date.now();
  toastTimeout = window.setTimeout(hideToast, toastRemaining);
}

async function askConfirmation(title, description, choices) {
  const form = element("form", { attrs: { method: "dialog" } });
  const header = element("div", { className: "dialog-header" });
  header.append(element("div", { children: undefined }));
  const copy = element("div");
  copy.append(element("h2", { attrs: { id: "confirm-title" }, text: title }));
  copy.append(element("p", { className: "prose", text: description }));
  header.replaceChildren(copy);
  form.append(header);
  const actions = element("div", { className: "next-actions" });
  for (const choice of choices) {
    const option = button(choice.label, "confirm-choice", { className: choice.primary ? "button button-primary" : "button" });
    option.dataset.confirm = String(choice.value);
    actions.append(option);
  }
  form.append(actions);
  confirmDialog.replaceChildren(form);
  confirmDialog.showModal();
  return new Promise((resolve) => {
    form.addEventListener("click", (event) => {
      const option = event.target.closest("[data-confirm]");
      if (!option) return;
      event.preventDefault();
      const result = option.dataset.confirm;
      confirmDialog.close();
      resolve(result === "true");
    });
    confirmDialog.addEventListener("cancel", () => resolve(false), { once: true });
  });
}

async function setTaskStatus(taskId, status) {
  const previous = state.tasks.find((task) => task.id === taskId);
  if (!previous) return;
  const copyPrevious = structuredClone(previous);
  const completedAt = status === "done" ? previous.completedAt || nowIso() : undefined;
  try {
    await save((next) => {
      const task = next.tasks.find((item) => item.id === taskId);
      if (!task) return;
      task.status = status;
      task.completedAt = completedAt;
      if (status === "done") task.pinnedAt = undefined;
      task.updatedAt = nowIso();
      if (status === "done") next.meta.lastStudyDate = dateKey();
    });
    showToast(status === "done" ? "Task completed." : "Task reopened.", () => restoreTaskSnapshot(taskId, copyPrevious));
    if (status === "done") window.setTimeout(() => {
      if (route === "today") renderScreen();
    }, COMPLETION_COLLAPSE_MS);
  } catch {}
}

async function toggleTask(taskId) {
  const task = state.tasks.find((item) => item.id === taskId);
  if (!task) return;
  await setTaskStatus(taskId, task.status === "done" ? "todo" : "done");
}

async function restoreTaskSnapshot(taskId, previous) {
  try {
    await save((next) => {
      const index = next.tasks.findIndex((task) => task.id === taskId);
      if (index >= 0) next.tasks[index] = previous;
    });
    showToast("Change undone.");
  } catch {}
}

async function deleteTaskToRecentlyDeleted(taskId) {
  const task = state.tasks.find((item) => item.id === taskId);
  if (!task) return;
  const previous = structuredClone(task);
  try {
    await save((next) => {
      const item = next.tasks.find((candidate) => candidate.id === taskId);
      if (item) item.deletedAt = nowIso();
    });
    showToast("Task moved to Recently deleted.", () => restoreTaskSnapshot(taskId, previous));
  } catch {}
}

async function undoTask(taskId, created = false) {
  const task = state.tasks.find((item) => item.id === taskId);
  if (!task) return;
  if (created) {
    try {
      await save((next) => { next.tasks = next.tasks.filter((item) => item.id !== taskId); });
      showToast("Task addition undone.");
    } catch {}
    return;
  }
}

async function restoreTask(taskId) {
  try {
    await save((next) => {
      const task = next.tasks.find((item) => item.id === taskId);
      if (task) task.deletedAt = undefined;
    });
    showToast("Task restored.");
  } catch {}
}

async function deleteTaskForever(taskId) {
  const task = state.tasks.find((item) => item.id === taskId);
  if (!task) return;
  const accepted = await askConfirmation("Delete this task permanently?", `“${task.title}” cannot be restored after permanent deletion.`, [
    { label: "Keep task", value: false }, { label: "Delete forever", value: true, primary: true },
  ]);
  if (!accepted) return;
  try {
    await save((next) => { next.tasks = next.tasks.filter((item) => item.id !== taskId); });
    showToast("Task deleted permanently.");
  } catch {}
}

async function pinTask(taskId) {
  try {
    await save((next) => {
      const task = next.tasks.find((item) => item.id === taskId);
      if (!task) return;
      task.pinnedAt = task.pinnedAt ? undefined : nowIso();
      task.updatedAt = nowIso();
    });
    const pinned = state.tasks.find((task) => task.id === taskId)?.pinnedAt;
    const sheetButton = sheet.querySelector('[data-form="task"] [data-action="pin-task"]');
    if (sheetButton?.closest('[data-form="task"]')?.dataset.taskId === taskId) sheetButton.textContent = pinned ? "Unpin task" : "Pin task";
    showToast(pinned ? "Task pinned for Next Up." : "Task unpinned.");
  } catch {}
}

async function pullTaskToToday(taskId) {
  try {
    await save((next) => {
      const task = next.tasks.find((item) => item.id === taskId);
      if (task) {
        task.dueDate = dateKey();
        task.updatedAt = nowIso();
      }
    });
    showToast("Task moved to today.");
  } catch {}
}

async function reorderTask(taskId, direction, targetTaskId = "") {
  const sourceRow = root.querySelector(`.task-row[data-task-id="${escapeKey(taskId)}"]`);
  const list = sourceRow?.closest(".task-list") || root;
  const visible = [...list.querySelectorAll(".task-row")].map((row) => row.dataset.taskId);
  const index = visible.indexOf(taskId);
  const targetIndex = targetTaskId ? visible.indexOf(targetTaskId) : index + direction;
  if (index < 0 || targetIndex < 0 || targetIndex >= visible.length) return;
  const reordered = [...visible];
  reordered.splice(index, 1);
  reordered.splice(targetTaskId && index < targetIndex ? targetIndex - 1 : targetIndex, 0, taskId);
  try {
    await save((next) => {
      reordered.forEach((id, order) => {
        const task = next.tasks.find((item) => item.id === id);
        if (task) task.order = order;
      });
    });
  } catch {}
}

async function handleSubjectDelete(subjectId) {
  const subject = subjectById(subjectId);
  if (!subject) return;
  const linked = state.tasks.filter((task) => task.subjectId === subjectId);
  if (!linked.length) {
    const accepted = await askConfirmation("Delete this subject?", `“${subject.name}” has no tasks and will be removed.`, [
      { label: "Keep subject", value: false }, { label: "Delete subject", value: true, primary: true },
    ]);
    if (!accepted) return;
    await save((next) => { next.subjects = next.subjects.filter((item) => item.id !== subjectId); });
    showToast("Subject deleted.");
    return;
  }
  const answer = await askChoice("This subject has tasks", `Move ${linked.length} task${linked.length === 1 ? "" : "s"} to No subject, or archive “${subject.name}”?`, [
    { label: "Cancel", value: "cancel" },
    { label: "Move tasks to No subject", value: "move" },
    { label: "Archive subject instead", value: "archive", primary: true },
  ]);
  if (answer === "move") {
    await save((next) => {
      next.tasks.forEach((task) => { if (task.subjectId === subjectId) task.subjectId = undefined; });
      next.subjects = next.subjects.filter((item) => item.id !== subjectId);
    });
    showToast("Tasks moved to No subject and subject deleted.");
  } else if (answer === "archive") {
    await save((next) => {
      const item = next.subjects.find((candidate) => candidate.id === subjectId);
      if (item) item.archivedAt = nowIso();
    });
    showToast("Subject archived. Its tasks remain linked.");
  }
}

async function askChoice(title, description, choices) {
  const form = element("form", { attrs: { method: "dialog" } });
  const copy = element("div");
  copy.append(element("h2", { attrs: { id: "confirm-title" }, text: title }));
  copy.append(element("p", { className: "prose", text: description }));
  const actions = element("div", { className: "next-actions" });
  for (const choice of choices) {
    const option = button(choice.label, "confirm-choice", { className: choice.primary ? "button button-primary" : "button" });
    option.dataset.choice = choice.value;
    actions.append(option);
  }
  form.append(copy, actions);
  confirmDialog.replaceChildren(form);
  confirmDialog.showModal();
  return new Promise((resolve) => {
    form.addEventListener("click", (event) => {
      const option = event.target.closest("[data-choice]");
      if (!option) return;
      event.preventDefault();
      confirmDialog.close();
      resolve(option.dataset.choice);
    });
    confirmDialog.addEventListener("cancel", () => resolve("cancel"), { once: true });
  });
}

async function setSubjectArchived(subjectId, archived) {
  try {
    await save((next) => {
      const subject = next.subjects.find((item) => item.id === subjectId);
      if (subject) subject.archivedAt = archived ? nowIso() : undefined;
    });
    showToast(archived ? "Subject archived." : "Subject restored.");
  } catch {}
}

function moveSubtask(taskId, subtaskId, offset) {
  save((next) => {
    const task = next.tasks.find((item) => item.id === taskId);
    if (!task) return;
    const index = task.subtasks.findIndex((subtask) => subtask.id === subtaskId);
    const target = index + offset;
    if (target < 0 || target >= task.subtasks.length) return;
    [task.subtasks[index], task.subtasks[target]] = [task.subtasks[target], task.subtasks[index]];
    task.updatedAt = nowIso();
  }).then(() => {
    openTaskSheet(state.tasks.find((item) => item.id === taskId));
    sheet.querySelector(`[data-subtask-id="${escapeKey(subtaskId)}"] [data-subtask-toggle]`)?.focus();
  }).catch(() => {});
}

function addSubtask(taskId) {
  const control = sheet.querySelector("[data-subtask-new]");
  const title = control.value.trim();
  if (!title) {
    control.focus();
    return;
  }
  save((next) => {
    const task = next.tasks.find((item) => item.id === taskId);
    if (task) {
      task.subtasks.push({ id: uid(), title, done: false });
      task.updatedAt = nowIso();
    }
  }).then(() => {
    const focus = control.dataset.focusKey;
    openTaskSheet(state.tasks.find((item) => item.id === taskId));
    const nextInput = sheet.querySelector(`[data-focus-key="${focus}"]`);
    nextInput?.focus();
  }).catch(() => {});
}

function changeSubtask(taskId, subtaskId, change) {
  save((next) => {
    const task = next.tasks.find((item) => item.id === taskId);
    if (!task) return;
    if (change === "remove") task.subtasks = task.subtasks.filter((item) => item.id !== subtaskId);
    else {
      const subtask = task.subtasks.find((item) => item.id === subtaskId);
      if (subtask) subtask.done = !subtask.done;
    }
    task.updatedAt = nowIso();
  }).then(() => {
    openTaskSheet(state.tasks.find((item) => item.id === taskId));
    const target = change === "remove"
      ? sheet.querySelector(".subtask-row [data-subtask-toggle]") || sheet.querySelector("[data-subtask-new]")
      : sheet.querySelector(`[data-subtask-id="${escapeKey(subtaskId)}"] [data-subtask-toggle]`);
    target?.focus();
  }).catch(() => {});
}

function currentTheme() {
  try {
    const preference = localStorage.getItem("daybreak.theme");
    return ["light", "dark"].includes(preference) ? preference : "system";
  } catch (error) {
    console.error("Could not read the saved Daybreak theme preference.", error);
    return "system";
  }
}

function saveTheme(theme) {
  try {
    if (theme === "system") {
      localStorage.removeItem("daybreak.theme");
      delete document.documentElement.dataset.theme;
    } else {
      localStorage.setItem("daybreak.theme", theme);
      document.documentElement.dataset.theme = theme;
    }
    showToast("Appearance updated.");
  } catch (error) {
    showToast("Daybreak could not save this appearance preference.");
    console.error("Could not save the Daybreak theme preference.", error);
  }
}

function focusQuickAdd() {
  if (!["today", "tasks"].includes(route)) {
    navigate("today");
    window.setTimeout(() => root.querySelector("[data-quick-title]")?.focus(), 0);
    return;
  }
  root.querySelector("[data-quick-title]")?.focus();
}

function showCommandPalette() {
  if (commandDialog.open) {
    commandDialog.querySelector("input")?.focus();
    return;
  }
  const form = element("form", { attrs: { method: "dialog" } });
  const header = element("div", { className: "dialog-header" });
  const copy = element("div");
  copy.append(element("p", { className: "eyebrow", text: "DAYBREAK COMMANDS" }));
  copy.append(element("h2", { attrs: { id: "command-title" }, text: "Where do you want to go?" }));
  header.append(copy, button("Close", "close-command-palette", { className: "button button-quiet" }));
  const search = input({ placeholder: "Search pages and actions", maxlength: 60 });
  search.setAttribute("aria-label", "Search Daybreak commands");
  const list = element("div", { className: "command-list" });
  const commands = [
    ["Today", "today", "Your daily plan"],
    ["Tasks", "tasks", "Filter and organize tasks"],
    ["Subjects", "subjects", "Manage your courses"],
    ["Focus", "focus", "Start or resume a focus session"],
    ["Settings", "settings", "Appearance, backups, and deleted tasks"],
    ["Add task", "add-task", "Create a task with quick add"],
  ];
  for (const [label, routeName, hint] of commands) {
    const option = button(label, "command-route", { className: "command-option" });
    option.dataset.route = routeName;
    option.append(element("span", { className: "command-hint", text: hint }));
    list.append(option);
  }
  search.addEventListener("input", () => {
    const needle = search.value.trim().toLocaleLowerCase();
    list.querySelectorAll(".command-option").forEach((option) => {
      option.hidden = !`${option.textContent} ${option.dataset.route}`.toLocaleLowerCase().includes(needle);
    });
  });
  search.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      list.querySelector(".command-option:not([hidden])")?.focus();
    } else if (event.key === "Enter") {
      event.preventDefault();
      list.querySelector(".command-option:not([hidden])")?.click();
    }
  });
  list.addEventListener("keydown", (event) => {
    if (!["ArrowDown", "ArrowUp"].includes(event.key)) return;
    event.preventDefault();
    const options = [...list.querySelectorAll(".command-option:not([hidden])")];
    const index = options.indexOf(document.activeElement);
    options[(index + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length]?.focus();
  });
  form.append(header, search, list);
  commandDialog.replaceChildren(form);
  commandDialog.showModal();
  search.focus();
}

function downloadText(text, filename, type = "application/json") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = element("a", { attrs: { href: url, download: filename } });
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function exportBackup() {
  try {
    const backup = await makeBackup();
    downloadJson(backup, `daybreak-backup-${dateKey()}.json`);
    await recordBackupTime();
    await refresh();
    showToast("Backup exported.");
  } catch (error) {
    notifyStorageError(error);
  }
}

async function readImportFile(file) {
  pendingImport = null;
  importMessage = "";
  try {
    const payload = JSON.parse(await file.text());
    const validation = validateBackup(payload);
    if (!validation.valid) throw new Error(validation.error);
    pendingImport = payload;
    importMessage = `Ready to replace this planner with ${payload.tasks.length} task${payload.tasks.length === 1 ? "" : "s"}, ${payload.subjects.length} subject${payload.subjects.length === 1 ? "" : "s"}, and ${payload.sessions.length} focus session${payload.sessions.length === 1 ? "" : "s"}.`;
  } catch (error) {
    importMessage = error instanceof SyntaxError
      ? "This file is not valid JSON. Nothing has been imported."
      : error.message || "This backup could not be read. Nothing has been imported.";
  }
  renderScreen();
}

async function confirmImport() {
  if (!pendingImport) return;
  const payload = pendingImport;
  const accepted = await askConfirmation(
    "Replace your planner data?",
    "This will replace current subjects, tasks, focus sessions, and settings with the selected backup. Export a backup first if you may want to keep the current data.",
    [{ label: "Cancel", value: false }, { label: "Replace data", value: true, primary: true }],
  );
  if (!accepted) return;
  try {
    await importBackup(payload);
    pendingImport = null;
    importMessage = "";
    showToast("Backup imported.");
    renderScreen();
  } catch (error) {
    importMessage = error.message || "The backup could not be imported.";
    pendingImport = null;
    renderScreen();
    notifyStorageError(error);
  }
}

async function downloadLegacy() {
  try {
    const raw = localStorage.getItem("studyloop.v1") || localStorage.getItem("studyloop.v1.backup");
    if (raw) downloadRawData(raw);
    else if (state.meta.legacyState) downloadJson(state.meta.legacyState, "daybreak-original-data.json");
    else throw new Error("No original browser data is available to download.");
  } catch (error) {
    showToast(error.message || "The original data could not be downloaded.");
  }
}

async function removeLegacyCopies() {
  const accepted = await askConfirmation(
    "Remove the old browser copies?",
    "The imported database copy will remain. This removes only studyloop.v1 and its browser safety copy, and cannot be undone.",
    [{ label: "Keep copies", value: false }, { label: "Remove copies", value: true, primary: true }],
  );
  if (!accepted) return;
  try {
    localStorage.removeItem("studyloop.v1");
    localStorage.removeItem("studyloop.v1.backup");
    showToast("Old browser copies removed. The imported database data remains.");
  } catch (error) {
    showToast("Daybreak could not remove the old browser copies.");
    console.error("Could not remove legacy Daybreak browser data.", error);
  }
}

async function handleClick(event) {
  const control = event.target.closest("[data-action]");
  if (!control) return;
  const action = control.dataset.action;
  const taskRow = control.closest("[data-task-id]");
  const taskId = control.dataset.taskId || taskRow?.dataset.taskId;
  const subjectRow = control.closest("[data-subject-id]");
  const subjectId = control.dataset.subjectId || subjectRow?.dataset.subjectId;

  if (action === "close-command-palette") commandDialog.close();
  else if (action === "command-route") {
    const targetRoute = control.dataset.route;
    commandDialog.close();
    if (targetRoute === "add-task") {
      navigate("today");
      window.setTimeout(focusQuickAdd, 0);
    } else navigate(targetRoute);
  } else if (action === "focus-quick-add") focusQuickAdd();
  else if (action === "go-focus") navigate("focus");
  else if (action === "quick-add-open") focusQuickAdd();
  else if (action === "open-subject-create") openSubjectSheet();
  else if (action === "edit-subject") openSubjectSheet(subjectById(subjectId));
  else if (action === "archive-subject") await setSubjectArchived(subjectId, true);
  else if (action === "restore-subject") await setSubjectArchived(subjectId, false);
  else if (action === "delete-subject") await handleSubjectDelete(subjectId);
  else if (action === "choose-subject-color") {
    control.closest(".color-options").querySelectorAll("[data-action='choose-subject-color']").forEach((option) => option.setAttribute("aria-pressed", String(option === control)));
  } else if (action === "close-sheet") {
    const form = sheet.querySelector('[data-form="task"]');
    if (form && taskSavePending) await saveTaskForm(form);
    sheet.close();
  } else if (action === "save-task-sheet") {
    const form = sheet.querySelector('[data-form="task"]');
    if (form) await saveTaskForm(form);
  } else if (action === "toggle-task") await toggleTask(taskId);
  else if (action === "edit-task") openTaskSheet(state.tasks.find((task) => task.id === taskId));
  else if (action === "delete-task") await deleteTaskToRecentlyDeleted(taskId);
  else if (action === "pin-task") await pinTask(taskId);
  else if (action === "focus-task" || action === "start-focus") await beginFocus(taskId, root.querySelector("[data-timer-duration]"));
  else if (action === "timer-preset") {
    const duration = root.querySelector("[data-timer-duration]");
    if (duration && !duration.disabled) {
      duration.value = control.dataset.minutes;
      duration.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }
  else if (action === "save-focus-duration") {
    const duration = Number(root.querySelector("[data-timer-duration]")?.value);
    if (!Number.isInteger(duration) || duration < 1 || duration > 180) {
      const durationInput = root.querySelector("[data-timer-duration]");
      durationInput?.setAttribute("aria-invalid", "true");
      durationInput?.focus();
      showToast("Choose a default focus length between 1 and 180 minutes.");
      return;
    }
    await save((next) => { next.meta.focusDurationMin = duration; });
    showToast(`Your default focus length is now ${duration} minutes.`);
  }
  else if (action === "toggle-focus-audio") {
    if (isFocusAudioPlaying()) {
      stopFocusAudio();
      control.textContent = "Play focus sound";
    } else {
      await playFocusAudio(
        root.querySelector("[data-focus-setting='focusSound']")?.value || "ambient",
        Number(root.querySelector("[data-focus-setting='focusVolume']")?.value ?? 25),
      );
      control.textContent = "Stop focus sound";
    }
  }
  else if (action === "show-alternatives") {
    selectedAlternative = selectedAlternative ? "" : "shown";
    renderScreen();
  } else if (action === "choose-alternative") {
    selectedAlternative = control.dataset.taskId;
    renderScreen();
  } else if (action === "save-estimate") {
    const estimateInput = control.closest(".field").querySelector("input");
    const estimateMin = Number(estimateInput.value);
    if (!Number.isInteger(estimateMin) || estimateMin < 1 || estimateMin > 600) {
      estimateInput.setAttribute("aria-invalid", "true");
      estimateInput.focus();
      return;
    }
    await save((next) => {
      const task = next.tasks.find((item) => item.id === taskId);
      if (task) task.estimateMin = estimateMin;
    });
  } else if (action === "pull-today") await pullTaskToToday(taskId);
  else if (action === "move-subtask") {
    const row = control.closest("[data-subtask-id]");
    moveSubtask(taskId, row.dataset.subtaskId, Number(control.dataset.direction));
  } else if (action === "remove-subtask") {
    const row = control.closest("[data-subtask-id]");
    changeSubtask(taskId, row.dataset.subtaskId, "remove");
  } else if (action === "add-subtask") addSubtask(sheet.querySelector('[data-form="task"]').dataset.taskId);
  else if (action === "start-timer") await beginFocus(root.querySelector("[data-timer-task]")?.value, root.querySelector("[data-timer-duration]"));
  else if (action === "pause-timer") await pauseTimer();
  else if (action === "resume-timer") await resumeTimer();
  else if (action === "finish-timer") await endTimer("stopped_early");
  else if (action === "cancel-timer") await endTimer("cancelled");
  else if (action === "export-backup") await exportBackup();
  else if (action === "confirm-import") await confirmImport();
  else if (action === "restore-task") await restoreTask(taskId);
  else if (action === "delete-permanently") await deleteTaskForever(taskId);
  else if (action === "download-legacy") await downloadLegacy();
  else if (action === "remove-legacy") await removeLegacyCopies();
  else if (action === "undo-toast") {
    const undo = toastUndo;
    hideToast();
    if (undo) await undo();
  } else if (action === "dismiss-toast") hideToast();
  else if (action === "download-recovery") {
    if (recoveryRaw !== null) downloadText(recoveryRaw, "daybreak-recovery.json");
  }
}

function bindEvents() {
  updateHeaderDateTime();
  headerClockTick = window.setInterval(updateHeaderDateTime, 1000);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) updateHeaderDateTime();
  });
  quickAddOpen.addEventListener("click", focusQuickAdd);
  document.addEventListener("click", (event) => {
    handleClick(event).catch((error) => {
      console.error("Daybreak action failed.", error);
      showToast(error.message || "Daybreak could not complete that action.");
    });
  });
  document.addEventListener("change", (event) => {
    const target = event.target;
    if (target.matches("[data-filter]")) {
      const next = new URLSearchParams(query);
      if (target.value) next.set(target.dataset.filter, target.value);
      else next.delete(target.dataset.filter);
      navigate("tasks", next);
    } else if (target.matches("[data-import-file]") && target.files?.[0]) {
      readImportFile(target.files[0]).catch((error) => {
        importMessage = error.message || "The selected backup could not be read.";
        pendingImport = null;
        renderScreen();
      });
    } else if (target.matches("[data-subtask-toggle]")) {
      const row = target.closest("[data-subtask-id]");
      changeSubtask(sheet.querySelector('[data-form="task"]').dataset.taskId, row.dataset.subtaskId, "toggle");
    } else if (target.matches("[data-focus-setting]")) {
      const key = target.dataset.focusSetting;
      const value = key === "focusVolume" ? Number(target.value) : target.value;
      save((next) => { next.meta[key] = value; }).then(async () => {
        if (!isFocusAudioPlaying()) return;
        if (key === "focusVolume") setFocusAudioVolume(value);
        else await playFocusAudio(value, Number(state.meta.focusVolume ?? 25));
      }).catch((error) => {
        console.error("Could not save focus sound preference.", error);
        showToast("Your focus sound preference could not be saved.");
      });
    }
  });
  root.addEventListener("dragstart", (event) => {
    const row = event.target.closest(".task-row");
    if (!row) return;
    draggedTaskId = row.dataset.taskId;
    row.classList.add("is-dragging");
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", draggedTaskId);
  });
  root.addEventListener("dragover", (event) => {
    const target = event.target.closest(".task-row");
    const source = root.querySelector(`.task-row[data-task-id="${escapeKey(draggedTaskId)}"]`);
    if (target && source?.parentElement === target.parentElement && draggedTaskId) event.preventDefault();
  });
  root.addEventListener("drop", (event) => {
    const target = event.target.closest(".task-row");
    const source = root.querySelector(`.task-row[data-task-id="${escapeKey(draggedTaskId)}"]`);
    if (!target || !source || source.parentElement !== target.parentElement || target.dataset.taskId === draggedTaskId) return;
    event.preventDefault();
    reorderTask(draggedTaskId, 0, target.dataset.taskId);
    draggedTaskId = "";
  });
  root.addEventListener("dragend", () => {
    root.querySelectorAll(".task-row.is-dragging").forEach((row) => row.classList.remove("is-dragging"));
    draggedTaskId = "";
  });
  toast.addEventListener("mouseenter", pauseToast);
  toast.addEventListener("mouseleave", resumeToast);
  toast.addEventListener("focusin", pauseToast);
  toast.addEventListener("focusout", (event) => {
    if (!toast.contains(event.relatedTarget)) resumeToast();
  });
  sheet.addEventListener("cancel", (event) => {
    if (taskSavePending) {
      event.preventDefault();
      const form = sheet.querySelector('[data-form="task"]');
      if (form) saveTaskForm(form).then(
        () => sheet.close(),
        (error) => {
          notifyStorageError(error);
          sheet.close();
        },
      );
    }
  });
  window.addEventListener("daybreak:storage-error", (event) => {
    storageMessage.hidden = false;
    storageMessage.textContent = event.detail || "Storage changed in another tab. Reload Daybreak to continue safely.";
  });
  window.addEventListener("storage", (event) => {
    if (event.key === "daybreak.theme") {
      document.documentElement.dataset.theme = event.newValue || "";
      if (!event.newValue) delete document.documentElement.dataset.theme;
      if (route === "settings") renderScreen();
    }
  });
  window.addEventListener("keydown", (event) => {
    const editing = event.target.matches("input, textarea, select, [contenteditable='true']");
    if (commandDialog.open && !(event.metaKey || event.ctrlKey)) return;
    if (event.altKey && !editing && ["ArrowUp", "ArrowDown"].includes(event.key)) {
      const row = event.target.closest(".task-row");
      if (row) {
        event.preventDefault();
        reorderTask(row.dataset.taskId, event.key === "ArrowUp" ? -1 : 1);
        return;
      }
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      showCommandPalette();
    } else if (!editing && !event.metaKey && !event.ctrlKey && !event.altKey && event.key.toLowerCase() === "n" && state?.meta.shortcutN !== false) {
      event.preventDefault();
      focusQuickAdd();
    }
  });
  onRouteChange((location) => navigateTo(location));
}

function showRecoveryScreen(error) {
  routeHeading.textContent = "Data recovery";
  routeDate.textContent = "";
  routeTime.textContent = "";
  routeTime.parentElement.hidden = true;
  root.replaceChildren();
  const panel = element("section", { className: "next-up" });
  panel.append(element("h2", { text: "Daybreak could not safely open your saved data." }));
  panel.append(element("p", { className: "prose", text: error.message || "The data migration could not complete. Your original browser data has not been removed." }));
  if (recoveryRaw !== null) panel.append(button("Download original data", "download-recovery", { className: "button button-primary" }));
  panel.append(button("Retry", "retry-startup", { className: "button" }));
  root.append(panel);
}

export async function startApp() {
  if (!eventsBound) {
    bindEvents();
    eventsBound = true;
  }
  try {
    await initializeStore();
    const expiry = Date.now() - DELETED_TASK_RETENTION_MS;
    const expiredIds = getState().tasks.filter((task) => task.deletedAt && Date.parse(task.deletedAt) < expiry).map((task) => task.id);
    if (expiredIds.length) {
      try {
        await update((next) => {
          next.tasks = next.tasks.filter((task) => !expiredIds.includes(task.id));
        });
      } catch (error) {
        notifyStorageError(error);
      }
    }
    state = getState();
    routeTime.parentElement.hidden = false;
    unsubscribeStore?.();
    unsubscribeStore = subscribe((snapshot) => snapshot, (next) => {
      state = next;
      renderScreen();
    });
    navigateTo(readLocation(), true);
    renderScreen({ restoreFocus: false });
  } catch (error) {
    recoveryRaw = error.recoveryRaw ?? null;
    showRecoveryScreen(error);
  }
}

document.addEventListener("click", (event) => {
  if (event.target.closest('[data-action="retry-startup"]')) startApp();
});
