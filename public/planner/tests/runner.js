globalThis.__DAYBREAK_DATABASE_NAME__ = `daybreak-tests-${crypto.randomUUID()}`;

const [
  { addDays, dateKey, daysBetween, formatLocalTime, parseDateKey, relativeDate },
  { recommendTask },
  { dailyProductivityTip },
  { parseQuickAdd },
  { validateBackup, validateTask },
  { convertLegacyData, migrateLegacyData },
  { remainingMilliseconds },
  store,
  database,
  timer,
  backup,
] = await Promise.all([
  import("../js/lib/dates.js"),
  import("../js/lib/recommendation.js"),
  import("../js/lib/productivity.js"),
  import("../js/components/quick-add.js"),
  import("../js/lib/validation.js"),
  import("../js/db/migrations.js"),
  import("../js/services/timer.js"),
  import("../js/store.js"),
  import("../js/db/database.js"),
  import("../js/services/timer.js"),
  import("../js/services/backup.js"),
]);

const results = document.querySelector("#results");
const summary = document.querySelector("#summary");
const cases = [];
const assert = (condition, message = "Assertion failed.") => {
  if (!condition) throw new Error(message);
};
const same = (actual, expected, message = "Values did not match.") => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message} Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}.`);
  }
};
const test = (name, run) => cases.push({ name, run });
const makeTask = (overrides = {}) => ({
  id: crypto.randomUUID(),
  title: "Review notes",
  type: "study",
  status: "todo",
  priority: "normal",
  order: 0,
  subtasks: [],
  createdAt: "2024-06-03T12:00:00.000Z",
  updatedAt: "2024-06-03T12:00:00.000Z",
  ...overrides,
});
const makeSubject = () => ({
  id: crypto.randomUUID(),
  name: "Computer Science",
  colorKey: "indigo",
  createdAt: "2024-06-03T12:00:00.000Z",
  updatedAt: "2024-06-03T12:00:00.000Z",
});

test("date-only values remain local across midnight and DST", () => {
  const before = new Date(2024, 2, 10, 23, 59);
  const after = new Date(2024, 2, 11, 0, 1);
  same(addDays(dateKey(before), 1), dateKey(after));
  same(daysBetween(dateKey(before), dateKey(after)), 1);
  same(daysBetween("2024-03-09", "2024-03-11"), 2);
  assert(parseDateKey("2024-02-29"));
  same(parseDateKey("2024-02-30"), null);
});

test("relative dates use localized labels for near dates", () => {
  const now = new Date(2024, 5, 3, 12);
  same(relativeDate("2024-06-04", now), "Tomorrow");
  same(relativeDate("2024-06-02", now), "Yesterday");
});

test("local clock formatting follows the browser locale and includes seconds", () => {
  const sample = new Date(2024, 5, 3, 12, 34, 56);
  const expected = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", second: "2-digit" }).format(sample);
  same(formatLocalTime(sample), expected);
  assert(/\d{2}/.test(formatLocalTime(sample)));
});

test("daily productivity tip stays consistent for a day and changes the next day", () => {
  const firstDay = new Date(2026, 9, 31, 8);
  const laterSameDay = new Date(2026, 9, 31, 21);
  const nextDay = new Date(2026, 10, 1, 8);
  same(dailyProductivityTip(firstDay), dailyProductivityTip(laterSameDay));
  assert(dailyProductivityTip(firstDay).title);
  assert(dailyProductivityTip(firstDay).body.length > 30);
  assert(dailyProductivityTip(firstDay).title !== dailyProductivityTip(nextDay).title);
});

test("recommendation ranks deadlines, priority, progress, and estimates", () => {
  const now = new Date(2024, 5, 3, 12);
  const tasks = [
    makeTask({ id: "tomorrow", dueDate: "2024-06-04", priority: "high" }),
    makeTask({ id: "today-late", dueDate: "2024-06-03", dueTime: "17:00", priority: "high" }),
    makeTask({ id: "today-early", dueDate: "2024-06-03", dueTime: "09:00", priority: "normal" }),
    makeTask({ id: "overdue", dueDate: "2024-06-02", priority: "low" }),
  ];
  same(recommendTask(tasks, now).task.id, "overdue");
  same(recommendTask(tasks.filter((task) => task.id !== "overdue"), now).task.id, "today-early");
  const tier = [
    makeTask({ id: "normal", dueDate: "2024-06-03", priority: "normal" }),
    makeTask({ id: "high", dueDate: "2024-06-03", priority: "high" }),
    makeTask({ id: "doing", dueDate: "2024-06-03", status: "doing", priority: "high" }),
  ];
  same(recommendTask(tier, now).task.id, "doing");
});

test("recommendation respects pins and excludes archived or completed tasks", () => {
  const now = new Date(2024, 5, 3, 12);
  const tasks = [
    makeTask({ id: "archived", subjectId: "old", pinnedAt: "2024-06-01T00:00:00Z" }),
    makeTask({ id: "done", status: "done", pinnedAt: "2024-06-02T00:00:00Z" }),
    makeTask({ id: "pinned", pinnedAt: "2024-06-03T00:00:00Z" }),
  ];
  same(recommendTask(tasks, now, { subjects: [{ id: "old", archivedAt: "2024-06-01T00:00:00Z" }] }).task.id, "pinned");
  same(recommendTask([tasks[0], tasks[1]], now, { subjects: [{ id: "old", archivedAt: "2024-06-01T00:00:00Z" }] }), null);
});

test("quick add parses subject, priority, date, and estimate tokens", () => {
  const now = new Date(2024, 0, 1, 10);
  const parsed = parseQuickAdd("Review #Math !high tomorrow 30m", [{ id: "math", name: "Math" }], now);
  same(parsed.title, "Review");
  same(parsed.subjectId, "math");
  same(parsed.priority, "high");
  same(parsed.dueDate, "2024-01-02");
  same(parsed.estimateMin, 30);
});

test("quick add handles weekdays, ambiguity, and unknown subjects", () => {
  const now = new Date(2024, 0, 1, 10);
  same(parseQuickAdd("Read chapter monday", [], now).dueDate, "2024-01-08");
  const ambiguous = parseQuickAdd("Review #Math", [{ id: "m1", name: "Math" }, { id: "m2", name: "Math" }], now);
  assert(ambiguous.ambiguity);
  same(parseQuickAdd("Review #Biology", [], now).createSubjectName, "Biology");
  assert(parseQuickAdd("Review today tomorrow", [], now).ambiguity);
});

test("task and backup validators reject invalid dates, relations, and records", () => {
  const validSubject = makeSubject();
  const validTask = makeTask({ subjectId: validSubject.id, dueDate: "2024-02-29" });
  assert(validateTask(validTask));
  assert(validateTask(makeTask()));
  assert(validateTask(makeTask({ title: "L".repeat(160) })));
  assert(!validateTask(makeTask({ title: "L".repeat(161) })));
  assert(!validateTask({ ...validTask, dueDate: "2024-02-30" }));
  assert(!validateTask({ ...validTask, estimateMin: 601 }));
  const validBackup = {
    schemaVersion: 1,
    exportedAt: "2024-06-03T12:00:00.000Z",
    subjects: [validSubject],
    tasks: [validTask],
    sessions: [],
    meta: [],
  };
  assert(validateBackup(validBackup).valid);
  assert(validateBackup({ ...validBackup, meta: [{ key: "focusDurationMin", value: 45 }] }).valid);
  assert(!validateBackup({ ...validBackup, meta: [{ key: "focusDurationMin", value: 181 }] }).valid);
  assert(!validateBackup({ ...validBackup, meta: [{ key: "focusSound", value: "unknown" }] }).valid);
  assert(!validateBackup({ ...validBackup, meta: [{ key: "focusVolume", value: 101 }] }).valid);
  assert(!validateBackup({ ...validBackup, tasks: [{ ...validTask, subjectId: "missing" }] }).valid);
  assert(!validateBackup({ ...validBackup, tasks: [{ ...validTask, dueDate: "2024-02-30" }] }).valid);
});

test("legacy migration maps a real-shape fixture without dropping fields", async () => {
  const raw = JSON.stringify({
    tasks: [
      { id: "legacy-1", title: "Data structures review", subject: "CS101", type: "homework", dueDate: "2024-09-10", link: "https://example.edu/course", linkPlatform: "Canvas", completed: false, customFlag: "keep me" },
      { id: "legacy-2", title: "Midterm", subject: "CS101", type: "exam", dueDate: "2024-09-12", completed: true },
    ],
    activeDays: ["2024-09-01"],
    studyActivityDates: ["2024-09-01"],
    campus: { name: "University portal", url: "https://example.edu" },
    reminders: { enabled: false, time: "18:00", lastDate: "" },
    checkins: [],
    notes: "Keep these notes.",
  });
  const converted = convertLegacyData(JSON.parse(raw), raw, "2024-09-01T00:00:00.000Z");
  same(converted.subjects.length, 1);
  same(converted.tasks.length, 2);
  same(converted.tasks[0].subjectId, converted.subjects[0].id);
  same(converted.tasks[1].status, "done");
  same(converted.tasks[0].legacy.linkPlatform, "Canvas");
  same(converted.tasks[0].legacy.unknownFields.customFlag, "keep me");
  same(converted.meta.find((item) => item.key === "legacy:notes").value, "Keep these notes.");
  assert(converted.meta.find((item) => item.key === "legacyRawBytes").value >= raw.length);
  const empty = convertLegacyData({ tasks: [], activeDays: [], studyActivityDates: [], campus: null, reminders: {}, checkins: [], notes: "" }, "{}", "2024-09-01T00:00:00.000Z");
  same(empty.tasks.length, 0);

  const saved = new Map([["studyloop.v1", raw]]);
  const fakeStorage = {
    getItem: (key) => saved.get(key) ?? null,
    setItem: (key, value) => saved.set(key, String(value)),
  };
  const migration = await migrateLegacyData(fakeStorage);
  assert(migration.migrated);
  same(saved.get("studyloop.v1"), raw);
  same(saved.get("studyloop.v1.backup"), raw);
  same(migration.taskCount, 2);
  await store.refresh();
  same(store.getState().tasks.length, 2);
  same(store.getState().meta.legacyState.notes, "Keep these notes.");
  assert(store.getState().meta.migratedFromV1At);
  const retry = await migrateLegacyData(fakeStorage);
  assert(retry.alreadyDone);
  await store.update((next) => {
    next.subjects = [];
    next.tasks = [];
    next.sessions = [];
    next.meta = {};
  });
});

test("large task lists, maximum titles, and sparse optional fields persist", async () => {
  const tasks = Array.from({ length: 50 }, (_, index) => makeTask({
    title: index === 0 ? "L".repeat(160) : `Task ${index + 1}`,
    order: index,
  }));
  await store.update((next) => { next.tasks.push(...tasks); });
  await store.refresh();
  same(store.getState().tasks.length, 50);
  same(store.getState().tasks.find((task) => task.id === tasks[0].id).title.length, 160);
  same(store.getState().tasks.find((task) => task.id === tasks[1].id).dueDate, undefined);
  await store.update((next) => {
    next.tasks = [];
    next.subjects = [];
    next.sessions = [];
  });
});

test("timer remaining time uses pause, resume, and reload timestamps", () => {
  const running = { status: "running", remainingMs: 60_000, lastResumedAt: "2024-06-03T12:00:00.000Z" };
  same(remainingMilliseconds(running, Date.parse("2024-06-03T12:00:20.000Z")), 40_000);
  const paused = { ...running, status: "paused", remainingMs: 40_000, pausedAt: "2024-06-03T12:00:20.000Z" };
  same(remainingMilliseconds(paused, Date.parse("2024-06-03T12:30:20.000Z")), 40_000);
  const resumed = { ...paused, status: "running", lastResumedAt: "2024-06-03T12:30:20.000Z" };
  same(remainingMilliseconds(resumed, Date.parse("2024-06-03T12:30:30.000Z")), 30_000);
});

test("CRUD writes persist after a refresh and invalid writes roll back", async () => {
  await store.refresh();
  const subject = makeSubject();
  const task = makeTask({ subjectId: subject.id });
  await store.update((next) => {
    next.subjects.push(subject);
    next.tasks.push(task);
  });
  await store.refresh();
  assert(store.getState().tasks.some((item) => item.id === task.id));

  const before = JSON.stringify(store.getState());
  const observedCounts = [];
  const unsubscribe = store.subscribe((state) => state.tasks.length, (count) => observedCounts.push(count));
  let rejected = false;
  try {
    await store.update((next) => next.tasks.push(makeTask({ priority: "urgent" })));
  } catch {
    rejected = true;
  }
  unsubscribe();
  assert(rejected, "Invalid task write should reject.");
  same(JSON.stringify(store.getState()), before, "Failed write must restore the previous snapshot.");
  assert(observedCounts.length >= 2, "Optimistic state and rollback should both be observable.");
});

test("invalid backup imports leave stored data unchanged", async () => {
  const before = JSON.stringify(store.getState());
  let rejected = false;
  try {
    await backup.importBackup({ schemaVersion: 1, subjects: [], tasks: [], sessions: [], meta: [], exportedAt: "bad" });
  } catch {
    rejected = true;
  }
  assert(rejected);
  same(JSON.stringify(store.getState()), before);
});

test("a second-tab update reaches the store through BroadcastChannel", async () => {
  const task = makeTask({ title: "Cross-tab update" });
  const channel = new BroadcastChannel("daybreak:data");
  const visible = new Promise((resolve, reject) => {
    const unsubscribe = store.subscribe((state) => state.tasks.some((item) => item.id === task.id), (found) => {
      if (found) {
        unsubscribe();
        resolve();
      }
    });
    setTimeout(() => {
      unsubscribe();
      reject(new Error("The external update did not reach this tab."));
    }, 2000);
  });
  await database.transact(["tasks"], "readwrite", (transaction) => transaction.objectStore("tasks").put(task));
  channel.postMessage({ type: "updated" });
  await visible;
  channel.close();
});

test("focus sessions finish once and clear the active session", async () => {
  await store.refresh();
  const session = await timer.startSession({ plannedMin: 1 });
  assert(session.id);
  const ended = await timer.finishSession("completed");
  same(ended.id, session.id);
  same(await timer.finishSession("completed"), null);
  same(await timer.activeSession(), null);
  await store.refresh();
  same(store.getState().sessions.filter((item) => item.id === session.id && item.endedAt).length, 1);
  await timer.clearAllSessions();
});

try {
  for (const { name, run } of cases) {
    const item = document.createElement("li");
    try {
      await run();
      item.className = "pass";
      item.textContent = `PASS ${name}`;
    } catch (error) {
      item.className = "fail";
      item.textContent = `FAIL ${name}: ${error.message}`;
    }
    results.append(item);
  }
} finally {
  store.getChannel()?.close();
  database.closeDatabase();
  await new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(globalThis.__DAYBREAK_DATABASE_NAME__);
    request.onsuccess = resolve;
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("Temporary test database remained open."));
  });
}

const passed = results.querySelectorAll(".pass").length;
const failed = results.querySelectorAll(".fail").length;
summary.textContent = `Test summary: ${passed} passed, ${failed} failed.`;
summary.className = failed ? "fail" : "pass";
