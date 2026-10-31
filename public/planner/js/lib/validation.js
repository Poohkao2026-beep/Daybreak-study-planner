import { parseDateKey } from "./dates.js";

const taskTypes = new Set(["homework", "exam", "study"]);
const priorities = new Set(["low", "normal", "high"]);
const statuses = new Set(["todo", "doing", "done"]);
const colorKeys = new Set(["indigo", "teal", "amber", "rose", "violet", "blue", "green", "orange", "pink", "slate"]);
const sessionStatuses = new Set(["running", "paused", "ended"]);
const sessionOutcomes = new Set(["completed", "stopped_early", "cancelled"]);
const validTimestamp = (value) => typeof value === "string" && Number.isFinite(Date.parse(value));
const optionalTimestamp = (value) => value === undefined || validTimestamp(value);

export function validateSubject(subject) {
  return Boolean(
    subject && typeof subject.id === "string" && subject.id.length > 0
    && typeof subject.name === "string" && subject.name.trim().length > 0 && subject.name.length <= 60
    && colorKeys.has(subject.colorKey)
    && ["teacher", "room", "notes"].every((key) => subject[key] === undefined || typeof subject[key] === "string")
    && validTimestamp(subject.createdAt) && validTimestamp(subject.updatedAt)
    && optionalTimestamp(subject.archivedAt)
  );
}

export function validateTask(task) {
  return Boolean(
    task && typeof task.id === "string" && task.id.length > 0
    && typeof task.title === "string" && task.title.trim() && task.title.length <= 160
    && taskTypes.has(task.type) && statuses.has(task.status) && priorities.has(task.priority)
    && (!task.subjectId || typeof task.subjectId === "string")
    && (!task.dueDate || parseDateKey(task.dueDate))
    && (!task.dueTime || /^([01]\d|2[0-3]):[0-5]\d$/.test(task.dueTime))
    && (task.estimateMin === undefined || Number.isInteger(task.estimateMin) && task.estimateMin > 0 && task.estimateMin <= 600)
    && Number.isFinite(task.order)
    && (task.notes === undefined || typeof task.notes === "string")
    && validTimestamp(task.createdAt) && validTimestamp(task.updatedAt)
    && optionalTimestamp(task.completedAt) && optionalTimestamp(task.deletedAt) && optionalTimestamp(task.pinnedAt)
    && Array.isArray(task.subtasks)
    && task.subtasks.every((subtask) => subtask && typeof subtask.id === "string" && subtask.id.length > 0 && typeof subtask.title === "string" && subtask.title.trim() && subtask.title.length <= 120 && typeof subtask.done === "boolean")
  );
}

export function validateBackup(payload) {
  if (!payload || payload.schemaVersion !== 1 || !Array.isArray(payload.subjects) || !Array.isArray(payload.tasks) || !Array.isArray(payload.sessions) || !Array.isArray(payload.meta)) {
    return { valid: false, error: "This file is not a Daybreak backup in a supported format." };
  }
  if (typeof payload.exportedAt !== "string" || !Number.isFinite(Date.parse(payload.exportedAt))) {
    return { valid: false, error: "This backup is missing a valid export date. Nothing has been imported." };
  }
  if (!payload.subjects.every(validateSubject) || !payload.tasks.every(validateTask)) {
    return { valid: false, error: "This backup contains an invalid subject or task. Nothing has been imported." };
  }
  if (!payload.sessions.every((session) => session && typeof session.id === "string" && session.id.length > 0
    && Number.isInteger(session.plannedMin) && session.plannedMin > 0 && session.plannedMin <= 180
    && validTimestamp(session.startedAt) && optionalTimestamp(session.endedAt)
    && Number.isFinite(session.pausedMs) && session.pausedMs >= 0
    && (session.status === undefined || sessionStatuses.has(session.status))
    && (session.outcome === undefined || sessionOutcomes.has(session.outcome))
    && (session.remainingMs === undefined || Number.isFinite(session.remainingMs) && session.remainingMs >= 0)
    && optionalTimestamp(session.lastResumedAt) && optionalTimestamp(session.pausedAt))) {
    return { valid: false, error: "This backup contains an invalid focus session. Nothing has been imported." };
  }
  if (!payload.meta.every((item) => item && typeof item.key === "string"
    && (item.key !== "focusDurationMin" || Number.isInteger(item.value) && item.value >= 1 && item.value <= 180)
    && (item.key !== "focusSound" || ["ambient", "pink", "brown"].includes(item.value))
    && (item.key !== "focusVolume" || Number.isInteger(item.value) && item.value >= 0 && item.value <= 100))) {
    return { valid: false, error: "This backup contains invalid settings data. Nothing has been imported." };
  }
  if (new Set(payload.subjects.map((subject) => subject.id)).size !== payload.subjects.length
    || new Set(payload.tasks.map((task) => task.id)).size !== payload.tasks.length
    || new Set(payload.sessions.map((session) => session.id)).size !== payload.sessions.length) {
    return { valid: false, error: "This backup contains duplicate records. Nothing has been imported." };
  }
  const subjectIds = new Set(payload.subjects.map((subject) => subject.id));
  if (payload.tasks.some((task) => task.subjectId && !subjectIds.has(task.subjectId))) {
    return { valid: false, error: "This backup refers to a subject that is missing. Nothing has been imported." };
  }
  return { valid: true };
}

export const subjectColorKeys = [...colorKeys];
