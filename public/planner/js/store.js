import { openDatabase, transact } from "./db/database.js";
import { migrateLegacyData } from "./db/migrations.js";
import { getSubjects } from "./db/repositories/subjects.js";
import { getTasks } from "./db/repositories/tasks.js";
import { getSessions } from "./db/repositories/sessions.js";
import { getMeta } from "./db/repositories/meta.js";
import { validateSubject, validateTask } from "./lib/validation.js";

let snapshot = { subjects: [], tasks: [], sessions: [], meta: {} };
const listeners = new Set();
const channel = "BroadcastChannel" in globalThis ? new BroadcastChannel("daybreak:data") : null;
let refreshQueued = false;

function copy(value) {
  return structuredClone(value);
}

function toState(records) {
  return {
    subjects: records.subjects,
    tasks: records.tasks,
    sessions: records.sessions,
    meta: Object.fromEntries(records.meta.map(({ key, value }) => [key, value])),
  };
}

export async function initializeStore() {
  const migration = await migrateLegacyData();
  if (migration.error) throw Object.assign(migration.error, { recoveryRaw: migration.raw });
  await refresh();
  return migration;
}

export function getState() {
  return copy(snapshot);
}

export function subscribe(selector, callback) {
  const listener = { selector, callback, previous: selector(snapshot) };
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function publish(next) {
  const previous = snapshot;
  snapshot = next;
  for (const listener of listeners) {
    const value = listener.selector(snapshot);
    if (value !== listener.previous) {
      const before = listener.previous;
      listener.previous = value;
      listener.callback(value, before);
    }
  }
  return previous;
}

async function writeSnapshot(next) {
  const meta = Object.entries(next.meta).map(([key, value]) => ({ key, value }));
  await transact(["subjects", "tasks", "sessions", "meta"], "readwrite", (tx) => {
    const contents = {
      subjects: next.subjects,
      tasks: next.tasks,
      sessions: next.sessions,
      meta,
    };
    for (const [name, records] of Object.entries(contents)) {
      const store = tx.objectStore(name);
      store.clear();
      records.forEach((record) => store.put(record));
    }
  });
}

function commitMutation(mutator) {
  return openDatabase().then((database) => new Promise((resolve, reject) => {
    const names = ["subjects", "tasks", "sessions", "meta"];
    const transaction = database.transaction(names, "readwrite");
    const records = {};
    let remaining = names.length;
    let committed;
    let mutationError;
    transaction.oncomplete = () => mutationError ? reject(mutationError) : resolve(committed);
    transaction.onabort = () => reject(mutationError || transaction.error || new Error("Daybreak could not save this change."));
    transaction.onerror = () => reject(mutationError || transaction.error || new Error("Daybreak could not save this change."));

    for (const name of names) {
      const request = transaction.objectStore(name).getAll();
      request.onerror = () => transaction.abort();
      request.onsuccess = () => {
        records[name] = request.result;
        remaining -= 1;
        if (remaining !== 0) return;
        try {
          const next = toState(records);
          mutator(next);
          if (!next.subjects.every(validateSubject) || !next.tasks.every(validateTask)) {
            throw new Error("The change contains a subject or task that is not valid. Nothing was saved.");
          }
          const contents = {
            subjects: next.subjects,
            tasks: next.tasks,
            sessions: next.sessions,
            meta: Object.entries(next.meta).map(([key, value]) => ({ key, value })),
          };
          for (const [storeName, items] of Object.entries(contents)) {
            const store = transaction.objectStore(storeName);
            store.clear();
            items.forEach((item) => store.put(item));
          }
          committed = next;
        } catch (error) {
          mutationError = error;
          transaction.abort();
        }
      };
    }
  }));
}

export async function update(mutator) {
  const previous = copy(snapshot);
  const optimistic = copy(snapshot);
  mutator(optimistic);
  publish(optimistic);
  try {
    const committed = await commitMutation(mutator);
    publish(committed);
    channel?.postMessage({ type: "updated" });
    await requestPersistentStorage();
    return getState();
  } catch (error) {
    publish(previous);
    throw error;
  }
}

export async function refresh() {
  if (refreshQueued) return;
  refreshQueued = true;
  try {
    const [subjects, tasks, sessions, meta] = await Promise.all([getSubjects(), getTasks(), getSessions(), getMeta()]);
    publish(toState({ subjects, tasks, sessions, meta }));
  } finally {
    refreshQueued = false;
  }
}

async function requestPersistentStorage() {
  if (snapshot.meta.persistenceRequested || !globalThis.navigator?.storage?.persist) return;
  const next = copy(snapshot);
  next.meta.persistenceRequested = true;
  publish(next);
  try {
    const persistent = await navigator.storage.persist();
    const { putMeta } = await import("./db/repositories/meta.js");
    await Promise.all([
      putMeta("persistenceRequested", true),
      putMeta("storagePersistence", persistent ? "persistent" : "may-clear"),
    ]);
    const state = copy(snapshot);
    state.meta.storagePersistence = persistent ? "persistent" : "may-clear";
    publish(state);
  } catch (error) {
    const state = copy(snapshot);
    state.meta.storagePersistence = "may-clear";
    publish(state);
    console.error("Could not request persistent Daybreak storage.", error);
  }
}

channel?.addEventListener("message", (event) => {
  if (event.data?.type === "updated") refresh().catch((error) => console.error("Could not refresh changes from another Daybreak tab.", error));
});

window.addEventListener("daybreak:storage-versionchange", () => {
  window.dispatchEvent(new CustomEvent("daybreak:storage-error", { detail: "Storage changed in another tab. Reload Daybreak to continue safely." }));
});

export async function replaceAllStores(data) {
  const next = {
    subjects: data.subjects,
    tasks: data.tasks,
    sessions: data.sessions,
    meta: Object.fromEntries(data.meta.map(({ key, value }) => [key, value])),
  };
  if (!next.subjects.every(validateSubject) || !next.tasks.every(validateTask)) throw new Error("The replacement data did not pass validation.");
  await writeSnapshot(next);
  publish(next);
  channel?.postMessage({ type: "updated" });
}

export function getChannel() {
  return channel;
}
