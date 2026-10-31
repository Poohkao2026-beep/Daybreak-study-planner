import { getState } from "../store.js";
import { openDatabase, requestResult, transact } from "../db/database.js";

const activeKey = "activeSessionId";

export async function activeSession() {
  const database = await openDatabase();
  const transaction = database.transaction(["meta", "sessions"], "readonly");
  const active = await requestResult(transaction.objectStore("meta").get(activeKey));
  if (!active?.value) return null;
  return requestResult(transaction.objectStore("sessions").get(active.value));
}

export function remainingMilliseconds(session, now = Date.now()) {
  if (!session) return 0;
  if (session.status === "paused") return Math.max(0, session.remainingMs);
  return Math.max(0, session.remainingMs - Math.max(0, now - Date.parse(session.lastResumedAt)));
}

export async function startSession({ taskId, plannedMin }) {
  if (!Number.isInteger(plannedMin) || plannedMin < 1 || plannedMin > 180) throw new Error("Choose a focus length between 1 and 180 minutes.");
  const state = getState();
  if (taskId && !state.tasks.some((task) => task.id === taskId && !task.deletedAt && task.status !== "done")) throw new Error("That task is no longer available. Choose another task.");
  const database = await openDatabase();
  const transaction = database.transaction(["meta", "sessions"], "readwrite");
  const complete = new Promise((resolve, reject) => {
    transaction.oncomplete = resolve;
    transaction.onabort = () => reject(transaction.error || new Error("Daybreak could not start the focus session."));
    transaction.onerror = () => reject(transaction.error || new Error("Daybreak could not start the focus session."));
  });
  const meta = transaction.objectStore("meta");
  const read = meta.get(activeKey);
  let session;
  let alreadyActive = false;
  read.onsuccess = () => {
    if (read.result?.value) {
      alreadyActive = true;
      return;
    }
    const now = new Date().toISOString();
    session = {
      id: crypto.randomUUID(),
      taskId,
      plannedMin,
      startedAt: now,
      endedAt: undefined,
      pausedMs: 0,
      outcome: undefined,
      status: "running",
      remainingMs: plannedMin * 60_000,
      lastResumedAt: now,
    };
    transaction.objectStore("sessions").put(session);
    meta.put({ key: activeKey, value: session.id });
  };
  await complete;
  if (alreadyActive) throw new Error("A focus session is already running in another tab.");
  return session;
}

async function updateActiveSession(update) {
  const database = await openDatabase();
  const transaction = database.transaction(["meta", "sessions"], "readwrite");
  const complete = new Promise((resolve, reject) => {
    transaction.oncomplete = resolve;
    transaction.onabort = () => reject(transaction.error || new Error("Daybreak could not save the focus session."));
    transaction.onerror = () => reject(transaction.error || new Error("Daybreak could not save the focus session."));
  });
  const meta = transaction.objectStore("meta");
  const readActive = meta.get(activeKey);
  let updated;
  readActive.onsuccess = () => {
    const id = readActive.result?.value;
    if (!id) {
      return;
    }
    const sessionStore = transaction.objectStore("sessions");
    const readSession = sessionStore.get(id);
    readSession.onsuccess = () => {
      if (!readSession.result) {
        return;
      }
      updated = update(readSession.result, meta);
      if (updated) sessionStore.put(updated);
    };
  };
  await complete;
  return updated || null;
}

export async function pauseSession(now = Date.now()) {
  return updateActiveSession((session) => {
    if (session.status !== "running") return session;
    const remainingMs = remainingMilliseconds(session, now);
    return {
      ...session,
      status: "paused",
      remainingMs,
      pausedAt: new Date(now).toISOString(),
    };
  });
}

export async function resumeSession(now = new Date()) {
  return updateActiveSession((session) => session.status !== "paused" ? session : {
    ...session,
    status: "running",
    pausedMs: session.pausedMs + Math.max(0, now.getTime() - Date.parse(session.pausedAt)),
    pausedAt: undefined,
    lastResumedAt: now.toISOString(),
  });
}

export async function finishSession(outcome, now = new Date()) {
  if (!["completed", "stopped_early", "cancelled"].includes(outcome)) throw new Error("Choose a valid focus session outcome.");
  const finished = await updateActiveSession((session, meta) => {
    meta.delete(activeKey);
    return { ...session, status: "ended", outcome, endedAt: now.toISOString(), remainingMs: outcome === "completed" ? 0 : remainingMilliseconds(session, now.getTime()) };
  });
  return finished;
}

export function broadcastSessionChange() {
  if (!("BroadcastChannel" in globalThis)) return;
  const channel = new BroadcastChannel("daybreak:data");
  channel.postMessage({ type: "updated" });
  channel.close();
}

export async function clearAllSessions() {
  return transact(["sessions", "meta"], "readwrite", (tx) => {
    tx.objectStore("sessions").clear();
    tx.objectStore("meta").delete(activeKey);
  });
}
