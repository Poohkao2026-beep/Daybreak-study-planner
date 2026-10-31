import { openDatabase, storageError } from "./database.js";
import { parseDateKey } from "../lib/dates.js";

const LEGACY_KEY = "studyloop.v1";
const BACKUP_KEY = "studyloop.v1.backup";
const knownTaskFields = new Set(["id", "title", "subject", "type", "dueDate", "link", "linkPlatform", "completed"]);

function request(requestRef) {
  return new Promise((resolve, reject) => {
    requestRef.onsuccess = () => resolve(requestRef.result);
    requestRef.onerror = () => reject(requestRef.error);
  });
}

function transactionComplete(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = resolve;
    transaction.onabort = () => reject(storageError(transaction.error));
    transaction.onerror = () => reject(storageError(transaction.error));
  });
}

function record(id, value) {
  return { key: id, value };
}

export async function migrateLegacyData(storage = globalThis.localStorage) {
  let raw;
  try {
    raw = storage.getItem(LEGACY_KEY);
  } catch (error) {
    return { migrated: false, error: new Error(`Daybreak cannot read the old browser data: ${error.message}`), raw: null };
  }
  let database;
  let marker;
  try {
    database = await openDatabase();
    const readTransaction = database.transaction(["meta"], "readonly");
    marker = await request(readTransaction.objectStore("meta").get("migratedFromV1At"));
    await transactionComplete(readTransaction);
  } catch (error) {
    return { migrated: false, error: storageError(error), raw };
  }
  if (marker) return { migrated: false, error: null, raw, alreadyDone: true };
  if (!raw) {
    const result = await importLegacyState(database, null, null);
    return { migrated: !result.alreadyDone, error: null, raw: null, alreadyDone: result.alreadyDone };
  }

  let source;
  try {
    source = JSON.parse(raw);
    if (!source || typeof source !== "object" || Array.isArray(source)) throw new Error("The saved data is not a JSON object.");
  } catch (error) {
    return { migrated: false, error: new Error(`Daybreak found old data it cannot read (${error.message}). Download it before making changes.`), raw };
  }

  try {
    if (!storage.getItem(BACKUP_KEY)) storage.setItem(BACKUP_KEY, raw);
  } catch (error) {
    return { migrated: false, error: new Error(`Daybreak could not make a safety copy in browser storage (${error.message}). Download your current data before retrying.`), raw };
  }

  try {
    const result = await importLegacyState(database, source, raw);
    if (result.alreadyDone) return { migrated: false, error: null, raw, alreadyDone: true };
    const taskCount = Array.isArray(source.tasks) ? source.tasks.length : 0;
    console.info(`Daybreak imported legacy data: ${taskCount} task record(s); original browser data remains in place.`);
    return { migrated: true, error: null, raw, taskCount };
  } catch (error) {
    return { migrated: false, error: storageError(error), raw };
  }
}

async function importLegacyState(database, source, raw) {
  const transaction = database.transaction(["subjects", "tasks", "meta"], "readwrite");
  const subjects = transaction.objectStore("subjects");
  const tasks = transaction.objectStore("tasks");
  const meta = transaction.objectStore("meta");
  const completed = transactionComplete(transaction);
  const markerRequest = meta.get("migratedFromV1At");
  let alreadyDone = false;
  let migrationError;
  markerRequest.onsuccess = () => {
    if (markerRequest.result) {
      alreadyDone = true;
      return;
    }

    try {
      const migratedAt = new Date().toISOString();
      const converted = convertLegacyData(source, raw, migratedAt);
      converted.subjects.forEach((subject) => subjects.put(subject));
      converted.tasks.forEach((task) => tasks.put(task));
      converted.meta.forEach((item) => meta.put(item));
    } catch (error) {
      migrationError = error;
      transaction.abort();
    }
  };
  markerRequest.onerror = () => transaction.abort();
  try {
    await completed;
  } catch (error) {
    throw migrationError || error;
  }
  return { alreadyDone };
}

export function convertLegacyData(source, raw, migratedAt = new Date().toISOString()) {
  const subjectIds = new Map();
  for (const task of Array.isArray(source?.tasks) ? source.tasks : []) {
    if (typeof task?.subject !== "string" || !task.subject.trim() || subjectIds.has(task.subject.trim())) continue;
    subjectIds.set(task.subject.trim(), crypto.randomUUID());
  }
  const subjects = [...subjectIds].map(([name, id]) => ({
    id,
    name,
    colorKey: "indigo",
    createdAt: migratedAt,
    updatedAt: migratedAt,
    legacy: { source: "studyloop.v1", subjectName: name },
  }));
  const tasks = [];
  (Array.isArray(source?.tasks) ? source.tasks : []).forEach((task, index) => {
    if (!task || typeof task !== "object" || typeof task.id !== "string" || typeof task.title !== "string") return;
    const subjectName = typeof task.subject === "string" ? task.subject.trim() : "";
    const extraFields = Object.fromEntries(Object.entries(task).filter(([key]) => !knownTaskFields.has(key)));
    tasks.push({
      id: task.id,
      title: task.title,
      subjectId: subjectIds.get(subjectName),
      type: ["homework", "exam", "study"].includes(task.type) ? task.type : "study",
      status: task.completed === true ? "done" : "todo",
      priority: "normal",
      dueDate: parseDateKey(task.dueDate) ? task.dueDate : undefined,
      dueTime: undefined,
      estimateMin: undefined,
      subtasks: [],
      notes: undefined,
      order: index,
      createdAt: migratedAt,
      updatedAt: migratedAt,
      completedAt: undefined,
      deletedAt: undefined,
      pinnedAt: undefined,
      legacy: {
        ...(task.link ? { link: task.link } : {}),
        ...(task.linkPlatform ? { linkPlatform: task.linkPlatform } : {}),
        ...(subjectName ? { originalSubjectName: subjectName } : {}),
        ...(Object.keys(extraFields).length ? { unknownFields: extraFields } : {}),
      },
    });
  });
  const meta = [];
  if (source) {
    meta.push(record("legacyState", source));
    meta.push(record("legacyRawBytes", raw === null ? 0 : new TextEncoder().encode(raw).byteLength));
    for (const key of ["activeDays", "studyActivityDates", "campus", "reminders", "checkins", "notes"]) {
      if (Object.hasOwn(source, key)) meta.push(record(`legacy:${key}`, source[key]));
    }
  }
  meta.push(record("schemaVersion", 1), record("migratedFromV1At", migratedAt));
  return { subjects, tasks, meta };
}
